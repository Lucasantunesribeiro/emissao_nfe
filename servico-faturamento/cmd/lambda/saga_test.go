package main

import (
	"context"
	"errors"
	"testing"

	"github.com/aws/aws-lambda-go/events"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
)

type chamada struct {
	notaID   uuid.UUID
	de, para string
}

func msg(id, body string) events.SQSMessage {
	return events.SQSMessage{MessageId: id, Body: body}
}

func TestProcessarLoteSaga_TransicoesEFalhasPorRegistro(t *testing.T) {
	notaOK := uuid.New()
	notaCancelada := uuid.New()
	notaErroDynamo := uuid.New()

	var chamadas []chamada
	transicionar := func(_ context.Context, id uuid.UUID, de, para string) (bool, error) {
		chamadas = append(chamadas, chamada{id, de, para})
		if id == notaErroDynamo {
			return false, errors.New("ProvisionedThroughputExceeded")
		}
		return true, nil
	}

	lote := events.SQSEvent{Records: []events.SQSMessage{
		msg("m1", `{"detail-type":"ReservaConfirmada","detail":{"notaId":"`+notaOK.String()+`"}}`),
		msg("m2", `{"detail-type":"ReservaFalhou","detail":{"notaId":"`+notaCancelada.String()+`","motivo":"sem saldo"}}`),
		msg("m3", `{"detail-type":"ReservaConfirmada","detail":{"notaId":"`+notaErroDynamo.String()+`"}}`),
		msg("m4", `{"detail-type":"ReservaConfirmada","detail":{"notaId":"nao-e-uuid"}}`),
		msg("m5", `nao e json`),
		msg("m6", `{"detail-type":"OutroEvento","detail":{}}`),
	}}

	resp := processarLoteSaga(context.Background(), transicionar, lote)

	falhas := map[string]bool{}
	for _, f := range resp.BatchItemFailures {
		falhas[f.ItemIdentifier] = true
	}
	// Erro de DynamoDB e mensagens invalidas voltam para a fila (retry/DLQ);
	// antes eram confirmadas e a nota ficava presa em FECHADA.
	for _, id := range []string{"m3", "m4", "m5"} {
		if !falhas[id] {
			t.Errorf("%s deveria estar em BatchItemFailures", id)
		}
	}
	for _, id := range []string{"m1", "m2", "m6"} {
		if falhas[id] {
			t.Errorf("%s nao deveria falhar", id)
		}
	}

	esperadas := []chamada{
		{notaOK, dominio.StatusNotaFechada, dominio.StatusNotaReservada},
		{notaCancelada, dominio.StatusNotaFechada, dominio.StatusNotaCancelada},
		{notaErroDynamo, dominio.StatusNotaFechada, dominio.StatusNotaReservada},
	}
	if len(chamadas) != len(esperadas) {
		t.Fatalf("esperava %d transicoes, obteve %d: %+v", len(esperadas), len(chamadas), chamadas)
	}
	for i, c := range esperadas {
		if chamadas[i] != c {
			t.Errorf("transicao %d: esperava %+v, obteve %+v", i, c, chamadas[i])
		}
	}
}

func TestProcessarLoteSaga_EventoReentregueAposEstadoFinalNaoFalha(t *testing.T) {
	// TransicionarStatusNota devolve (false, nil) quando a nota ja saiu de FECHADA.
	transicionar := func(context.Context, uuid.UUID, string, string) (bool, error) { return false, nil }
	lote := events.SQSEvent{Records: []events.SQSMessage{
		msg("m1", `{"detail-type":"ReservaConfirmada","detail":{"notaId":"`+uuid.NewString()+`"}}`),
	}}

	if resp := processarLoteSaga(context.Background(), transicionar, lote); len(resp.BatchItemFailures) != 0 {
		t.Fatalf("reentrega idempotente nao deveria falhar: %+v", resp.BatchItemFailures)
	}
}
