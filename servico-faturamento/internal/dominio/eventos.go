package dominio

import (
	"time"

	"github.com/google/uuid"
)

type EventoOutbox struct {
	ID             int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	TipoEvento     string     `gorm:"not null" json:"tipoEvento"`
	IdAgregado     uuid.UUID  `gorm:"type:uuid;not null" json:"idAgregado"`
	Payload        string     `gorm:"type:jsonb;not null" json:"payload"`
	DataOcorrencia time.Time  `gorm:"not null" json:"dataOcorrencia"`
	DataPublicacao *time.Time `json:"dataPublicacao,omitempty"`
}

type MensagemProcessada struct {
	IDMensagem     string    `gorm:"primaryKey" json:"idMensagem"`
	DataProcessada time.Time `gorm:"not null" json:"dataProcessada"`
}

func (EventoOutbox) TableName() string {
	return "eventos_outbox"
}

func (MensagemProcessada) TableName() string {
	return "mensagens_processadas"
}
