package dominio

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Constantes de status da nota fiscal
const (
	StatusNotaAberta  = "ABERTA"
	StatusNotaFechada = "FECHADA"
)

type NotaFiscal struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key" json:"id"`
	Numero      string    `gorm:"unique;not null" json:"numero"`
	Status      string    `gorm:"not null" json:"status"` // ABERTA, FECHADA
	DataCriacao time.Time `gorm:"not null" json:"dataCriacao"`
	DataFechada *time.Time `json:"dataFechada,omitempty"`
	Itens       []ItemNota `gorm:"foreignKey:NotaID" json:"itens,omitempty"`
}

type ItemNota struct {
	ID            uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	NotaID        uuid.UUID  `gorm:"type:uuid;not null" json:"notaId"`
	ProdutoID     uuid.UUID  `gorm:"type:uuid;not null" json:"produtoId"`
	Quantidade    int        `gorm:"not null" json:"quantidade"`
	PrecoUnitario float64    `gorm:"type:decimal(10,2);not null" json:"precoUnitario"`
}

func (n *NotaFiscal) BeforeCreate(tx *gorm.DB) error {
	if n.ID == uuid.Nil {
		n.ID = uuid.New()
	}
	if n.DataCriacao.IsZero() {
		n.DataCriacao = time.Now()
	}
	if n.Status == "" {
		n.Status = "ABERTA"
	}
	return nil
}

func (i *ItemNota) BeforeCreate(tx *gorm.DB) error {
	if i.ID == uuid.Nil {
		i.ID = uuid.New()
	}
	return nil
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

func (n *NotaFiscal) TableName() string {
	return "notas_fiscais"
}

func (i *ItemNota) TableName() string {
	return "itens_nota"
}
