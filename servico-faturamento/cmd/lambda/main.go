package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/repositorio"
)

// LambdaHandler processa requisições de API Gateway e eventos SQS
type LambdaHandler struct {
	repo *repositorio.RepositorioDynamoDB
}

// NewLambdaHandler cria o handler com DynamoDB
func NewLambdaHandler() (*LambdaHandler, error) {
	logger.Init()
	slog.Info("Initializing Lambda handler with DynamoDB")

	mainTableName := os.Getenv("DYNAMODB_TABLE_NAME")
	eventsTableName := os.Getenv("DYNAMODB_EVENTS_TABLE_NAME")
	if mainTableName == "" || eventsTableName == "" {
		return nil, fmt.Errorf("DYNAMODB_TABLE_NAME and DYNAMODB_EVENTS_TABLE_NAME are required")
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	repo := repositorio.NewRepositorioDynamoDB(ddbClient, mainTableName, eventsTableName)

	slog.Info("Lambda handler initialized", "mainTable", mainTableName, "eventsTable", eventsTableName)
	return &LambdaHandler{repo: repo}, nil
}

// HandleRequest processa requisições API Gateway
func (h *LambdaHandler) HandleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	slog.Info("Lambda invoked", "method", request.HTTPMethod, "path", request.Path)

	origin := getHeaderValue(request.Headers, "Origin")

	if request.HTTPMethod == "OPTIONS" {
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNoContent,
			Headers:    corsHeaders(origin),
			Body:       "",
		}, nil
	}

	if (request.Path == "/health" || request.Path == "/api/v1/health") && request.HTTPMethod == "GET" {
		return h.handleHealthCheck(origin)
	}

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

// HandleSQSEvent processa eventos SQS da saga (ReservaConfirmada, ReservaFalhou)
func (h *LambdaHandler) HandleSQSEvent(ctx context.Context, sqsEvent events.SQSEvent) error {
	slog.Info("SQS event received", "recordCount", len(sqsEvent.Records))

	for _, record := range sqsEvent.Records {
		// O body do SQS contém o evento EventBridge completo
		var eb struct {
			DetailType string          `json:"detail-type"`
			Detail     json.RawMessage `json:"detail"`
		}
		if err := json.Unmarshal([]byte(record.Body), &eb); err != nil {
			slog.Error("Failed to parse SQS record body", "messageId", record.MessageId, "error", err)
			continue
		}

		var detail struct {
			NotaID string `json:"notaId"`
			Motivo string `json:"motivo"`
		}
		_ = json.Unmarshal(eb.Detail, &detail)

		switch eb.DetailType {
		case "ReservaConfirmada":
			slog.Info("Reserva confirmada — atualizando nota", "notaId", detail.NotaID)
			if notaID, err := uuid.Parse(detail.NotaID); err == nil {
				if err := h.repo.AtualizarStatusNota(ctx, notaID, dominio.StatusNotaReservada); err != nil {
					slog.Error("Failed to update nota to RESERVADA", "notaId", notaID, "error", err)
				}
			}

		case "ReservaFalhou":
			slog.Warn("Reserva falhou — cancelando nota", "notaId", detail.NotaID, "motivo", detail.Motivo)
			if notaID, err := uuid.Parse(detail.NotaID); err == nil {
				if err := h.repo.AtualizarStatusNota(ctx, notaID, dominio.StatusNotaCancelada); err != nil {
					slog.Error("Failed to update nota to CANCELADA", "notaId", notaID, "error", err)
				}
			}

		default:
			slog.Warn("Unknown SQS event type", "detailType", eb.DetailType, "messageId", record.MessageId)
		}
	}
	return nil
}

func (h *LambdaHandler) handleHealthCheck(origin string) (events.APIGatewayProxyResponse, error) {
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       `{"status":"healthy","service":"faturamento","database":"dynamodb","version":"3.0.0"}`,
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

// handleImprimirNota inicia o processo assíncrono de geração de PDF
func (h *LambdaHandler) handleImprimirNota(ctx context.Context, notaIDStr string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	notaID, err := uuid.Parse(notaIDStr)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID inválido", origin), nil
	}

	chaveIdem := getHeaderValue(request.Headers, "Idempotency-Key")
	if chaveIdem == "" {
		return errorResponse(http.StatusBadRequest, "Header Idempotency-Key obrigatório", origin), nil
	}
	if len(chaveIdem) < 8 || len(chaveIdem) > 256 {
		return errorResponse(http.StatusBadRequest, "Idempotency-Key deve ter entre 8-256 caracteres", origin), nil
	}

	// Idempotência: retornar solicitação existente se já criada
	existingSol, err := h.repo.BuscarSolicitacaoPorChave(ctx, chaveIdem)
	if err != nil {
		slog.Error("Error checking existing print request", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao verificar solicitação existente", origin), nil
	}
	if existingSol != nil {
		body, _ := json.Marshal(existingSol)
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusOK,
			Headers:    corsHeaders(origin),
			Body:       string(body),
		}, nil
	}

	nota, err := h.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		slog.Error("Error fetching nota", "id", notaID, "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao buscar nota", origin), nil
	}
	if nota == nil {
		return errorResponse(http.StatusNotFound, "Nota não encontrada", origin), nil
	}
	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusConflict, "Nota não está aberta", origin), nil
	}
	if len(nota.Itens) == 0 {
		return errorResponse(http.StatusConflict, "Nota sem itens não pode ser impressa", origin), nil
	}

	// Criar SolicitacaoImpressao com status PENDENTE
	solID := uuid.New()
	sol := &dominio.SolicitacaoImpressao{
		ID:                solID,
		NotaID:            notaID,
		Status:            "PENDENTE",
		ChaveIdempotencia: chaveIdem,
	}

	if err := h.repo.CriarSolicitacaoImpressao(ctx, sol); err != nil {
		slog.Error("Error creating print request", "error", err)
		return errorResponse(http.StatusInternalServerError, "Erro ao criar solicitação de impressão", origin), nil
	}

	// Publicar evento no outbox → PDF Lambda gerará o PDF de forma assíncrona
	type payloadEvento struct {
		NotaID        string `json:"notaId"`
		SolicitacaoID string `json:"solicitacaoId"`
	}
	payload := payloadEvento{
		NotaID:        notaID.String(),
		SolicitacaoID: solID.String(),
	}

	if err := h.repo.PublicarEvento(ctx, "Faturamento.ImpressaoSolicitada", notaID, payload); err != nil {
		slog.Error("Error publishing print event", "error", err)
		// Não falha a request — a solicitação foi criada; o usuário pode checar o status
	}

	slog.Info("Print request created (async)", "solicitacaoId", solID, "notaId", notaID)

	body, _ := json.Marshal(sol)
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusAccepted, // 202 — processamento assíncrono
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

	if request.HTTPMethod == "GET" && solID != "" {
		return h.handleGetSolicitacao(ctx, solID, origin)
	}
	return errorResponse(http.StatusNotFound, "Rota não encontrada", origin), nil
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

// Helper functions

func corsHeaders(origin string) map[string]string {
	allowedOrigins := []string{
		"http://localhost:4200",
		"http://localhost:8080",
	}

	cloudFrontDomain := os.Getenv("CLOUDFRONT_DOMAIN")
	if cloudFrontDomain != "" {
		allowedOrigins = append(allowedOrigins, "https://"+cloudFrontDomain)
	}

	allowOrigin := ""
	for _, allowed := range allowedOrigins {
		if origin == allowed || strings.HasSuffix(origin, ".cloudfront.net") {
			allowOrigin = origin
			break
		}
	}
	if allowOrigin == "" {
		allowOrigin = allowedOrigins[0]
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

func getHeaderValue(headers map[string]string, key string) string {
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

	// Multiplex: detecta SQS vs API Gateway pelo campo Records[].eventSource
	lambda.Start(func(ctx context.Context, rawEvent json.RawMessage) (interface{}, error) {
		var probe struct {
			Records []struct {
				EventSource string `json:"eventSource"`
			} `json:"Records"`
		}
		if json.Unmarshal(rawEvent, &probe) == nil &&
			len(probe.Records) > 0 &&
			probe.Records[0].EventSource == "aws:sqs" {
			var sqsEvent events.SQSEvent
			if err := json.Unmarshal(rawEvent, &sqsEvent); err != nil {
				return nil, err
			}
			return nil, handler.HandleSQSEvent(ctx, sqsEvent)
		}

		var apiEvent events.APIGatewayProxyRequest
		if err := json.Unmarshal(rawEvent, &apiEvent); err != nil {
			return nil, err
		}
		return handler.HandleRequest(ctx, apiEvent)
	})
}
