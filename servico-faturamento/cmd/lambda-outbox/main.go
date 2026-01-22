package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"gorm.io/gorm"

	appConfig "servico-faturamento/internal/config"
	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/publicador"
)

// OutboxProcessor processa eventos pendentes na tabela outbox
type OutboxProcessor struct {
	db *gorm.DB
}

func NewOutboxProcessor() (*OutboxProcessor, error) {
	// Initialize logger
	logger.Init()
	slog.Info("Initializing outbox processor for EventBridge")

	// Initialize database connection
	db, err := appConfig.InicializarDB()
	if err != nil {
		return nil, err
	}

	// Initialize EventBridge client (serverless)
	if err := publicador.InicializarEventBridge(); err != nil {
		slog.Error("Failed to initialize EventBridge", "error", err)
		return nil, err
	}

	return &OutboxProcessor{
		db: db,
	}, nil
}

// HandleRequest é chamado pelo EventBridge Schedule (a cada 1 minuto)
func (p *OutboxProcessor) HandleRequest(ctx context.Context) error {
	slog.Info("Outbox processor triggered - processing pending events")

	// Buscar eventos pendentes (não publicados)
	var eventos []dominio.EventoOutbox
	if err := p.db.Where("data_publicacao IS NULL").Order("id").Limit(50).Find(&eventos).Error; err != nil {
		slog.Error("Failed to load pending events from outbox", "error", err)
		return err
	}

	if len(eventos) == 0 {
		slog.Info("No pending events to process")
		return nil
	}

	slog.Info("Found pending events", "count", len(eventos))

	// Processar cada evento
	successCount := 0
	errorCount := 0

	for _, evt := range eventos {
		// Deserializar payload (é uma string JSON, precisa virar objeto)
		var payloadObj interface{}
		if err := json.Unmarshal([]byte(evt.Payload), &payloadObj); err != nil {
			slog.Error("Failed to unmarshal event payload",
				"eventId", evt.ID,
				"error", err)
			errorCount++
			continue
		}

		// Publicar evento no EventBridge
		err := publicador.PublicarEvento(ctx, evt.TipoEvento, evt.IdAgregado.String(), payloadObj)
		if err != nil {
			slog.Error("Failed to publish event to EventBridge",
				"eventId", evt.ID,
				"eventType", evt.TipoEvento,
				"error", err)
			errorCount++
			continue
		}

		// Marcar como publicado
		now := time.Now()
		if err := p.db.Model(&dominio.EventoOutbox{}).
			Where("id = ?", evt.ID).
			Update("data_publicacao", now).Error; err != nil {
			slog.Error("Event published but failed to update data_publicacao",
				"eventId", evt.ID,
				"error", err)
			errorCount++
			continue
		}

		slog.Info("Event published successfully to EventBridge",
			"eventId", evt.ID,
			"eventType", evt.TipoEvento,
			"aggregateId", evt.IdAgregado)
		successCount++
	}

	slog.Info("Outbox processing completed",
		"success", successCount,
		"errors", errorCount,
		"total", len(eventos))

	return nil
}

func main() {
	processor, err := NewOutboxProcessor()
	if err != nil {
		slog.Error("Failed to initialize outbox processor", "error", err)
		panic(err)
	}

	slog.Info("Outbox processor initialized successfully for serverless (EventBridge)")
	lambda.Start(processor.HandleRequest)
}
