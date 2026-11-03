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
	ID         uuid.UUID `json:"id"`
	NotaID     uuid.UUID `json:"notaId"`
	ProdutoID  uuid.UUID `json:"produtoId"`
	Quantidade int       `json:"quantidade"`
	// PrecoUnitario em centavos; serializado como decimal (ex.: 10.50).
	PrecoUnitario Dinheiro `json:"precoUnitario"`
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

// CalcularTotal retorna o valor total da nota somando todos os itens, em
// aritmetica inteira de centavos (sem float64).
func (n *NotaFiscal) CalcularTotal() (Dinheiro, error) {
	var total Dinheiro
	for _, item := range n.Itens {
		subtotal, err := item.CalcularSubtotal()
		if err != nil {
			return 0, err
		}
		if total, err = total.Somar(subtotal); err != nil {
			return 0, err
		}
	}
	return total, nil
}

// CalcularSubtotal retorna o valor do item (quantidade × preço unitário).
func (i *ItemNota) CalcularSubtotal() (Dinheiro, error) {
	return i.PrecoUnitario.Multiplicar(i.Quantidade)
}

// QuantidadesPorProduto agrega as quantidades dos itens por produto.
// Uma nota pode ter mais de um item do mesmo produto; a reserva de estoque
// precisa debitar o total de uma vez (uma operacao por produto).
func (n *NotaFiscal) QuantidadesPorProduto() map[uuid.UUID]int {
	qtds := make(map[uuid.UUID]int, len(n.Itens))
	for _, item := range n.Itens {
		qtds[item.ProdutoID] += item.Quantidade
	}
	return qtds
}
