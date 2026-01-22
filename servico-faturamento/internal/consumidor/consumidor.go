package consumidor

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"time"

	"servico-faturamento/internal/dominio"
	"servico-faturamento/internal/manipulador"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Consumidor struct {
	DB       *gorm.DB
	Handlers *manipulador.Handlers
}

func IniciarConsumidor(db *gorm.DB, handlers *manipulador.Handlers) error {
	rabbitURL := os.Getenv("RABBITMQ_URL")

	// Se RABBITMQ_URL estiver vazio ou "disabled", pula inicialização (para Lambda/EventBridge)
	if rabbitURL == "" || rabbitURL == "disabled" {
		slog.Info("RabbitMQ desabilitado, pulando inicialização do consumidor")
		return nil
	}

	var conn *amqp.Connection
	var err error

	for i := 0; i < 10; i++ {
		conn, err = amqp.Dial(rabbitURL)
		if err == nil {
			break
		}
		slog.Warn("Tentativa de conexão RabbitMQ falhou", "tentativa", i+1, "erro", err.Error())
		time.Sleep(3 * time.Second)
	}

	if err != nil {
		return fmt.Errorf("falha ao conectar RabbitMQ apos retries: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("falha ao abrir channel: %w", err)
	}

	err = ch.ExchangeDeclare(
		"estoque-eventos",
		"topic",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao declarar exchange: %w", err)
	}

	q, err := ch.QueueDeclare(
		"faturamento-eventos",
		true,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao declarar fila: %w", err)
	}

	err = ch.QueueBind(
		q.Name,
		"Estoque.Reservado",
		"estoque-eventos",
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao fazer bind Reservado: %w", err)
	}

	err = ch.QueueBind(
		q.Name,
		"Estoque.ReservaRejeitada",
		"estoque-eventos",
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao fazer bind Rejeitada: %w", err)
	}

	err = ch.Qos(
		1,
		0,
		false,
	)
	if err != nil {
		return fmt.Errorf("falha ao configurar QoS: %w", err)
	}

	msgs, err := ch.Consume(
		q.Name,
		"",
		false,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("falha ao registrar consumer: %w", err)
	}

	slog.Info("Consumidor RabbitMQ iniciado, aguardando mensagens...")

	consumidor := &Consumidor{
		DB:       db,
		Handlers: handlers,
	}

	go func() {
		for msg := range msgs {
			err := consumidor.ProcessarMensagem(msg)
			if err != nil {
				slog.Error("Erro ao processar mensagem", "erro", err.Error())
				msg.Nack(false, true)
			} else {
				msg.Ack(false)
			}
		}
	}()

	return nil
}

func (c *Consumidor) ProcessarMensagem(msg amqp.Delivery) error {
	idMsg := msg.MessageId
	if idMsg == "" {
		idMsg = fmt.Sprintf("%d-%s", msg.DeliveryTag, msg.RoutingKey)
	}

	slog.Info("Processando mensagem", "id", idMsg, "routing", msg.RoutingKey)

	return c.DB.Transaction(func(tx *gorm.DB) error {
		var existe dominio.MensagemProcessada
		if err := tx.Where("id_mensagem = ?", idMsg).First(&existe).Error; err == nil {
			slog.Info("Mensagem ja processada, ignorando", "id", idMsg)
			return nil
		}

		statusMensagem := "sucesso"

		switch msg.RoutingKey {
		case "Estoque.Reservado":
			notaFechada, err := c.processarEstoqueReservado(tx, msg.Body)
			if err != nil {
				return err
			}
			if !notaFechada {
				statusMensagem = "ignorada"
			}
		case "Estoque.ReservaRejeitada":
			if err := c.processarReservaRejeitada(tx, msg.Body); err != nil {
				return err
			}
		default:
			slog.Warn("Routing key desconhecida", "routing", msg.RoutingKey)
			return nil
		}

		msgProc := dominio.MensagemProcessada{
			IDMensagem:     idMsg,
			DataProcessada: time.Now(),
		}
		if err := tx.Create(&msgProc).Error; err != nil {
			return err
		}

		if statusMensagem == "sucesso" {
			slog.Info("Mensagem processada com sucesso", "id", idMsg)
		} else {
			slog.Info("Mensagem marcada", "id", idMsg, "status", statusMensagem)
		}
		return nil
	})
}

func (c *Consumidor) processarEstoqueReservado(tx *gorm.DB, body []byte) (bool, error) {
	var evento struct {
		NotaID string `json:"notaId"`
		Itens  []struct {
			ProdutoID  string `json:"produtoId"`
			Quantidade int    `json:"quantidade"`
		} `json:"itens"`
		ProdutoID  string `json:"produtoId"`
		Quantidade int    `json:"quantidade"`
	}

	if err := json.Unmarshal(body, &evento); err != nil {
		return false, fmt.Errorf("falha ao fazer unmarshal: %w", err)
	}

	if len(evento.Itens) == 0 && evento.ProdutoID != "" {
		evento.Itens = append(evento.Itens, struct {
			ProdutoID  string `json:"produtoId"`
			Quantidade int    `json:"quantidade"`
		}{
			ProdutoID:  evento.ProdutoID,
			Quantidade: evento.Quantidade,
		})
	}

	if len(evento.Itens) == 0 {
		slog.Info("Evento de estoque reservado sem itens; ignorando")
		return false, nil
	}

	notaID, err := uuid.Parse(evento.NotaID)
	if err != nil {
		return false, fmt.Errorf("notaId invalido: %w", err)
	}

	slog.Info("Estoque reservado para nota, fechando nota", "notaId", notaID)

	var nota dominio.NotaFiscal
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Itens").
		First(&nota, "id = ?", notaID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			slog.Info("Nota nao encontrada; evento sera marcado como ignorado", "notaId", notaID)
			return false, nil
		}
		return false, fmt.Errorf("falha ao buscar nota: %w", err)
	}

	if nota.Status != dominio.StatusNotaAberta {
		slog.Info("Nota ja esta com status diferente; evento sera ignorado", "notaId", notaID, "status", nota.Status)
		return false, nil
	}

	if len(nota.Itens) == 0 {
		slog.Warn("Nota recebida sem itens; marcando solicitacao como falha", "notaId", notaID)
		if err := c.Handlers.MarcarFalha(notaID, "Nota sem itens nao pode ser fechada"); err != nil {
			slog.Warn("Falha ao marcar solicitacao como FALHOU", "notaId", notaID, "erro", err)
		}
		return false, nil
	}

	if err := nota.Fechar(); err != nil {
		return false, fmt.Errorf("falha ao fechar nota: %w", err)
	}

	if err := tx.Save(&nota).Error; err != nil {
		return false, fmt.Errorf("falha ao salvar nota: %w", err)
	}

	agora := time.Now()
	if err := tx.Model(&dominio.SolicitacaoImpressao{}).
		Where("nota_id = ? AND status = ?", notaID, "PENDENTE").
		Updates(map[string]interface{}{
			"status":         "CONCLUIDA",
			"data_conclusao": agora,
		}).Error; err != nil {
		return false, fmt.Errorf("falha ao atualizar solicitacao: %w", err)
	}

	slog.Info("Nota fechada com sucesso", "notaId", notaID)
	return true, nil
}

func (c *Consumidor) processarReservaRejeitada(tx *gorm.DB, body []byte) error {
	var evento struct {
		NotaID string `json:"notaId"`
		Motivo string `json:"motivo"`
	}

	if err := json.Unmarshal(body, &evento); err != nil {
		return fmt.Errorf("falha ao fazer unmarshal: %w", err)
	}

	notaID, err := uuid.Parse(evento.NotaID)
	if err != nil {
		return fmt.Errorf("notaId invalido: %w", err)
	}

	slog.Warn("Reserva rejeitada para nota", "notaId", notaID, "motivo", evento.Motivo)

	if err := tx.Model(&dominio.SolicitacaoImpressao{}).
		Where("nota_id = ? AND status = ?", notaID, "PENDENTE").
		Updates(map[string]interface{}{
			"status":        "FALHOU",
			"mensagem_erro": evento.Motivo,
		}).Error; err != nil {
		return fmt.Errorf("falha ao atualizar solicitacao: %w", err)
	}

	slog.Info("Solicitacao marcada como FALHOU", "notaId", notaID)
	return nil
}
