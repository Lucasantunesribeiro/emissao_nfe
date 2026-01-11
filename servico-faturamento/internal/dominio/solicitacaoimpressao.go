package dominio

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type SolicitacaoImpressao struct {
	ID                uuid.UUID  `gorm:"type:uuid;primary_key" json:"id"`
	NotaID            uuid.UUID  `gorm:"type:uuid;not null" json:"notaId"`
	Status            string     `gorm:"not null" json:"status"` // PENDENTE, CONCLUIDA, FALHOU
	MensagemErro      *string    `json:"mensagemErro,omitempty"`
	ChaveIdempotencia string     `gorm:"unique" json:"chaveIdempotencia"`
	DataCriacao       time.Time  `gorm:"not null" json:"dataCriacao"`
	DataConclusao     *time.Time `json:"dataConclusao,omitempty"`
}

func (s *SolicitacaoImpressao) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	if s.DataCriacao.IsZero() {
		s.DataCriacao = time.Now()
	}
	if s.Status == "" {
		s.Status = "PENDENTE"
	}
	return nil
}

func (s *SolicitacaoImpressao) TableName() string {
	return "solicitacoes_impressao"
}
