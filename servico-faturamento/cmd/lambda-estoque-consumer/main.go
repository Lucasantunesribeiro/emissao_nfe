// Package main implements the estoque consumer Lambda.
// Este Lambda processa eventos SQS vindos do EventBridge quando uma nota é fechada
// e reserva o estoque de cada produto da nota de forma atômica no DynamoDB.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
	"github.com/google/uuid"

	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/repositorio"
)

// EstoqueConsumer reserva estoque para notas fechadas e publica ReservaConfirmada/ReservaFalhou
type EstoqueConsumer struct {
	repo         *repositorio.RepositorioDynamoDB
	ebClient     *eventbridge.Client
	eventBusName string
}

// NotaFechadaDetail é o payload do evento Faturamento.NotaFechada
type NotaFechadaDetail struct {
	NotaID string `json:"notaId"`
}

func NewEstoqueConsumer() (*EstoqueConsumer, error) {
	logger.Init()
	slog.Info("Initializing Estoque Consumer Lambda")

	mainTableName := os.Getenv("DYNAMODB_TABLE_NAME")
	eventsTableName := os.Getenv("DYNAMODB_EVENTS_TABLE_NAME")
	if mainTableName == "" || eventsTableName == "" {
		return nil, fmt.Errorf("DYNAMODB_TABLE_NAME and DYNAMODB_EVENTS_TABLE_NAME are required")
	}

	eventBusName := os.Getenv("EVENT_BUS_NAME")
	if eventBusName == "" {
		eventBusName = "nfe-events-dev"
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	ddbClient := dynamodb.NewFromConfig(cfg)
	repo := repositorio.NewRepositorioDynamoDB(ddbClient, mainTableName, eventsTableName)

	return &EstoqueConsumer{
		repo:         repo,
		ebClient:     eventbridge.NewFromConfig(cfg),
		eventBusName: eventBusName,
	}, nil
}

// HandleRequest processa batch de eventos SQS (EventBridge → SQS → Lambda)
func (c *EstoqueConsumer) HandleRequest(ctx context.Context, sqsEvent events.SQSEvent) (events.SQSEventResponse, error) {
	slog.Info("EstoqueConsumer triggered", "recordCount", len(sqsEvent.Records))

	var failures []events.SQSBatchItemFailure

	for _, record := range sqsEvent.Records {
		if err := c.processRecord(ctx, record); err != nil {
			slog.Error("Failed to process record", "messageId", record.MessageId, "error", err)
			failures = append(failures, events.SQSBatchItemFailure{
				ItemIdentifier: record.MessageId,
			})
		}
	}

	return events.SQSEventResponse{BatchItemFailures: failures}, nil
}

func (c *EstoqueConsumer) processRecord(ctx context.Context, record events.SQSMessage) error {
	// O body do SQS contém o evento EventBridge completo
	var eb struct {
		DetailType string          `json:"detail-type"`
		Detail     json.RawMessage `json:"detail"`
	}
	if err := json.Unmarshal([]byte(record.Body), &eb); err != nil {
		return fmt.Errorf("failed to parse SQS body: %w", err)
	}

	if eb.DetailType != "Faturamento.NotaFechada" {
		slog.Info("Ignoring event type", "detailType", eb.DetailType)
		return nil
	}

	var detail NotaFechadaDetail
	if err := json.Unmarshal(eb.Detail, &detail); err != nil {
		return fmt.Errorf("failed to parse event detail: %w", err)
	}

	notaID, err := uuid.Parse(detail.NotaID)
	if err != nil {
		return fmt.Errorf("invalid notaId: %w", err)
	}

	slog.Info("Processing nota fechada", "notaId", notaID, "messageId", record.MessageId)

	// Idempotência: verificar se já processamos este evento
	if already, _ := c.repo.MensagemJaProcessada(ctx, record.MessageId); already {
		slog.Info("Message already processed, skipping", "messageId", record.MessageId)
		return nil
	}

	// Buscar nota com itens
	nota, err := c.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		return fmt.Errorf("failed to fetch nota %s: %w", notaID, err)
	}
	if nota == nil {
		return fmt.Errorf("nota not found: %s", notaID)
	}
	if len(nota.Itens) == 0 {
		slog.Warn("Nota has no items, confirming empty reservation", "notaId", notaID)
		return c.publishEvento(ctx, "ReservaConfirmada", notaID.String(), "reserva sem itens")
	}

	// Tentar reservar estoque para cada item
	var reservados []struct {
		ProdutoID uuid.UUID
		Quantidade int
	}

	var reservaFalhou bool
	var motivoFalha string

	for _, item := range nota.Itens {
		if err := c.repo.ReservarEstoqueProduto(ctx, item.ProdutoID, item.Quantidade); err != nil {
			slog.Error("Failed to reserve stock", "produtoId", item.ProdutoID, "quantidade", item.Quantidade, "error", err)
			reservaFalhou = true
			motivoFalha = fmt.Sprintf("saldo insuficiente para produto %s", item.ProdutoID)
			break
		}
		reservados = append(reservados, struct {
			ProdutoID  uuid.UUID
			Quantidade int
		}{item.ProdutoID, item.Quantidade})
	}

	if reservaFalhou {
		// Compensação: liberar itens já reservados
		for _, r := range reservados {
			if err := c.repo.LiberarEstoqueProduto(ctx, r.ProdutoID, r.Quantidade); err != nil {
				slog.Error("Failed to release stock during compensation", "produtoId", r.ProdutoID, "error", err)
			}
		}
		// Marcar como processado ANTES de publicar (idempotência)
		_ = c.repo.MarcarMensagemProcessada(ctx, record.MessageId)
		return c.publishEvento(ctx, "ReservaFalhou", notaID.String(), motivoFalha)
	}

	// Reserva bem-sucedida
	_ = c.repo.MarcarMensagemProcessada(ctx, record.MessageId)
	slog.Info("Estoque reservado com sucesso", "notaId", notaID, "itens", len(nota.Itens))
	return c.publishEvento(ctx, "ReservaConfirmada", notaID.String(), "")
}

func (c *EstoqueConsumer) publishEvento(ctx context.Context, tipoEvento, notaID, motivo string) error {
	type reservaDetail struct {
		NotaID string `json:"notaId"`
		Motivo string `json:"motivo,omitempty"`
	}

	detail := reservaDetail{NotaID: notaID, Motivo: motivo}
	detailJSON, _ := json.Marshal(detail)

	_, err := c.ebClient.PutEvents(ctx, &eventbridge.PutEventsInput{
		Entries: []ebtypes.PutEventsRequestEntry{
			{
				EventBusName: aws.String(c.eventBusName),
				Source:       aws.String("nfe.estoque"),
				DetailType:   aws.String(tipoEvento),
				Detail:       aws.String(string(detailJSON)),
			},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to publish %s: %w", tipoEvento, err)
	}
	slog.Info("Event published", "eventType", tipoEvento, "notaId", notaID)
	return nil
}

func main() {
	consumer, err := NewEstoqueConsumer()
	if err != nil {
		slog.Error("Failed to initialize estoque consumer", "error", err)
		panic(err)
	}
	slog.Info("Estoque Consumer Lambda initialized")
	lambda.Start(consumer.HandleRequest)
}
