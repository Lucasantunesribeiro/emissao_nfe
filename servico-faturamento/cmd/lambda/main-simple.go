package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

// Versão SIMPLIFICADA do Lambda Faturamento para diagnóstico
// Remove TODA a lógica de DB, GORM, handlers complexos
// Apenas retorna respostas CORS corretas e health check

func main() {
	slog.Info("Lambda Faturamento SIMPLIFICADO iniciando...")
	lambda.Start(handleRequest)
}

func handleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	slog.Info("Request recebido", "method", request.HTTPMethod, "path", request.Path)

	// Obter origem para CORS
	origin := getHeaderValue(request.Headers, "Origin")

	// Health check
	if request.Path == "/health" || request.Path == "/dev/health" {
		return jsonResponse(200, map[string]interface{}{
			"status":      "healthy",
			"service":     "faturamento-simplificado",
			"environment": os.Getenv("ENVIRONMENT"),
			"message":     "Lambda funcionando SEM banco de dados (versão diagnóstico)",
		}, origin)
	}

	// GET /api/v1/notas - Lista vazia
	if request.Path == "/api/v1/notas" || request.Path == "/dev/api/v1/notas" {
		if request.HTTPMethod == "GET" {
			return jsonResponse(200, []map[string]interface{}{}, origin)
		}

		// POST - Retorna mock
		if request.HTTPMethod == "POST" {
			return jsonResponse(201, map[string]interface{}{
				"id":      "mock-123",
				"cliente": "Mock Cliente",
				"status":  "PENDENTE",
				"message": "Nota fiscal MOCK criada (sem persistência)",
			}, origin)
		}
	}

	// GET /api/v1/notas/{id} - Mock
	if strings.HasPrefix(request.Path, "/api/v1/notas/") || strings.HasPrefix(request.Path, "/dev/api/v1/notas/") {
		return jsonResponse(200, map[string]interface{}{
			"id":      "mock-123",
			"cliente": "Mock Cliente",
			"status":  "PENDENTE",
			"itens":   []map[string]interface{}{},
		}, origin)
	}

	// Rota não encontrada
	return jsonResponse(404, map[string]string{
		"error": "Rota não encontrada",
		"path":  request.Path,
	}, origin)
}

func jsonResponse(statusCode int, body interface{}, origin string) (events.APIGatewayProxyResponse, error) {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		slog.Error("Erro ao serializar JSON", "error", err)
		return events.APIGatewayProxyResponse{
			StatusCode: 500,
			Headers:    corsHeaders(origin),
			Body:       `{"error":"Internal server error"}`,
		}, nil
	}

	return events.APIGatewayProxyResponse{
		StatusCode: statusCode,
		Headers:    corsHeaders(origin),
		Body:       string(jsonBody),
	}, nil
}

func corsHeaders(origin string) map[string]string {
	return map[string]string{
		"Content-Type":                 "application/json",
		"Access-Control-Allow-Origin":  resolveCorsOrigin(origin),
		"Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-Id,Idempotency-Key",
		"Access-Control-Allow-Credentials": "true",
	}
}

func resolveCorsOrigin(origin string) string {
	corsOrigins := strings.TrimSpace(os.Getenv("CORS_ORIGINS"))
	if corsOrigins == "" {
		slog.Warn("SECURITY: CORS_ORIGINS não configurado. Retornando origem vazia.")
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
		slog.Warn("SECURITY: CORS_ORIGINS vazio. Retornando origem vazia.")
		return ""
	}

	// Validar origem contra lista permitida
	for _, allowed := range normalized {
		if strings.EqualFold(allowed, origin) {
			slog.Info("CORS: Origem permitida", "origin", origin)
			return origin
		}
	}

	// Origem não permitida
	slog.Warn("SECURITY: Origem bloqueada", "origin", origin, "allowed", normalized)
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
