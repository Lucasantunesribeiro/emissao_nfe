package main

import (
	"bytes"
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
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"

	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/observability"
	"servico-faturamento/internal/pdf"
	"servico-faturamento/internal/repositorio"
)

// PDFGenerator processa eventos EventBridge e gera PDFs de forma assíncrona
type PDFGenerator struct {
	repo             *repositorio.RepositorioDynamoDB
	s3Client         *s3.Client
	pdfGen           *pdf.GeradorPDF
	bucketName       string
	cloudFrontDomain string
}

// EventPayload é o detail do evento Faturamento.ImpressaoSolicitada
type EventPayload struct {
	NotaID        string `json:"notaId"`
	SolicitacaoID string `json:"solicitacaoId"`
	CorrelationID string `json:"correlationId,omitempty"`
}

func NewPDFGenerator() (*PDFGenerator, error) {
	logger.Init()
	slog.Info("Initializing PDF Generator Lambda (DynamoDB)")

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

	bucketName := os.Getenv("PDF_BUCKET_NAME")
	if bucketName == "" {
		bucketName = "nfe-pdfs-mock"
	}

	return &PDFGenerator{
		repo:             repo,
		s3Client:         s3.NewFromConfig(cfg),
		pdfGen:           pdf.NewGeradorPDF(),
		bucketName:       bucketName,
		cloudFrontDomain: os.Getenv("CLOUDFRONT_DOMAIN"),
	}, nil
}

// HandleRequest processa evento EventBridge Faturamento.ImpressaoSolicitada
func (g *PDFGenerator) HandleRequest(ctx context.Context, event events.CloudWatchEvent) error {
	slog.Info("PDF Generator invoked", "detailType", event.DetailType, "source", event.Source)

	var payload EventPayload
	if err := json.Unmarshal(event.Detail, &payload); err != nil {
		return fmt.Errorf("failed to parse event detail: %w", err)
	}
	correlationID := payload.CorrelationID
	if correlationID == "" {
		correlationID = observability.CorrelationIDFromJSONDetail(event.Detail)
	}

	notaID, err := uuid.Parse(payload.NotaID)
	if err != nil {
		return fmt.Errorf("invalid notaId in event: %w", err)
	}

	solID, err := uuid.Parse(payload.SolicitacaoID)
	if err != nil {
		return fmt.Errorf("invalid solicitacaoId in event: %w", err)
	}

	slog.Info("Generating PDF", "notaId", notaID, "solicitacaoId", solID, "correlationId", correlationID)

	// Buscar nota com itens
	nota, err := g.repo.BuscarNotaPorID(ctx, notaID)
	if err != nil {
		errMsg := fmt.Sprintf("erro ao buscar nota: %v", err)
		_ = g.repo.AtualizarSolicitacaoImpressao(ctx, solID, "FALHOU", "", &errMsg)
		return fmt.Errorf("failed to fetch nota %s: %w", notaID, err)
	}
	if nota == nil {
		errMsg := "nota não encontrada"
		_ = g.repo.AtualizarSolicitacaoImpressao(ctx, solID, "FALHOU", "", &errMsg)
		return fmt.Errorf("nota not found: %s", notaID)
	}

	// Gerar PDF
	pdfBytes, err := g.pdfGen.GerarNotaFiscal(nota)
	if err != nil {
		errMsg := fmt.Sprintf("falha ao gerar PDF: %v", err)
		_ = g.repo.AtualizarSolicitacaoImpressao(ctx, solID, "FALHOU", "", &errMsg)
		return fmt.Errorf("failed to generate PDF: %w", err)
	}

	// Upload para S3
	pdfKey := fmt.Sprintf("notas/%s/%s.pdf", notaID.String(), solID.String())
	_, err = g.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(g.bucketName),
		Key:         aws.String(pdfKey),
		Body:        bytes.NewReader(pdfBytes),
		ContentType: aws.String("application/pdf"),
	})
	if err != nil {
		errMsg := fmt.Sprintf("falha ao salvar PDF no S3: %v", err)
		_ = g.repo.AtualizarSolicitacaoImpressao(ctx, solID, "FALHOU", "", &errMsg)
		return fmt.Errorf("failed to upload PDF to S3: %w", err)
	}

	// Montar URL
	var pdfURL string
	if g.cloudFrontDomain != "" {
		pdfURL = fmt.Sprintf("https://%s/%s", g.cloudFrontDomain, pdfKey)
	} else {
		pdfURL = fmt.Sprintf("https://%s.s3.amazonaws.com/%s", g.bucketName, pdfKey)
	}

	// Atualizar SolicitacaoImpressao como CONCLUIDA
	if err := g.repo.AtualizarSolicitacaoImpressao(ctx, solID, "CONCLUIDA", pdfURL, nil); err != nil {
		return fmt.Errorf("failed to update solicitacao as CONCLUIDA: %w", err)
	}

	slog.Info("PDF generated and stored successfully", "notaId", notaID, "pdfUrl", pdfURL, "correlationId", correlationID)
	return nil
}

func main() {
	generator, err := NewPDFGenerator()
	if err != nil {
		slog.Error("Failed to initialize PDF generator", "error", err)
		panic(err)
	}
	slog.Info("PDF Generator Lambda initialized")
	lambda.Start(generator.HandleRequest)
}
