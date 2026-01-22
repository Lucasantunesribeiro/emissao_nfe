package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"

	// Importar packages do próprio serviço
	appConfig "servico-faturamento/internal/config"
	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/manipulador"
	"servico-faturamento/internal/publicador"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// LambdaHandler é o handler principal do Lambda que recebe requests do API Gateway
type LambdaHandler struct {
	handlers *manipulador.Handlers
}

func NewLambdaHandler() (*LambdaHandler, error) {
	// Initialize logger
	logger.Init()
	slog.Info("Initializing Lambda handler")

	// Initialize database connection using existing config
	db, err := appConfig.InicializarDB()
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	// Initialize handlers
	handlers := &manipulador.Handlers{DB: db}

	// Initialize EventBridge publisher (for serverless mode)
	if err := publicador.InicializarEventBridge(); err != nil {
		slog.Error("Failed to initialize EventBridge", "error", err)
		// Don't fail, just log
	}

	// Initialize outbox publisher (RabbitMQ - disabled in serverless)
	if err := publicador.IniciarPublicador(db); err != nil {
		slog.Error("Failed to start outbox publisher", "error", err)
		// Don't fail, just log
	}

	return &LambdaHandler{
		handlers: handlers,
	}, nil
}

// HandleRequest é chamado pelo AWS Lambda para cada invocação
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

	// Health check
	if request.Path == "/health" && request.HTTPMethod == "GET" {
		return h.handleHealthCheck(ctx, origin)
	}

	// Router baseado em path e method
	switch {
	case strings.HasPrefix(request.Path, "/api/v1/notas"):
		return h.handleNotasRoutes(ctx, request, origin)
	case strings.HasPrefix(request.Path, "/api/v1/solicitacoes-impressao"):
		return h.handleSolicitacoesRoutes(ctx, request, origin)
	default:
		return events.APIGatewayProxyResponse{
			StatusCode: http.StatusNotFound,
			Headers:    corsHeaders(origin),
			Body:       `{"erro":"Not Found","message":"Not Found"}`,
		}, nil
	}
}

func (h *LambdaHandler) handleHealthCheck(ctx context.Context, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	return events.APIGatewayProxyResponse{
		StatusCode: http.StatusOK,
		Headers:    corsHeaders(origin),
		Body:       `{"status":"healthy","service":"faturamento","version":"1.0.0"}`,
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
		return h.handleUpdateNota(ctx, notaID, request, origin)

	default:
		return errorResponse(http.StatusMethodNotAllowed, "Method not allowed", origin), nil
	}
}

func (h *LambdaHandler) handleGetNota(ctx context.Context, notaID string, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	var nota dominio.NotaFiscal

	if err := h.handlers.DB.Preload("Itens").First(&nota, "id = ?", notaID).Error; err != nil {
		slog.Error("Error getting nota", "error", err, "id", notaID)
		return errorResponse(http.StatusNotFound, "Nota not found", origin), nil
	}

	return jsonResponse(http.StatusOK, nota, origin), nil
}

func (h *LambdaHandler) handleListNotas(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	var notas []dominio.NotaFiscal

	query := h.handlers.DB.Preload("Itens")

	if status := request.QueryStringParameters["status"]; status != "" {
		query = query.Where("status = ?", status)
	}

	if err := query.Find(&notas).Error; err != nil {
		slog.Error("Error listing notas", "error", err)
		return errorResponse(http.StatusInternalServerError, "Failed to list notas", origin), nil
	}

	return jsonResponse(http.StatusOK, notas, origin), nil
}

func (h *LambdaHandler) handleCreateNota(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	var req struct {
		Numero   string `json:"numero"`
		Cliente  string `json:"cliente"`
		Produtos []struct {
			SKU            string  `json:"sku"`
			Quantidade     int     `json:"quantidade"`
			PrecoUnitario  float64 `json:"precoUnitario"`
		} `json:"produtos"`
	}

	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON", origin), nil
	}

	if strings.TrimSpace(req.Numero) == "" {
		return errorResponse(http.StatusBadRequest, "Numero obrigatório", origin), nil
	}

	nota := dominio.NotaFiscal{
		Numero: req.Numero,
		Status: dominio.StatusNotaAberta,
	}

	if err := h.handlers.DB.Create(&nota).Error; err != nil {
		slog.Error("Error creating nota", "error", err)
		return errorResponse(http.StatusInternalServerError, "Failed to create nota", origin), nil
	}

	// Se produtos foram enviados, publicar evento para reserva de estoque
	if len(req.Produtos) > 0 {
		type itemEvento struct {
			SKU        string `json:"sku"`
			Quantidade int    `json:"quantidade"`
		}

		type payloadEvento struct {
			NotaID  string       `json:"notaId"`
			Cliente string       `json:"cliente"`
			Itens   []itemEvento `json:"itens"`
		}

		var itensEvento []itemEvento
		for _, prod := range req.Produtos {
			itensEvento = append(itensEvento, itemEvento{
				SKU:        prod.SKU,
				Quantidade: prod.Quantidade,
			})
		}

		payload := payloadEvento{
			NotaID:  nota.ID.String(),
			Cliente: req.Cliente,
			Itens:   itensEvento,
		}

		if err := publicador.PublicarEvento(ctx, "NotaFiscalCriada", nota.ID.String(), payload); err != nil {
			slog.Warn("Failed to publish event to EventBridge", "error", err, "notaId", nota.ID)
		} else {
			slog.Info("Event published to EventBridge", "eventType", "NotaFiscalCriada", "notaId", nota.ID)
		}
	}

	return jsonResponse(http.StatusCreated, nota, origin), nil
}

func (h *LambdaHandler) handleUpdateNota(ctx context.Context, notaID string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	var nota dominio.NotaFiscal

	if err := json.Unmarshal([]byte(request.Body), &nota); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON", origin), nil
	}

	if err := h.handlers.DB.Model(&nota).Where("id = ?", notaID).Updates(&nota).Error; err != nil {
		slog.Error("Error updating nota", "error", err, "id", notaID)
		return errorResponse(http.StatusInternalServerError, "Failed to update nota", origin), nil
	}

	return jsonResponse(http.StatusOK, nota, origin), nil
}

func (h *LambdaHandler) handleFecharNota(ctx context.Context, notaID string, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	id, err := uuid.Parse(notaID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID invalido", origin), nil
	}

	if err := h.handlers.FecharNota(id); err != nil {
		errMsg := err.Error()
		if errMsg == "nota deve ter status ABERTA para ser fechada" {
			return errorResponse(http.StatusBadRequest, "Nota ja esta fechada ou com status invalido", origin), nil
		}
		if errMsg == "nota deve ter pelo menos 1 item para ser fechada" {
			return errorResponse(http.StatusBadRequest, "Nota precisa ter itens antes de ser fechada", origin), nil
		}
		slog.Error("Error closing nota", "error", err, "id", notaID)
		return errorResponse(http.StatusInternalServerError, "Falha ao fechar nota", origin), nil
	}

	return jsonResponse(http.StatusOK, map[string]string{"mensagem": "Nota fechada com sucesso"}, origin), nil
}

func (h *LambdaHandler) handleSolicitacoesRoutes(ctx context.Context, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	if request.HTTPMethod != "GET" {
		return errorResponse(http.StatusMethodNotAllowed, "Method not allowed", origin), nil
	}

	pathParts := strings.Split(strings.Trim(request.Path, "/"), "/")
	if len(pathParts) < 4 {
		return errorResponse(http.StatusBadRequest, "Solicitacao ID required", origin), nil
	}

	solicitacaoID := pathParts[3]
	return h.handleConsultarStatusImpressao(ctx, solicitacaoID, origin)
}

func (h *LambdaHandler) handleConsultarStatusImpressao(ctx context.Context, solicitacaoID string, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	id, err := uuid.Parse(solicitacaoID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ID invalido", origin), nil
	}

	var sol dominio.SolicitacaoImpressao
	if err := h.handlers.DB.First(&sol, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errorResponse(http.StatusNotFound, "Solicitacao nao encontrada", origin), nil
		}
		return errorResponse(http.StatusInternalServerError, "Falha ao buscar solicitacao", origin), nil
	}

	return jsonResponse(http.StatusOK, sol, origin), nil
}

func (h *LambdaHandler) handleAddItem(ctx context.Context, notaID string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	_ = ctx
	notaUUID, err := uuid.Parse(notaID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "Nota ID invalido", origin), nil
	}

	var req struct {
		ProdutoID     string  `json:"produtoId"`
		Quantidade    int     `json:"quantidade"`
		PrecoUnitario float64 `json:"precoUnitario"`
	}

	if err := json.Unmarshal([]byte(request.Body), &req); err != nil {
		return errorResponse(http.StatusBadRequest, "Invalid JSON", origin), nil
	}

	if strings.TrimSpace(req.ProdutoID) == "" || req.Quantidade < 1 {
		return errorResponse(http.StatusBadRequest, "ProdutoId e Quantidade sao obrigatorios", origin), nil
	}

	prodID, err := uuid.Parse(req.ProdutoID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "ProdutoId invalido", origin), nil
	}

	if req.PrecoUnitario < 0 {
		return errorResponse(http.StatusBadRequest, "Preco unitario invalido", origin), nil
	}

	var nota dominio.NotaFiscal
	if err := h.handlers.DB.First(&nota, "id = ?", notaUUID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errorResponse(http.StatusNotFound, "Nota nao encontrada", origin), nil
		}
		return errorResponse(http.StatusInternalServerError, "Falha ao buscar nota", origin), nil
	}

	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusConflict, "Nota nao esta aberta", origin), nil
	}

	item := dominio.ItemNota{
		NotaID:        notaUUID,
		ProdutoID:     prodID,
		Quantidade:    req.Quantidade,
		PrecoUnitario: req.PrecoUnitario,
	}

	if err := h.handlers.DB.Create(&item).Error; err != nil {
		return errorResponse(http.StatusInternalServerError, "Falha ao adicionar item", origin), nil
	}

	return jsonResponse(http.StatusCreated, item, origin), nil
}

func (h *LambdaHandler) handleImprimirNota(ctx context.Context, notaID string, request events.APIGatewayProxyRequest, origin string) (events.APIGatewayProxyResponse, error) {
	notaUUID, err := uuid.Parse(notaID)
	if err != nil {
		return errorResponse(http.StatusBadRequest, "Nota ID invalido", origin), nil
	}

	chaveIdem := getHeaderValue(request.Headers, "Idempotency-Key")
	if strings.TrimSpace(chaveIdem) == "" {
		return errorResponse(http.StatusBadRequest, "Header Idempotency-Key obrigatorio", origin), nil
	}

	var solExistente dominio.SolicitacaoImpressao
	if err := h.handlers.DB.Where("chave_idempotencia = ?", chaveIdem).First(&solExistente).Error; err == nil {
		return jsonResponse(http.StatusOK, solExistente, origin), nil
	}

	var nota dominio.NotaFiscal
	if err := h.handlers.DB.First(&nota, "id = ?", notaUUID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errorResponse(http.StatusNotFound, "Nota nao encontrada", origin), nil
		}
		return errorResponse(http.StatusInternalServerError, "Falha ao buscar nota", origin), nil
	}

	if nota.Status != dominio.StatusNotaAberta {
		return errorResponse(http.StatusConflict, "Nota nao esta aberta", origin), nil
	}

	var itens []dominio.ItemNota
	if err := h.handlers.DB.Where("nota_id = ?", notaUUID).Find(&itens).Error; err != nil {
		return errorResponse(http.StatusInternalServerError, "Falha ao buscar itens", origin), nil
	}

	if len(itens) == 0 {
		return errorResponse(http.StatusConflict, "Nota sem itens nao pode ser impressa", origin), nil
	}

	err = h.handlers.DB.Transaction(func(tx *gorm.DB) error {
		sol := dominio.SolicitacaoImpressao{
			NotaID:            notaUUID,
			Status:            "PENDENTE",
			ChaveIdempotencia: chaveIdem,
		}

		if err := tx.Create(&sol).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				return nil
			}
			return err
		}

		type itemEvento struct {
			ProdutoID  string `json:"produtoId"`
			Quantidade int    `json:"quantidade"`
		}

		type payloadEvento struct {
			NotaID string       `json:"notaId"`
			Itens  []itemEvento `json:"itens"`
		}

		var itensEvento []itemEvento
		for _, item := range itens {
			itensEvento = append(itensEvento, itemEvento{
				ProdutoID:  item.ProdutoID.String(),
				Quantidade: item.Quantidade,
			})
		}

		payload := payloadEvento{
			NotaID: notaUUID.String(),
			Itens:  itensEvento,
		}

		payloadJSON, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("falha ao serializar payload: %w", err)
		}

		eventoOutbox := dominio.EventoOutbox{
			TipoEvento:     "Faturamento.ImpressaoSolicitada",
			IdAgregado:     notaUUID,
			Payload:        string(payloadJSON),
			DataOcorrencia: time.Now(),
		}

		if err := tx.Create(&eventoOutbox).Error; err != nil {
			return fmt.Errorf("falha ao criar evento outbox: %w", err)
		}

		if err := publicador.PublicarEvento(ctx, eventoOutbox.TipoEvento, notaUUID.String(), payload); err != nil {
			slog.Warn("Failed to publish event to EventBridge", "error", err)
		}

		return nil
	})

	if err != nil {
		return errorResponse(http.StatusInternalServerError, "Falha ao processar impressao", origin), nil
	}

	var solCriada dominio.SolicitacaoImpressao
	if err := h.handlers.DB.Where("chave_idempotencia = ?", chaveIdem).First(&solCriada).Error; err != nil {
		return errorResponse(http.StatusInternalServerError, "Falha ao buscar solicitacao", origin), nil
	}

	return jsonResponse(http.StatusCreated, solCriada, origin), nil
}

// Helper functions

func jsonResponse(statusCode int, body interface{}, origin string) events.APIGatewayProxyResponse {
	jsonBody, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(origin),
		Body:       string(jsonBody),
	}
}

func errorResponse(statusCode int, message string, origin string) events.APIGatewayProxyResponse {
	body := map[string]string{
		"erro":    message,
		"message": message,
	}
	jsonBody, _ := json.Marshal(body)
	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(origin),
		Body:       string(jsonBody),
	}
}

func corsHeaders(origin string) map[string]string {
	return map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  resolveCorsOrigin(origin),
		"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id,Idempotency-Key",
	}
}

func resolveCorsOrigin(origin string) string {
	corsOrigins := strings.TrimSpace(os.Getenv("CORS_ORIGINS"))
	if corsOrigins == "" {
		slog.Warn("SECURITY: CORS_ORIGINS não configurado. Bloqueando todas as origens.")
		return ""
	}

	origins := strings.Split(corsOrigins, ",")
	normalized := make([]string, 0, len(origins))
	for _, entry := range origins {
		value := strings.TrimSpace(entry)
		if value != "" && value != "*" {
			normalized = append(normalized, value)
		}
	}

	if len(normalized) == 0 {
		slog.Warn("SECURITY: CORS_ORIGINS vazio ou contém apenas '*'. Bloqueando todas as origens.")
		return ""
	}

	// Validar origem contra lista permitida
	for _, allowed := range normalized {
		if strings.EqualFold(allowed, origin) {
			return origin
		}
	}

	// Origem não permitida
	slog.Warn("SECURITY: Origem não permitida bloqueada", "origin", origin, "allowed", normalized)
	return ""
}

func getHeaderValue(headers map[string]string, key string) string {
	for k, v := range headers {
		if strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

func main() {
	handler, err := NewLambdaHandler()
	if err != nil {
		slog.Error("Failed to initialize Lambda handler", "error", err)
		panic(err)
	}

	slog.Info("Lambda handler initialized successfully")
	lambda.Start(handler.HandleRequest)
}
