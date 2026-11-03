package pdf

import (
	"bytes"
	"fmt"
	"time"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/fiscal"

	"github.com/jung-kurt/gofpdf"
)

// AvisoHomologacao e impresso em todo documento gerado fora de producao.
const AvisoHomologacao = "AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL"

type GeradorPDF struct {
	ambiente fiscal.Ambiente
	// semCompressao facilita inspecionar o conteudo do PDF em testes.
	semCompressao bool
}

// NewGeradorPDF cria o gerador para o ambiente fiscal informado. O valor zero
// (nao configurado) e tratado como homologacao.
func NewGeradorPDF(ambiente fiscal.Ambiente) *GeradorPDF {
	if ambiente != fiscal.AmbienteProducao {
		ambiente = fiscal.AmbienteHomologacao
	}
	return &GeradorPDF{ambiente: ambiente}
}

// TextoAvisoAmbiente retorna o aviso impresso no documento ("" em producao).
func (g *GeradorPDF) TextoAvisoAmbiente() string {
	if g.ambiente.EhProducao() {
		return ""
	}
	return AvisoHomologacao
}

// GerarNotaFiscal gera um PDF com os dados da nota fiscal
func (g *GeradorPDF) GerarNotaFiscal(nota *dominio.NotaFiscal) ([]byte, error) {
	pdf := gofpdf.New("P", "mm", "A4", "")
	if g.semCompressao {
		pdf.SetCompression(false)
	}
	pdf.AddPage()

	if aviso := g.TextoAvisoAmbiente(); aviso != "" {
		pdf.SetFont("Arial", "B", 12)
		pdf.SetTextColor(200, 0, 0)
		pdf.CellFormat(190, 8, aviso, "1", 0, "C", false, 0, "")
		pdf.SetTextColor(0, 0, 0)
		pdf.Ln(12)
	}

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
	var total dominio.Dinheiro
	for _, item := range nota.Itens {
		subtotal, err := item.CalcularSubtotal()
		if err != nil {
			return nil, fmt.Errorf("erro ao calcular subtotal do item %s: %w", item.ID, err)
		}
		if total, err = total.Somar(subtotal); err != nil {
			return nil, fmt.Errorf("erro ao calcular total da nota: %w", err)
		}

		// Nome do produto (truncar se muito longo)
		nomeProduto := item.ProdutoID.String()[:8] + "..."
		pdf.CellFormat(80, 6, nomeProduto, "1", 0, "L", false, 0, "")
		pdf.CellFormat(30, 6, fmt.Sprintf("%d", item.Quantidade), "1", 0, "C", false, 0, "")
		pdf.CellFormat(35, 6, item.PrecoUnitario.FormatarBRL(), "1", 0, "R", false, 0, "")
		pdf.CellFormat(35, 6, subtotal.FormatarBRL(), "1", 0, "R", false, 0, "")
		pdf.Ln(6)
	}

	// Total
	pdf.Ln(3)
	pdf.SetFont("Arial", "B", 12)
	pdf.Cell(145, 10, "")
	pdf.Cell(10, 10, "TOTAL:")
	pdf.SetFont("Arial", "B", 14)
	pdf.Cell(35, 10, total.FormatarBRL())
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
