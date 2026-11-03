package publicador_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge"
	"github.com/aws/aws-sdk-go-v2/service/eventbridge/types"

	"servico-faturamento/internal/publicador"
)

func TestVerificarResultadoPutEvents_SemFalha(t *testing.T) {
	out := &eventbridge.PutEventsOutput{
		FailedEntryCount: 0,
		Entries:          []types.PutEventsResultEntry{{EventId: aws.String("abc")}},
	}
	if err := publicador.VerificarResultadoPutEvents(out); err != nil {
		t.Fatalf("esperava nil, obteve %v", err)
	}
}

func TestVerificarResultadoPutEvents_FalhaParcialViraErro(t *testing.T) {
	// PutEvents devolve err == nil nesse caso; a falha so aparece aqui.
	out := &eventbridge.PutEventsOutput{
		FailedEntryCount: 1,
		Entries: []types.PutEventsResultEntry{{
			ErrorCode:    aws.String("ThrottlingException"),
			ErrorMessage: aws.String("Rate exceeded"),
		}},
	}
	err := publicador.VerificarResultadoPutEvents(out)
	if !errors.Is(err, publicador.ErrEventoRejeitado) {
		t.Fatalf("esperava ErrEventoRejeitado, obteve %v", err)
	}
	if !strings.Contains(err.Error(), "ThrottlingException") {
		t.Errorf("mensagem deveria conter o codigo do EventBridge: %v", err)
	}
}

func TestVerificarResultadoPutEvents_ContagemSemDetalhe(t *testing.T) {
	out := &eventbridge.PutEventsOutput{FailedEntryCount: 2}
	if err := publicador.VerificarResultadoPutEvents(out); !errors.Is(err, publicador.ErrEventoRejeitado) {
		t.Fatalf("esperava ErrEventoRejeitado, obteve %v", err)
	}
}

func TestVerificarResultadoPutEvents_RespostaNula(t *testing.T) {
	if err := publicador.VerificarResultadoPutEvents(nil); !errors.Is(err, publicador.ErrEventoRejeitado) {
		t.Fatalf("esperava ErrEventoRejeitado, obteve %v", err)
	}
}
