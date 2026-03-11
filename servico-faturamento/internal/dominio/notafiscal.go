package dominio

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Constantes de status da nota fiscal
const (
	StatusNotaAberta    = "ABERTA"
	StatusNotaFechada   = "FECHADA"
	StatusNotaReservada = "RESERVADA"
	StatusNotaCancelada = "CANCELADA"
)

type NotaFiscal struct {
	ID          uuid.UUID  `json:"id"`
	Numero      string     `json:"numero"`
	Status      string     `json:"status"`
	DataCriacao time.Time  `json:"dataCriacao"`
	DataFechada *time.Time `json:"dataFechada,omitempty"`
	Itens       []ItemNota `json:"itens,omitempty"`
}

type ItemNota struct {
	ID            uuid.UUID `json:"id"`
	NotaID        uuid.UUID `json:"notaId"`
	ProdutoID     uuid.UUID `json:"produtoId"`
	Quantidade    int       `json:"quantidade"`
	PrecoUnitario float64   `json:"precoUnitario"`
}

func (n *NotaFiscal) Fechar() error {
	if n.Status != StatusNotaAberta {
		return errors.New("nota não está aberta")
	}
	if len(n.Itens) == 0 {
		return errors.New("nota sem itens não pode ser fechada")
	}
	n.Status = StatusNotaFechada
	agora := time.Now()
	n.DataFechada = &agora
	return nil
}

// CalcularTotal retorna o valor total da nota somando todos os itens
func (n *NotaFiscal) CalcularTotal() float64 {
	var total float64
	for _, item := range n.Itens {
		total += item.CalcularSubtotal()
	}
	return total
}

// CalcularSubtotal retorna o valor do item (quantidade × preço unitário)
func (i *ItemNota) CalcularSubtotal() float64 {
	return float64(i.Quantidade) * i.PrecoUnitario
}
