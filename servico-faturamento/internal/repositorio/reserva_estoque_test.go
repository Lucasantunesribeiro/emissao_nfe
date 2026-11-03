package repositorio

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

func TestMontarTransacaoReserva_RegistroPrimeiroEUmUpdatePorProduto(t *testing.T) {
	notaID := uuid.New()
	p1, p2 := uuid.New(), uuid.New()
	itens, produtos, err := MontarTransacaoReserva("tabela", notaID, map[uuid.UUID]int{p1: 5, p2: 1}, time.Now())
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	if len(itens) != 3 || len(produtos) != 2 {
		t.Fatalf("esperava 1 registro + 2 updates, obteve %d itens / %d produtos", len(itens), len(produtos))
	}

	reg := itens[0].Put
	if reg == nil || aws.ToString(reg.ConditionExpression) != "attribute_not_exists(PK)" {
		t.Fatalf("indice 0 deve ser Put condicional do registro de reserva")
	}
	if pk := reg.Item["PK"].(*types.AttributeValueMemberS).Value; pk != "NOTA#"+notaID.String() {
		t.Errorf("PK do registro inesperado: %s", pk)
	}
	if sk := reg.Item["SK"].(*types.AttributeValueMemberS).Value; sk != skReservaEstoque {
		t.Errorf("SK do registro inesperado: %s", sk)
	}

	for i, produtoID := range produtos {
		up := itens[i+1].Update
		if up == nil {
			t.Fatalf("indice %d deveria ser Update", i+1)
		}
		if pk := up.Key["PK"].(*types.AttributeValueMemberS).Value; pk != "PRODUTO#"+produtoID.String() {
			t.Errorf("indice %d com produto fora de ordem: %s", i+1, pk)
		}
		cond := aws.ToString(up.ConditionExpression)
		if !strings.Contains(cond, "saldo >= :qty") || !strings.Contains(cond, "attribute_exists(PK)") {
			t.Errorf("condicao deve impedir saldo negativo e produto inexistente: %s", cond)
		}
		if !strings.Contains(aws.ToString(up.UpdateExpression), "ADD versao :um") {
			t.Errorf("update deve incrementar versao (concorrencia otimista do .NET): %s", aws.ToString(up.UpdateExpression))
		}
	}
	q := itens[1].Update.ExpressionAttributeValues[":qty"].(*types.AttributeValueMemberN).Value
	esperado := map[uuid.UUID]string{p1: "5", p2: "1"}[produtos[0]]
	if q != esperado {
		t.Errorf("quantidade do primeiro produto = %s, esperado %s", q, esperado)
	}
}

func TestMontarTransacaoReserva_Limites(t *testing.T) {
	if _, _, err := MontarTransacaoReserva("t", uuid.New(), map[uuid.UUID]int{uuid.New(): 0}, time.Now()); err == nil {
		t.Error("quantidade zero deve ser rejeitada")
	}
	muitos := make(map[uuid.UUID]int, maxItensTransacao)
	for i := 0; i < maxItensTransacao; i++ {
		muitos[uuid.New()] = 1
	}
	if _, _, err := MontarTransacaoReserva("t", uuid.New(), muitos, time.Now()); !errors.Is(err, ErrItensDemais) {
		t.Errorf("esperava ErrItensDemais, obteve %v", err)
	}
	itens, _, err := MontarTransacaoReserva("t", uuid.New(), map[uuid.UUID]int{}, time.Now())
	if err != nil || len(itens) != 1 {
		t.Errorf("nota sem itens deve gerar apenas o registro: %d itens, err=%v", len(itens), err)
	}
}

func cancelamento(codigos ...string) error {
	motivos := make([]types.CancellationReason, len(codigos))
	for i, c := range codigos {
		motivos[i] = types.CancellationReason{Code: aws.String(c)}
	}
	return &types.TransactionCanceledException{Message: aws.String("cancelada"), CancellationReasons: motivos}
}

func TestClassificarErroReserva(t *testing.T) {
	p1, p2 := uuid.New(), uuid.New()
	produtos := []uuid.UUID{p1, p2}

	if err := ClassificarErroReserva(cancelamento("ConditionalCheckFailed", "None", "None"), produtos); !errors.Is(err, ErrReservaJaRegistrada) {
		t.Errorf("condicao no registro deve virar ErrReservaJaRegistrada, obteve %v", err)
	}

	err := ClassificarErroReserva(cancelamento("None", "None", "ConditionalCheckFailed"), produtos)
	var semSaldo *ErroSaldoInsuficiente
	if !errors.As(err, &semSaldo) || semSaldo.ProdutoID != p2 || !errors.Is(err, ErrSaldoInsuficiente) {
		t.Errorf("condicao no produto 2 deve identificar p2, obteve %v", err)
	}

	err = ClassificarErroReserva(cancelamento("None", "TransactionConflict", "None"), produtos)
	if errors.Is(err, ErrSaldoInsuficiente) || errors.Is(err, ErrReservaJaRegistrada) || err == nil {
		t.Errorf("conflito transitorio deve ser erro generico (retentavel), obteve %v", err)
	}

	if err := ClassificarErroReserva(errors.New("timeout"), produtos); err == nil || errors.Is(err, ErrSaldoInsuficiente) {
		t.Errorf("erro de rede deve ser retentavel, obteve %v", err)
	}
}
