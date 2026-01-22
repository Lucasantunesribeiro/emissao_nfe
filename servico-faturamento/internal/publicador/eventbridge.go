package publicador

import (
	"context"
	"encoding/json"
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

	if len(result.Entries) > 0 && result.Entries[0].ErrorCode != nil {
		slog.Error("EventBridge rejected event", "errorCode", *result.Entries[0].ErrorCode, "errorMessage", *result.Entries[0].ErrorMessage)
		return err
	}

	slog.Info("Event published to EventBridge", "eventType", tipoEvento, "aggregateId", idAgregado)
	return nil
}
