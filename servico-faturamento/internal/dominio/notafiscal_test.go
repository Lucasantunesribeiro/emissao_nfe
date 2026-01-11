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
					PrecoUnitario: 100.0,
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
				PrecoUnitario: 50.0,
			},
			{
				ID:            uuid.New(),
				Quantidade:    3,
				PrecoUnitario: 30.0,
			},
		},
	}

	total := nota.CalcularTotal()
	esperado := 190.0 // (2*50) + (3*30)

	if total != esperado {
		t.Errorf("esperava total %.2f, obteve %.2f", esperado, total)
	}
}

func TestItemNota_CalcularSubtotal(t *testing.T) {
	item := dominio.ItemNota{
		Quantidade:    5,
		PrecoUnitario: 100.50,
	}

	subtotal := item.CalcularSubtotal()
	esperado := 502.5

	if subtotal != esperado {
		t.Errorf("esperava subtotal %.2f, obteve %.2f", esperado, subtotal)
	}
}