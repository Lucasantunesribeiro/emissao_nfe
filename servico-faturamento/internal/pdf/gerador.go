package pdf

import (
	"bytes"
	"fmt"
	"time"

	"servico-faturamento/internal/dominio"

	"github.com/jung-kurt/gofpdf"
)

type GeradorPDF struct{}

func NewGeradorPDF() *GeradorPDF {
	return &GeradorPDF{}
}

// GerarNotaFiscal gera um PDF com os dados da nota fiscal
func (g *GeradorPDF) GerarNotaFiscal(nota *dominio.NotaFiscal) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.AddPage()

	// Header
	pdf.SetFont("Arial", "B", 20)
	pdf.Cell(190, 10, "NOTA FISCAL ELETRONICA")
	pdf.Ln(15)

	// Informações da nota
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Numero:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(150, 8, nota.Numero)
	pdf.Ln(8)

	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Status:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(150, 8, string(nota.Status))
	pdf.Ln(8)

	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(40, 8, "Data Criacao:")
	pdf.SetFont("Arial", "", 12)
	pdf.Cell(150, 8, nota.DataCriacao.Format("02/01/2006 15:04:05"))
	pdf.Ln(8)

	if nota.DataFechada != nil {
		pdf.SetFont("Arial", "B", 12)
		pdf.Cell(40, 8, "Data Fechada:")
		pdf.SetFont("Arial", "", 12)
		pdf.Cell(150, 8, nota.DataFechada.Format("02/01/2006 15:04:05"))
		pdf.Ln(8)
	}

	// Linha separadora
	pdf.Ln(5)
	pdf.SetLineWidth(0.5)
	pdf.Line(10, pdf.GetY(), 200, pdf.GetY())
	pdf.Ln(8)

	// Título da tabela de itens
	pdf.SetFont("Arial", "B", 14)
	pdf.Cell(190, 10, "ITENS DA NOTA")
	pdf.Ln(12)

	// Cabeçalho da tabela
	pdf.SetFont("Arial", "B", 10)
	pdf.SetFillColor(200, 200, 200)
	pdf.CellFormat(80, 7, "Produto", "1", 0, "C", true, 0, "")
	pdf.CellFormat(30, 7, "Quantidade", "1", 0, "C", true, 0, "")
	pdf.CellFormat(35, 7, "Preco Unit.", "1", 0, "C", true, 0, "")
	pdf.CellFormat(35, 7, "Subtotal", "1", 0, "C", true, 0, "")
	pdf.Ln(7)

	// Itens
	pdf.SetFont("Arial", "", 9)
	var total float64
	for _, item := range nota.Itens {
		subtotal := float64(item.Quantidade) * item.PrecoUnitario
		total += subtotal

		// Nome do produto (truncar se muito longo)
		nomeProduto := item.ProdutoID.String()[:8] + "..."
		pdf.CellFormat(80, 6, nomeProduto, "1", 0, "L", false, 0, "")
		pdf.CellFormat(30, 6, fmt.Sprintf("%d", item.Quantidade), "1", 0, "C", false, 0, "")
		pdf.CellFormat(35, 6, fmt.Sprintf("R$ %.2f", item.PrecoUnitario), "1", 0, "R", false, 0, "")
		pdf.CellFormat(35, 6, fmt.Sprintf("R$ %.2f", subtotal), "1", 0, "R", false, 0, "")
		pdf.Ln(6)
	}

	// Total
	pdf.Ln(3)
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(145, 10, "")
	pdf.Cell(10, 10, "TOTAL:")
	pdf.SetFont("Arial", "B", 14)
	pdf.Cell(35, 10, fmt.Sprintf("R$ %.2f", total))
	pdf.Ln(15)

	// Footer
	pdf.Ln(10)
	pdf.SetFont("Arial", "I", 8)
	pdf.SetTextColor(128, 128, 128)
	pdf.Cell(190, 5, fmt.Sprintf("Documento gerado em %s", time.Now().Format("02/01/2006 15:04:05")))

	// Gerar bytes do PDF
	var buf bytes.Buffer
	err := pdf.Output(&buf)
	if err != nil {
		return nil, fmt.Errorf("erro ao gerar PDF: %w", err)
	}

	return buf.Bytes(), nil
}
