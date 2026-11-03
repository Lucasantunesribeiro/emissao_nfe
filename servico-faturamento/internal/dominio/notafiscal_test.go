package dominio_test

import (
	"servico-faturamento/internal/dominio"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestNotaFiscal_Fechar(t *testing.T) {
	t.Run("deve fechar nota ABERTA com itens", func(t *testing.T) {
		nota := &dominio.NotaFiscal{
			ID:          uuid.New(),
			Numero:      "NF-001",
			Status:      dominio.StatusNotaAberta,
			DataCriacao: time.Now(),
			Itens: []dominio.ItemNota{
				{
					ID:            uuid.New(),
					ProdutoID:     uuid.New(),
					Quantidade:    5,
					PrecoUnitario: dominio.Centavos(10000),
				},
			},
		}

		err := nota.Fechar()

		if err != nil {
			t.Errorf("esperava nil, obteve erro: %v", err)
		}

		if nota.Status != dominio.StatusNotaFechada {
			t.Errorf("esperava status FECHADA, obteve: %s", nota.Status)
		}

		if nota.DataFechada == nil {
			t.Error("esperava DataFechada preenchida")
		}
	})

	t.Run("deve rejeitar fechar nota sem status ABERTA", func(t *testing.T) {
		nota := &dominio.NotaFiscal{
			ID:     uuid.New(),
			Numero: "NF-002",
			Status: dominio.StatusNotaFechada,
		}

		err := nota.Fechar()

		if err == nil {
			t.Error("esperava erro, obteve nil")
		}
	})

	t.Run("deve rejeitar fechar nota sem itens", func(t *testing.T) {
		nota := &dominio.NotaFiscal{
			ID:     uuid.New(),
			Numero: "NF-003",
			Status: dominio.StatusNotaAberta,
			Itens:  []dominio.ItemNota{},
		}

		err := nota.Fechar()

		if err == nil {
			t.Error("esperava erro ao fechar nota sem itens")
		}
	})
}

func TestNotaFiscal_CalcularTotal(t *testing.T) {
	nota := &dominio.NotaFiscal{
		ID:     uuid.New(),
		Numero: "NF-004",
		Itens: []dominio.ItemNota{
			{
				ID:            uuid.New(),
				Quantidade:    2,
				PrecoUnitario: dominio.Centavos(5000),
			},
			{
				ID:            uuid.New(),
				Quantidade:    3,
				PrecoUnitario: dominio.Centavos(3000),
			},
		},
	}

	total, err := nota.CalcularTotal()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	esperado := dominio.Centavos(19000) // (2*50) + (3*30)

	if total != esperado {
		t.Errorf("esperava total %s, obteve %s", esperado, total)
	}
}

func TestItemNota_CalcularSubtotal(t *testing.T) {
	item := dominio.ItemNota{
		Quantidade:    5,
		PrecoUnitario: dominio.Centavos(10050),
	}

	subtotal, err := item.CalcularSubtotal()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	esperado := dominio.Centavos(50250)

	if subtotal != esperado {
		t.Errorf("esperava subtotal %s, obteve %s", esperado, subtotal)
	}
}

func TestNotaFiscal_Fechar_StatusReservadaCancelada(t *testing.T) {
	t.Run("deve rejeitar fechar nota RESERVADA", func(t *testing.T) {
		nota := &dominio.NotaFiscal{
			ID:     uuid.New(),
			Numero: "NF-010",
			Status: dominio.StatusNotaReservada,
			Itens: []dominio.ItemNota{
				{ID: uuid.New(), ProdutoID: uuid.New(), Quantidade: 1, PrecoUnitario: dominio.Centavos(1000)},
			},
		}
		if err := nota.Fechar(); err == nil {
			t.Error("esperava erro ao fechar nota RESERVADA")
		}
	})

	t.Run("deve rejeitar fechar nota CANCELADA", func(t *testing.T) {
		nota := &dominio.NotaFiscal{
			ID:     uuid.New(),
			Numero: "NF-011",
			Status: dominio.StatusNotaCancelada,
			Itens: []dominio.ItemNota{
				{ID: uuid.New(), ProdutoID: uuid.New(), Quantidade: 1, PrecoUnitario: dominio.Centavos(1000)},
			},
		}
		if err := nota.Fechar(); err == nil {
			t.Error("esperava erro ao fechar nota CANCELADA")
		}
	})
}

func TestNotaFiscal_CalcularTotal_Vazia(t *testing.T) {
	nota := &dominio.NotaFiscal{
		ID:     uuid.New(),
		Numero: "NF-012",
		Itens:  []dominio.ItemNota{},
	}
	if total, err := nota.CalcularTotal(); err != nil || total != 0 {
		t.Errorf("esperava total 0 para nota sem itens, obteve %s (err=%v)", total, err)
	}
}
func TestNotaFiscal_CalcularTotal_SemErroDePontoFlutuante(t *testing.T) {
	// Em float64, 0.1 * 3 = 0.30000000000000004 e somas de centavos acumulam erro.
	nota := &dominio.NotaFiscal{Itens: []dominio.ItemNota{
		{Quantidade: 3, PrecoUnitario: dominio.Centavos(10)},
		{Quantidade: 1, PrecoUnitario: dominio.Centavos(20)},
	}}
	total, err := nota.CalcularTotal()
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if total != dominio.Centavos(50) || total.String() != "0.50" {
		t.Errorf("esperava 0.50, obteve %s", total)
	}
}

func TestNotaFiscal_QuantidadesPorProduto_AgregaItensRepetidos(t *testing.T) {
	p1, p2 := uuid.New(), uuid.New()
	nota := &dominio.NotaFiscal{Itens: []dominio.ItemNota{
		{ProdutoID: p1, Quantidade: 2},
		{ProdutoID: p2, Quantidade: 1},
		{ProdutoID: p1, Quantidade: 3},
	}}
	qtds := nota.QuantidadesPorProduto()
	if len(qtds) != 2 || qtds[p1] != 5 || qtds[p2] != 1 {
		t.Errorf("agregacao incorreta: %v", qtds)
	}
}
