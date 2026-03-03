package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/pdf"
	"servico-faturamento/internal/repositorio"
)

// LambdaHandler is the main Lambda handler using DynamoDB
type LambdaHandler struct {
	repo             *repositorio.RepositorioDynamoDB
	s3Client         *s3.Client
	pdfGenerator     *pdf.GeradorPDF
	bucketName       string
	cloudFrontDomain string
}

// NewLambdaHandler creates a new Lambda handler with DynamoDB
func NewLambdaHandler() (*LambdaHandler, error) {
	// Initialize logger
	logger.Init()
	slog.Info("Initializing Lambda handler with DynamoDB")

	// Get table names from environment
	mainTableName := os.Getenv("DYNAMODB_TABLE_NAME")
	eventsTableName := os.Getenv("DYNAMODB_EVENTS_TABLE_NAME")

	if mainTableName == "" || eventsTableName == "" {
		return nil, fmt.Errorf("DYNAMODB_TABLE_NAME and DYNAMODB_EVENTS_TABLE_NAME are required")
	}

	// Initialize AWS SDK config
	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create DynamoDB client
	ddbClient := dynamodb.NewFromConfig(cfg)

	// Create S3 client
	s3Client := s3.NewFromConfig(cfg)

	// Create repository
	repo := repositorio.NewRepositorioDynamoDB(ddbClient, mainTableName, eventsTableName)

	// Create PDF generator
	pdfGenerator := pdf.NewGeradorPDF()

	// Get S3 bucket name
	bucketName := os.Getenv("PDF_BUCKET_NAME")
	if bucketName == "" {
		bucketName = "nfe-pdfs-mock" // default
	}

	cloudFrontDomain := os.Getenv("CLOUDFRONT_DOMAIN")

	slog.Info("Lambda handler initialized successfully",
		"mainTable", mainTableName,
		"eventsTable", eventsTableName,
		"pdfBucket", bucketName,
		"cloudFrontDomain", cloudFrontDomain)

	return &LambdaHandler{
		repo:             repo,
		s3Client:         s3Client,
		pdfGenerator:     pdfGenerator,
		bucketName:       bucketName,
		cloudFrontDomain: cloudFrontDomain,
	}, nil
}

// HandleRequest is called by AWS Lambda for each invocation
func (h *LambdaHandler) HandleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	slog.Info("Lambda invoked", "method", request.HTTPMethod, "path", request.Path)

	origin := getHeaderValue(request.Headers, "Origin")

	// Handle OPTIONS for CORS
	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNoContent,
			Headers:    corsHeaders(origin),
			Body:       "",
		}, nil
	}

	// Health check
	if (request.Path == "/health" || request.Path == "/api/v1/health") && request.HTTPMethod == "GET" {
		return h.handleHealthCheck(ctx, origin)
	}

	// Router based on path and method
	switch {
	case strings.HasPrefix(request.Path, "/api/v1/notas"):
		return h.handleNotasRoutes(ctx, request, origin)
	case strings.HasPrefix(request.Path, "/api/v1/solicitacoes-impressao"):
		return h.handleSolicitacoesImpressaoRoutes(ctx, request, origin)
	default:
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    corsHeaders(origin),
			Body:       `{"erro":"Not Found"}`,
		}, nil
	}
}

func (h *LambdaHandler) handleHealthCheck(ctx context.Context, origin string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       `{"status":"healthy","service":"faturamento","database":"dynamodb","version":"2.0.0"}`,
	}, nil
}

func (h *LambdaHandler) handleNotasRoutes(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	pathParts := strings.Split(strings.Trim(request.Path, "/"), "/")
	var notaID string
	var subresource string
	if len(pathParts) > 3 {
		notaID = pathParts[3]
	}
	if len(pathParts) > 4 {
		subresource = pathParts[4]
	}

	switch request.HTTPMethod {
	case "GET":
		if notaID != "" && subresource == "" {
			return h.handleGetNota(ctx, notaID, origin)
		}
		return h.handleListNotas(ctx, request, origin)

	case "POST":
		if notaID != "" && subresource == "itens" {
			return h.handleAddItem(ctx, notaID, request, origin)
		}
		if notaID != "" && subresource == "imprimir" {
			return h.handleImprimirNota(ctx, notaID, request, origin)
		}
		if notaID == "" {
			return h.handleCreateNota(ctx, request, origin)
		}
		return errorResponse(http.StatusNotFound, "Rota não encontrada", origin), nil

	case "PUT":
		if notaID == "" {
			return errorResponse(http.StatusBadRequest, "Nota ID required", origin), nil
		}
		if subresource == "fechar" {
			return h.handleFecharNota(ctx, notaID, origin)
		}
		return errorResponse(http.StatusNotFound, "Rota não encontrada", origin), nil

	default:
		return errorResponse(http.StatusMethodNotAllowed, "Method not allowed", origin), nil
	}
}

func (h *LambdaHandler) handleCreateNota(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	var req struct {
		Numero string `json:"numero"`
	}

	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON: "+err.Error(), origin), nil
	}

	if req.Numero == "" {
		return errorResponse(http.StatusBadRequest, "Campo 'numero' é obrigatório", origin), nil
	}

	// Check if numero already exists
	existingNota, err := h.repo.BuscarPorNumero(ctx, req.Numero)
	if err != nil {
		slog.Error("Error checking existing nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao verificar nota existente", origin), nil
	}
	if existingNota != nil {
		return errorResponse(http.StatusConflict, "Número de nota já existe", origin), nil
	}

	nota := &dominio.NotaFiscal{
		ID:     uuid.New(),
		Numero: req.Numero,
		Status: dominio.StatusNotaAberta,
	}

	if err := h.repo.CriarNota(ctx, nota); err != nil {
		slog.Error("Error creating nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Falha ao criar nota", origin), nil
	}

	body, _ := json.Marshal(nota)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusCreated,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func (h *LambdaHandler) handleGetNota(ctx context.Context, notaIDStr string, origin string) (events.APIGatewayProxyResponse, error) {
	notaID, err := uuid.Parse(notaIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	nota, err := h.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		slog.Error("Error fetching nota", "id", notaID, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar nota", origin), nil
	}

	if nota == nil {
		return errorResponse(http.StatusNotFound, "Nota não encontrada", origin), nil
	}

	body, _ := json.Marshal(nota)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func (h *LambdaHandler) handleListNotas(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	status := request.QueryStringParameters["status"]

	// Validate status if provided
	if status != "" && status != dominio.StatusNotaAberta && status != dominio.StatusNotaFechada {
		return errorResponse(http.StatusBadRequest, "Status inválido. Use 'ABERTA' ou 'FECHADA'", origin), nil
	}

	notas, err := h.repo.ListarNotas(ctx, status)
	if err != nil {
		slog.Error("Error listing notas", "status", status, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao listar notas", origin), nil
	}

	body, _ := json.Marshal(notas)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func (h *LambdaHandler) handleAddItem(ctx context.Context, notaIDStr string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	notaID, err := uuid.Parse(notaIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	var req struct {
		ProdutoID     string  `json:"produtoId"`
		Quantidade    int     `json:"quantidade"`
		PrecoUnitario float64 `json:"precoUnitario"`
	}

	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON", origin), nil
	}

	produtoID, err := uuid.Parse(req.ProdutoID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ProdutoID inválido", origin), nil
	}

	if req.Quantidade <= 0 {
		return errorResponse(http.StatusBadRequest, "Quantidade deve ser maior que zero", origin), nil
	}

	if req.PrecoUnitario <= 0 {
		return errorResponse(http.StatusBadRequest, "PrecoUnitario deve ser maior que zero", origin), nil
	}

	// Check if nota exists and is open
	nota, err := h.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		slog.Error("Error fetching nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar nota", origin), nil
	}
	if nota == nil {
		return errorResponse(http.StatusNotFound, "Nota não encontrada", origin), nil
	}
	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusBadRequest, "Nota não está aberta", origin), nil
	}

	// Validate stock availability before adding item.
	// Must account for quantities of the same product already in this nota,
	// since stock is only decremented when the nota is closed/printed.
	saldo, produtoExiste, err := h.repo.BuscarSaldoProduto(ctx, produtoID)
	if err != nil {
		slog.Error("Error checking product stock", "produtoId", produtoID, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao verificar estoque do produto", origin), nil
	}
	if !produtoExiste {
		return errorResponse(http.StatusNotFound, "Produto não encontrado no estoque", origin), nil
	}

	var jaReservadoNaNota int
	for _, item := range nota.Itens {
		if item.ProdutoID == produtoID {
			jaReservadoNaNota += item.Quantidade
		}
	}

	disponivel := saldo - jaReservadoNaNota
	if disponivel < req.Quantidade {
		return errorResponse(http.StatusConflict, fmt.Sprintf("Saldo insuficiente. Estoque: %d, Já na nota: %d, Disponível: %d, Solicitado: %d", saldo, jaReservadoNaNota, disponivel, req.Quantidade), origin), nil
	}

	item := &dominio.ItemNota{
		ID:            uuid.New(),
		NotaID:        notaID,
		ProdutoID:     produtoID,
		Quantidade:    req.Quantidade,
		PrecoUnitario: req.PrecoUnitario,
	}

	if err := h.repo.AdicionarItem(ctx, item); err != nil {
		slog.Error("Error adding item", "error", err)
		return errorResponse(http.StatusInternalServerError, "Falha ao adicionar item", origin), nil
	}

	body, _ := json.Marshal(item)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusCreated,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func (h *LambdaHandler) handleFecharNota(ctx context.Context, notaIDStr string, origin string) (events.APIGatewayProxyResponse, error) {
	notaID, err := uuid.Parse(notaIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	// Check if nota exists and is open
	nota, err := h.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		slog.Error("Error fetching nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar nota", origin), nil
	}
	if nota == nil {
		return errorResponse(http.StatusNotFound, "Nota não encontrada", origin), nil
	}
	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusBadRequest, "Nota não está aberta", origin), nil
	}
	if len(nota.Itens) == 0 {
		return errorResponse(http.StatusBadRequest, "Nota sem itens não pode ser fechada", origin), nil
	}

	// Close nota (this will also create outbox event)
	if err := h.repo.FecharNota(ctx, notaID); err != nil {
		slog.Error("Error closing nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Falha ao fechar nota", origin), nil
	}

	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       `{"message":"Nota fechada com sucesso"}`,
	}, nil
}

// Helper functions
func corsHeaders(origin string) map[string]string {
	allowedOrigins := []string{
		"http://localhost:4200",
		"http://localhost:8080",
	}

	// Check if CloudFront domain
	cloudFrontDomain := os.Getenv("CLOUDFRONT_DOMAIN")
	if cloudFrontDomain != "" {
		allowedOrigins = append(allowedOrigins, "https://"+cloudFrontDomain)
	}

	// Check if origin is allowed
	allowOrigin := ""
	for _, allowed := range allowedOrigins {
		if origin == allowed || strings.HasSuffix(origin, ".cloudfront.net") {
			allowOrigin = origin
			break
		}
	}

	if allowOrigin == "" {
		allowOrigin = allowedOrigins[0] // Default fallback
	}

	return map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  allowOrigin,
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-Idempotency-Key",
	}
}

func errorResponse(statusCode int, message string, origin string) events.APIGatewayProxyResponse {
	body, _ := json.Marshal(map[string]string{"erro": message})
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}
}

func (h *LambdaHandler) handleImprimirNota(ctx context.Context, notaIDStr string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	// Validate nota ID
	notaID, err := uuid.Parse(notaIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	// Get idempotency key from headers
	chaveIdem := getHeaderValue(request.Headers, "Idempotency-Key")
	if chaveIdem == "" {
		return errorResponse(http.StatusBadRequest, "Header Idempotency-Key obrigatório", origin), nil
	}

	// Validate idempotency key format (8-256 alphanumeric chars)
	if len(chaveIdem) < 8 || len(chaveIdem) > 256 {
		return errorResponse(http.StatusBadRequest, "Idempotency-Key deve ter entre 8-256 caracteres", origin), nil
	}

	// Check if print request already exists (idempotency)
	existingSol, err := h.repo.BuscarSolicitacaoPorChave(ctx, chaveIdem)
	if err != nil {
		slog.Error("Error checking existing print request", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao verificar solicitação existente", origin), nil
	}
	if existingSol != nil {
		// Return existing request (idempotent)
		body, _ := json.Marshal(existingSol)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(origin),
			Body:       string(body),
		}, nil
	}

	// Get nota
	nota, err := h.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		slog.Error("Error fetching nota", "id", notaID, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar nota", origin), nil
	}
	if nota == nil {
		return errorResponse(http.StatusNotFound, "Nota não encontrada", origin), nil
	}

	// Validate nota is open
	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusConflict, "Nota não está aberta", origin), nil
	}

	// Check if nota has items
	if len(nota.Itens) == 0 {
		return errorResponse(http.StatusConflict, "Nota sem itens não pode ser impressa", origin), nil
	}

	// Generate PDF with nota data
	pdfBytes, err := h.pdfGenerator.GerarNotaFiscal(nota)
	if err != nil {
		slog.Error("Error generating PDF", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao gerar PDF", origin), nil
	}

	// Upload PDF to S3
	solID := uuid.New()
	pdfKey := fmt.Sprintf("notas/%s/%s.pdf", notaID.String(), solID.String())

	_, err = h.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(h.bucketName),
		Key:         aws.String(pdfKey),
		Body:        bytes.NewReader(pdfBytes),
		ContentType: aws.String("application/pdf"),
	})
	if err != nil {
		slog.Error("Error uploading PDF to S3", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao salvar PDF", origin), nil
	}

	// Create PDF URL — usa CloudFront se disponível (S3 bloqueia acesso público)
	var pdfURL string
	if h.cloudFrontDomain != "" {
		pdfURL = fmt.Sprintf("https://%s/%s", h.cloudFrontDomain, pdfKey)
	} else {
		pdfURL = fmt.Sprintf("https://%s.s3.amazonaws.com/%s", h.bucketName, pdfKey)
	}
	now := time.Now()

	sol := &dominio.SolicitacaoImpressao{
		ID:                solID,
		NotaID:            notaID,
		Status:            "CONCLUIDA",
		ChaveIdempotencia: chaveIdem,
		PdfURL:            &pdfURL,
		DataConclusao:     &now,
	}

	if err := h.repo.CriarSolicitacaoImpressao(ctx, sol); err != nil {
		slog.Error("Error creating print request", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao criar solicitação de impressão", origin), nil
	}

	// Publish event
	type itemEvento struct {
		ProdutoID  string `json:"produtoId"`
		Quantidade int    `json:"quantidade"`
	}
	type payloadEvento struct {
		NotaID string       `json:"notaId"`
		Itens  []itemEvento `json:"itens"`
	}

	var itensEvento []itemEvento
	for _, item := range nota.Itens {
		itensEvento = append(itensEvento, itemEvento{
			ProdutoID:  item.ProdutoID.String(),
			Quantidade: item.Quantidade,
		})
	}

	payload := payloadEvento{
		NotaID: notaID.String(),
		Itens:  itensEvento,
	}

	if err := h.repo.PublicarEvento(ctx, "Faturamento.ImpressaoSolicitada", notaID, payload); err != nil {
		slog.Error("Error publishing event", "error", err)
		// Don't fail the request if event publishing fails - the print request was created
	}

	body, _ := json.Marshal(sol)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusCreated,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func (h *LambdaHandler) handleSolicitacoesImpressaoRoutes(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	pathParts := strings.Split(strings.Trim(request.Path, "/"), "/")
	var solID string
	if len(pathParts) > 3 {
		solID = pathParts[3]
	}

	switch request.HTTPMethod {
	case "GET":
		if solID != "" {
			return h.handleGetSolicitacao(ctx, solID, origin)
		}
		return errorResponse(http.StatusNotFound, "Rota não encontrada", origin), nil

	default:
		return errorResponse(http.StatusMethodNotAllowed, "Method not allowed", origin), nil
	}
}

func (h *LambdaHandler) handleGetSolicitacao(ctx context.Context, solIDStr string, origin string) (events.APIGatewayProxyResponse, error) {
	solID, err := uuid.Parse(solIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	sol, err := h.repo.BuscarSolicitacaoPorID(ctx, solID)
	if err != nil {
		slog.Error("Error fetching solicitacao", "id", solID, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar solicitação", origin), nil
	}

	if sol == nil {
		return errorResponse(http.StatusNotFound, "Solicitação não encontrada", origin), nil
	}

	body, _ := json.Marshal(sol)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       string(body),
	}, nil
}

func getHeaderValue(headers map[string]string, key string) string {
	// Check both lowercase and proper case
	if val, ok := headers[strings.ToLower(key)]; ok {
		return val
	}
	if val, ok := headers[key]; ok {
		return val
	}
	return ""
}

func main() {
	handler, err := NewLambdaHandler()
	if err != nil {
		slog.Error("Failed to initialize Lambda handler", "error", err)
		panic(err)
	}

	lambda.Start(handler.HandleRequest)
}
