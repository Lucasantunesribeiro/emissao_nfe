package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"time"

	"servico-faturamento/internal/config"
	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/logger"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
	"github.com/jung-kurt/gofpdf"
	"gorm.io/gorm"
)

type PDFGenerator struct {
	db           *gorm.DB
	s3Client     *s3.Client
	bucketName   string
	cloudFrontDomain string
}

type EventPayload struct {
	NotaID string `json:"notaId"`
}

func main() {
	logger.Init()
	slog.Info("Initializing PDF Generator Lambda")

	db, err := config.InicializarDB()
	if err != nil {
		slog.Error("Failed to initialize database", "error", err)
		panic(err)
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background())
	if err != nil {
		slog.Error("Failed to load AWS config", "error", err)
		panic(err)
	}

	generator := &PDFGenerator{
		db:           db,
		s3Client:     s3.NewFromConfig(cfg),
		bucketName:   os.Getenv("PDF_BUCKET_NAME"),
		cloudFrontDomain: os.Getenv("CLOUDFRONT_DOMAIN"),
	}

	lambda.Start(generator.HandleRequest)
}

func (g *PDFGenerator) HandleRequest(ctx context.Context, event events.CloudWatchEvent) error {
	slog.Info("PDF Generator Lambda invoked", "detailType", event.DetailType)

	// Parse event detail
	var payload EventPayload
	if err := json.Unmarshal(event.Detail, &payload); err != nil {
		slog.Error("Failed to parse event detail", "error", err)
		return err
	}

	notaID, err := uuid.Parse(payload.NotaID)
	if err != nil {
		slog.Error("Invalid nota ID", "error", err, "notaId", payload.NotaID)
		return err
	}

	slog.Info("Processing PDF generation", "notaId", notaID)

	// Buscar nota com itens
	var nota dominio.NotaFiscal
	if err := g.db.Preload("Itens").First(&nota, "id = ?", notaID).Error; err != nil {
		slog.Error("Nota not found", "error", err, "notaId", notaID)
		return err
	}

	// Verificar se nota tem itens
	if len(nota.Itens) == 0 {
		slog.Warn("Nota has no items, skipping PDF generation", "notaId", notaID)
		g.markSolicitacaoAsFailed(notaID, "Nota sem itens não pode gerar PDF")
		return nil
	}

	// Gerar PDF
	pdfBytes, err := g.generatePDF(nota)
	if err != nil {
		slog.Error("Failed to generate PDF", "error", err, "notaId", notaID)
		g.markSolicitacaoAsFailed(notaID, fmt.Sprintf("Falha ao gerar PDF: %v", err))
		return err
	}

	// Upload para S3
	pdfKey := fmt.Sprintf("notas-fiscais/%s/%s.pdf", nota.DataCriacao.Format("2006/01"), notaID)
	if err := g.uploadToS3(ctx, pdfKey, pdfBytes); err != nil {
		slog.Error("Failed to upload PDF to S3", "error", err, "notaId", notaID)
		g.markSolicitacaoAsFailed(notaID, fmt.Sprintf("Falha ao salvar PDF: %v", err))
		return err
	}

	// Atualizar solicitação com URL do PDF
	pdfURL := fmt.Sprintf("https://%s/%s", g.cloudFrontDomain, pdfKey)
	if err := g.updateSolicitacaoWithPDF(notaID, pdfURL); err != nil {
		slog.Error("Failed to update solicitacao", "error", err, "notaId", notaID)
		return err
	}

	slog.Info("PDF generated successfully", "notaId", notaID, "pdfUrl", pdfURL)
	return nil
}

func (g *PDFGenerator) generatePDF(nota dominio.NotaFiscal) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// Cabeçalho
	pdf.SetFont("Arial", "B", 20)
	pdf.Cell(0, 10, "NOTA FISCAL ELETRONICA")
	pdf.Ln(12)

	// Informações da nota
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Numero:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(0, 8, nota.Numero)
	pdf.Ln(8)

	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Data Emissao:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(0, 8, nota.DataCriacao.Format("02/01/2006 15:04:05"))
	pdf.Ln(8)

	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Status:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(0, 8, string(nota.Status))
	pdf.Ln(8)

	if nota.DataFechada != nil {
		pdf.SetFont("Arial", "B", 12)
		pdf.Cell(40, 8, "Data Fechamento:")
		pdf.SetFont("Arial", "", 12)
		pdf.Cell(0, 8, nota.DataFechada.Format("02/01/2006 15:04:05"))
		pdf.Ln(8)
	}

	pdf.Ln(5)

	// Tabela de itens
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(0, 10, "ITENS DA NOTA")
	pdf.Ln(10)

	// Cabeçalho da tabela
	pdf.SetFont("Arial", "B", 10)
	pdf.SetFillColor(200, 200, 200)
	pdf.CellFormat(80, 7, "Produto ID", "1", 0, "C", true, 0, "")
	pdf.CellFormat(30, 7, "Qtd", "1", 0, "C", true, 0, "")
	pdf.CellFormat(40, 7, "Preco Unit.", "1", 0, "C", true, 0, "")
	pdf.CellFormat(40, 7, "Subtotal", "1", 1, "C", true, 0, "")

	// Linhas da tabela
	pdf.SetFont("Arial", "", 9)
	total := 0.0
	for _, item := range nota.Itens {
		subtotal := float64(item.Quantidade) * item.PrecoUnitario
		total += subtotal

		pdf.CellFormat(80, 6, item.ProdutoID.String()[:8]+"...", "1", 0, "L", false, 0, "")
		pdf.CellFormat(30, 6, fmt.Sprintf("%d", item.Quantidade), "1", 0, "C", false, 0, "")
		pdf.CellFormat(40, 6, fmt.Sprintf("R$ %.2f", item.PrecoUnitario), "1", 0, "R", false, 0, "")
		pdf.CellFormat(40, 6, fmt.Sprintf("R$ %.2f", subtotal), "1", 1, "R", false, 0, "")
	}

	// Total
	pdf.SetFont("Arial", "B", 11)
	pdf.CellFormat(150, 8, "TOTAL:", "1", 0, "R", false, 0, "")
	pdf.CellFormat(40, 8, fmt.Sprintf("R$ %.2f", total), "1", 1, "R", false, 0, "")

	pdf.Ln(10)

	// Rodapé
	pdf.SetFont("Arial", "I", 8)
	pdf.Cell(0, 5, "Documento gerado eletronicamente em "+time.Now().Format("02/01/2006 15:04:05"))
	pdf.Ln(5)
	pdf.Cell(0, 5, "Sistema de Emissao de NFe - Versao 1.0")

	// Retornar bytes do PDF
	var buf []byte
	w := &bytesWriter{buf: &buf}
	if err := pdf.Output(w); err != nil {
		return nil, err
	}
	return buf, nil
}

func (g *PDFGenerator) uploadToS3(ctx context.Context, key string, data []byte) error {
	_, err := g.s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(g.bucketName),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String("application/pdf"),
	})
	return err
}

func (g *PDFGenerator) updateSolicitacaoWithPDF(notaID uuid.UUID, pdfURL string) error {
	return g.db.Model(&dominio.SolicitacaoImpressao{}).
		Where("nota_id = ?", notaID).
		Updates(map[string]interface{}{
			"status":     "CONCLUIDA",
			"pdf_url":    pdfURL,
			"data_conclusao": time.Now(),
		}).Error
}

func (g *PDFGenerator) markSolicitacaoAsFailed(notaID uuid.UUID, mensagem string) {
	g.db.Model(&dominio.SolicitacaoImpressao{}).
		Where("nota_id = ? AND status = ?", notaID, "PENDENTE").
		Updates(map[string]interface{}{
			"status":        "FALHOU",
			"mensagem_erro": mensagem,
		})
}

// bytesWriter é um wrapper para implementar io.Writer
type bytesWriter struct {
	buf *[]byte
}

func (w *bytesWriter) Write(p []byte) (n int, err error) {
	*w.buf = append(*w.buf, p...)
	return len(p), nil
}
