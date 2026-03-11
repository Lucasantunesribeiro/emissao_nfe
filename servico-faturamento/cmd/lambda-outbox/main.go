package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	ebtypes "github.com/aws/aws-sdk-go-v2/service/eventbridge/types"

	"servico-faturamento/internal/logger"
)

// OutboxProcessor lê eventos da tabela DynamoDB e publica no EventBridge
type OutboxProcessor struct {
	ddbClient       *dynamodb.Client
	ebClient        *eventbridge.Client
	eventsTableName string
	eventBusName    string
}

func NewOutboxProcessor() (*OutboxProcessor, error) {
	logger.Init()
	slog.Info("Initializing DynamoDB Outbox Processor")

	eventsTableName := os.Getenv("DYNAMODB_EVENTS_TABLE_NAME")
	if eventsTableName == "" {
		return nil, fmt.Errorf("DYNAMODB_EVENTS_TABLE_NAME is required")
	}

	eventBusName := os.Getenv("EVENT_BUS_NAME")
	if eventBusName == "" {
		eventBusName = "nfe-events-dev"
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.TODO())
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	return &OutboxProcessor{
		ddbClient:       dynamodb.NewFromConfig(cfg),
		ebClient:        eventbridge.NewFromConfig(cfg),
		eventsTableName: eventsTableName,
		eventBusName:    eventBusName,
	}, nil
}

// HandleRequest é chamado pelo EventBridge Schedule (a cada 1 minuto)
func (p *OutboxProcessor) HandleRequest(ctx context.Context) error {
	slog.Info("Outbox processor triggered")

	// Scan for events not yet published (no data_publicacao attribute)
	result, err := p.ddbClient.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(p.eventsTableName),
		FilterExpression: aws.String("begins_with(PK, :prefix) AND attribute_not_exists(data_publicacao)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":prefix": &types.AttributeValueMemberS{Value: "OUTBOX#"},
		},
		Limit: aws.Int32(50),
	})
	if err != nil {
		return fmt.Errorf("failed to scan outbox: %w", err)
	}

	if len(result.Items) == 0 {
		slog.Info("No pending outbox events")
		return nil
	}

	slog.Info("Processing outbox events", "count", len(result.Items))
	success, errs := 0, 0

	for _, item := range result.Items {
		pk := strAttr(item, "PK")
		sk := strAttr(item, "SK")

		// Support both naming conventions used in the codebase
		tipoEvento := strAttr(item, "tipo_evento")
		if tipoEvento == "" {
			tipoEvento = strAttr(item, "TipoEvento")
		}
		payload := strAttr(item, "payload")
		if payload == "" {
			payload = strAttr(item, "Payload")
		}
		if payload == "" {
			payload = "{}"
		}

		if tipoEvento == "" {
			slog.Error("Event missing tipo_evento, skipping", "pk", pk, "sk", sk)
			errs++
			continue
		}

		// Deserialize payload to re-serialize (ensures valid JSON)
		var payloadObj interface{}
		if err := json.Unmarshal([]byte(payload), &payloadObj); err != nil {
			slog.Error("Failed to parse event payload", "pk", pk, "error", err)
			errs++
			continue
		}
		payloadJSON, _ := json.Marshal(payloadObj)

		// Publish to EventBridge
		_, err := p.ebClient.PutEvents(ctx, &eventbridge.PutEventsInput{
			Entries: []ebtypes.PutEventsRequestEntry{
				{
					EventBusName: aws.String(p.eventBusName),
					Source:       aws.String("nfe.faturamento"),
					DetailType:   aws.String(tipoEvento),
					Detail:       aws.String(string(payloadJSON)),
				},
			},
		})
		if err != nil {
			slog.Error("Failed to publish event to EventBridge", "pk", pk, "eventType", tipoEvento, "error", err)
			errs++
			continue
		}

		// Mark as published
		now := time.Now().Format(time.RFC3339)
		_, err = p.ddbClient.UpdateItem(ctx, &dynamodb.UpdateItemInput{
			TableName: aws.String(p.eventsTableName),
			Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: pk},
				"SK": &types.AttributeValueMemberS{Value: sk},
			},
			UpdateExpression: aws.String("SET data_publicacao = :now"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":now": &types.AttributeValueMemberS{Value: now},
			},
		})
		if err != nil {
			slog.Error("Event published but failed to mark in DynamoDB", "pk", pk, "error", err)
			errs++
			continue
		}

		slog.Info("Event published successfully", "eventType", tipoEvento, "pk", pk)
		success++
	}

	slog.Info("Outbox processing complete", "success", success, "errors", errs, "total", len(result.Items))
	return nil
}

func strAttr(item map[string]types.AttributeValue, key string) string {
	if attr, ok := item[key]; ok {
		if s, ok := attr.(*types.AttributeValueMemberS); ok {
			return s.Value
		}
	}
	return ""
}

func main() {
	processor, err := NewOutboxProcessor()
	if err != nil {
		slog.Error("Failed to initialize outbox processor", "error", err)
		panic(err)
	}
	slog.Info("DynamoDB Outbox Processor initialized successfully")
	lambda.Start(processor.HandleRequest)
}
