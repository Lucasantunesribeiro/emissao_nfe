package publicador

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge/types"
)

var ebClient *eventbridge.Client
var eventBusName string

// InicializarEventBridge inicializa o cliente EventBridge
func InicializarEventBridge() error {
	eventBusName = os.Getenv("EVENT_BUS_NAME")
	if eventBusName == "" {
		eventBusName = "nfe-events-dev"
	}

	cfg, err := config.LoadDefaultConfig(context.TODO())
	if err != nil {
		return err
	}

	ebClient = eventbridge.NewFromConfig(cfg)
	slog.Info("EventBridge client initialized", "eventBusName", eventBusName)
	return nil
}

// PublicarEvento publica um evento no EventBridge
func PublicarEvento(ctx context.Context, tipoEvento string, idAgregado string, payload interface{}) error {
	if ebClient == nil {
		return nil // Skip if not initialized
	}

	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	detail := string(payloadJSON)

	input := &eventbridge.PutEventsInput{
		Entries: []types.PutEventsRequestEntry{
			{
				EventBusName: aws.String(eventBusName),
				Source:       aws.String("nfe.faturamento"), // Deve começar com "nfe." para match das EventBridge Rules
				DetailType:   aws.String(tipoEvento),
				Detail:       aws.String(detail),
			},
		},
	}

	result, err := ebClient.PutEvents(ctx, input)
	if err != nil {
		slog.Error("Failed to publish event to EventBridge", "error", err, "eventType", tipoEvento)
		return err
	}

	// Antes retornava `err` (nil) aqui: o evento rejeitado era tratado como publicado.
	if err := VerificarResultadoPutEvents(result); err != nil {
		slog.Error("EventBridge rejected event", "error", err, "eventType", tipoEvento)
		return err
	}

	slog.Info("Event published to EventBridge", "eventType", tipoEvento, "aggregateId", idAgregado)
	return nil
}

// ErrEventoRejeitado indica que o EventBridge respondeu sem erro de transporte,
// mas rejeitou uma ou mais entradas (FailedEntryCount > 0).
var ErrEventoRejeitado = errors.New("EventBridge rejeitou o evento")

// VerificarResultadoPutEvents converte falha parcial do PutEvents em erro.
//
// PutEvents NAO retorna erro quando entradas individuais sao rejeitadas
// (throttling, erro interno, payload invalido): o resultado vem em
// FailedEntryCount e Entries[i].ErrorCode. Ignorar isso faz o chamador marcar o
// evento como publicado (outbox) ou confirmar a mensagem SQS, perdendo o evento.
func VerificarResultadoPutEvents(out *eventbridge.PutEventsOutput) error {
	if out == nil {
		return fmt.Errorf("%w: resposta vazia", ErrEventoRejeitado)
	}
	if out.FailedEntryCount == 0 {
		return nil
	}
	for _, e := range out.Entries {
		if e.ErrorCode != nil {
			return fmt.Errorf("%w: %s: %s", ErrEventoRejeitado, aws.ToString(e.ErrorCode), aws.ToString(e.ErrorMessage))
		}
	}
	return fmt.Errorf("%w: %d entrada(s) com falha", ErrEventoRejeitado, out.FailedEntryCount)
}
