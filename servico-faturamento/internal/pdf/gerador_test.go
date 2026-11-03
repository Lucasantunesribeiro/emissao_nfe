package pdf

import (
	"bytes"
	"testing"
	"time"

	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/fiscal"
)

func notaExemplo() *dominio.NotaFiscal {
	return &dominio.NotaFiscal{
		ID:          uuid.New(),
		Numero:      "NF-100",
		Status:      dominio.StatusNotaFechada,
		DataCriacao: time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		Itens: []dominio.ItemNota{
			{ID: uuid.New(), ProdutoID: uuid.New(), Quantidade: 3, PrecoUnitario: dominio.Centavos(10)},
			{ID: uuid.New(), ProdutoID: uuid.New(), Quantidade: 2, PrecoUnitario: dominio.Centavos(123450)},
		},
	}
}

func gerarSemCompressao(t *testing.T, amb fiscal.Ambiente) []byte {
	t.Helper()
	g := NewGeradorPDF(amb)
	g.semCompressao = true
	out, err := g.GerarNotaFiscal(notaExemplo())
	if err != nil {
		t.Fatalf("erro ao gerar PDF: %v", err)
	}
	if !bytes.HasPrefix(out, []byte("%PDF-")) {
		t.Fatalf("saida nao e um PDF")
	}
	return out
}

func TestGerarNotaFiscal_AmbientePadrao_ImprimeAvisoHomologacao(t *testing.T) {
	// Valor zero (nao configurado) deve ser tratado como homologacao.
	var naoConfigurado fiscal.Ambiente
	out := gerarSemCompressao(t, naoConfigurado)
	if !bytes.Contains(out, []byte(AvisoHomologacao)) {
		t.Errorf("PDF sem configuracao deve conter o aviso %q", AvisoHomologacao)
	}
}

func TestGerarNotaFiscal_Producao_SemAviso(t *testing.T) {
	out := gerarSemCompressao(t, fiscal.AmbienteProducao)
	if bytes.Contains(out, []byte(AvisoHomologacao)) {
		t.Errorf("PDF de producao nao deve conter o aviso de homologacao")
	}
}

func TestGerarNotaFiscal_TotalEmCentavos(t *testing.T) {
	out := gerarSemCompressao(t, fiscal.AmbienteHomologacao)
	// 3 x 0,10 + 2 x 1.234,50 = 2.469,30 (sem erro de ponto flutuante)
	if !bytes.Contains(out, []byte("R$ 2.469,30")) {
		t.Errorf("total esperado R$ 2.469,30 nao encontrado no PDF")
	}
	if !bytes.Contains(out, []byte("R$ 0,30")) {
		t.Errorf("subtotal esperado R$ 0,30 nao encontrado no PDF")
	}
}
