package dominio

import (
	"time"

	"github.com/google/uuid"
)

type SolicitacaoImpressao struct {
	ID                uuid.UUID  `json:"id"`
	NotaID            uuid.UUID  `json:"notaId"`
	Status            string     `json:"status"` // PENDENTE, CONCLUIDA, FALHOU
	MensagemErro      *string    `json:"mensagemErro,omitempty"`
	PdfURL            *string    `json:"pdfUrl,omitempty"`
	ChaveIdempotencia string     `json:"chaveIdempotencia"`
	DataCriacao       time.Time  `json:"dataCriacao"`
	DataConclusao     *time.Time `json:"dataConclusao,omitempty"`
}
