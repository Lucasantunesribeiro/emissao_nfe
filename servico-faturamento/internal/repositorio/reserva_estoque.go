package repositorio

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
)

// Resultado registrado para a reserva de estoque de uma nota.
const (
	ResultadoReservaConfirmada = "CONFIRMADA"
	ResultadoReservaFalhou     = "FALHOU"
)

// skReservaEstoque e o SK do registro de reserva dentro da particao da nota
// (PK = NOTA#<id>). Existe no maximo um registro por nota: e ele que torna a
// baixa de estoque idempotente.
const skReservaEstoque = "#RESERVA_ESTOQUE"

// maxItensTransacao e o limite de operacoes de TransactWriteItems no DynamoDB.
const maxItensTransacao = 100

var (
	// ErrReservaJaRegistrada indica que a nota ja teve a reserva processada
	// (confirmada ou falha). Nenhum estoque foi movimentado nesta chamada.
	ErrReservaJaRegistrada = errors.New("reserva de estoque ja registrada para a nota")
	// ErrSaldoInsuficiente e o erro-base de ErroSaldoInsuficiente.
	ErrSaldoInsuficiente = errors.New("saldo insuficiente")
	// ErrItensDemais indica nota com mais produtos do que cabe em uma transacao.
	ErrItensDemais = fmt.Errorf("nota com mais de %d produtos distintos nao cabe em uma transacao", maxItensTransacao-1)
)

// ErroSaldoInsuficiente indica o produto que impediu a reserva (inexistente,
// inativo ou com saldo menor que o solicitado). Nenhum estoque foi debitado.
type ErroSaldoInsuficiente struct {
	ProdutoID uuid.UUID
}

func (e *ErroSaldoInsuficiente) Error() string {
	return fmt.Sprintf("saldo insuficiente, produto inexistente ou inativo: %s", e.ProdutoID)
}

func (e *ErroSaldoInsuficiente) Is(target error) bool { return target == ErrSaldoInsuficiente }

// RegistroReserva e o resultado persistido da reserva de uma nota.
type RegistroReserva struct {
	Resultado string
	Motivo    string
}

func chaveReserva(notaID uuid.UUID) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", notaID)},
		"SK": &types.AttributeValueMemberS{Value: skReservaEstoque},
	}
}

func itemRegistroReserva(notaID uuid.UUID, resultado, motivo string, agora time.Time) map[string]types.AttributeValue {
	item := chaveReserva(notaID)
	item["entity_type"] = &types.AttributeValueMemberS{Value: "RESERVA_ESTOQUE"}
	item["NotaID"] = &types.AttributeValueMemberS{Value: notaID.String()}
	item["Resultado"] = &types.AttributeValueMemberS{Value: resultado}
	item["DataProcessamento"] = &types.AttributeValueMemberS{Value: agora.UTC().Format(time.RFC3339)}
	if motivo != "" {
		item["Motivo"] = &types.AttributeValueMemberS{Value: motivo}
	}
	return item
}

// produtosOrdenados devolve os produtos em ordem estavel, para que o indice
// de cada operacao na transacao seja deterministico.
func produtosOrdenados(qtds map[uuid.UUID]int) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(qtds))
	for id := range qtds {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	return ids
}

// MontarTransacaoReserva monta a transacao atomica de baixa de estoque.
//
// Indice 0: Put do registro da reserva com attribute_not_exists(PK) — garante
// que a mesma nota nunca debita estoque duas vezes (idempotencia por nota,
// independente de quantas vezes o evento for entregue).
// Indices 1..n: um Update por produto (quantidades ja agregadas), com
// condicao saldo >= :qty (nunca negativo), produto existente e ativo. Cada
// update incrementa `versao`, o mesmo atributo usado pelo servico-estoque
// (.NET) no controle otimista de concorrencia; sem isso uma escrita
// concorrente do .NET sobrescreveria a baixa feita aqui.
//
// Retorna tambem a ordem dos produtos (produtos[i] corresponde ao indice i+1).
func MontarTransacaoReserva(tableName string, notaID uuid.UUID, qtds map[uuid.UUID]int, agora time.Time) ([]types.TransactWriteItem, []uuid.UUID, error) {
	if len(qtds)+1 > maxItensTransacao {
		return nil, nil, ErrItensDemais
	}
	produtos := produtosOrdenados(qtds)

	itens := make([]types.TransactWriteItem, 0, len(produtos)+1)
	itens = append(itens, types.TransactWriteItem{
		Put: &types.Put{
			TableName:           aws.String(tableName),
			Item:                itemRegistroReserva(notaID, ResultadoReservaConfirmada, "", agora),
			ConditionExpression: aws.String("attribute_not_exists(PK)"),
		},
	})

	for _, produtoID := range produtos {
		qtd := qtds[produtoID]
		if qtd <= 0 {
			return nil, nil, fmt.Errorf("quantidade invalida (%d) para produto %s", qtd, produtoID)
		}
		itens = append(itens, types.TransactWriteItem{
			Update: &types.Update{
				TableName: aws.String(tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRODUTO#%s", produtoID)},
					"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
				},
				UpdateExpression:    aws.String("SET saldo = saldo - :qty ADD versao :um"),
				ConditionExpression: aws.String("attribute_exists(PK) AND saldo >= :qty AND (attribute_not_exists(ativo) OR ativo = :ativo)"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":qty":   &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", qtd)},
					":um":    &types.AttributeValueMemberN{Value: "1"},
					":ativo": &types.AttributeValueMemberBOOL{Value: true},
				},
			},
		})
	}
	return itens, produtos, nil
}

// ClassificarErroReserva traduz o cancelamento da transacao de reserva:
// condicao do indice 0 -> ErrReservaJaRegistrada; condicao de um produto ->
// *ErroSaldoInsuficiente. Outros erros (conflito, throttling, rede) voltam
// embrulhados para que a mensagem seja reprocessada.
func ClassificarErroReserva(err error, produtos []uuid.UUID) error {
	var tce *types.TransactionCanceledException
	if !errors.As(err, &tce) {
		return fmt.Errorf("erro ao reservar estoque: %w", err)
	}
	for i, motivo := range tce.CancellationReasons {
		if aws.ToString(motivo.Code) != "ConditionalCheckFailed" {
			continue
		}
		if i == 0 {
			return ErrReservaJaRegistrada
		}
		if i-1 < len(produtos) {
			return &ErroSaldoInsuficiente{ProdutoID: produtos[i-1]}
		}
	}
	return fmt.Errorf("transacao de reserva cancelada: %w", err)
}

// ReservarEstoqueNota debita, de forma atomica e idempotente, o estoque de
// todos os produtos da nota. Ou tudo e debitado e o registro CONFIRMADA e
// gravado, ou nada muda.
func (r *RepositorioDynamoDB) ReservarEstoqueNota(ctx context.Context, notaID uuid.UUID, qtds map[uuid.UUID]int) error {
	itens, produtos, err := MontarTransacaoReserva(r.tableName, notaID, qtds, time.Now())
	if err != nil {
		return err
	}
	if _, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: itens}); err != nil {
		return ClassificarErroReserva(err, produtos)
	}
	slog.Info("Estoque reservado", "notaId", notaID, "produtos", len(produtos))
	return nil
}

// RegistrarFalhaReserva grava o resultado FALHOU (sem movimentar estoque),
// para que reentregas do evento devolvam sempre o mesmo resultado.
func (r *RepositorioDynamoDB) RegistrarFalhaReserva(ctx context.Context, notaID uuid.UUID, motivo string) error {
	_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(r.tableName),
		Item:                itemRegistroReserva(notaID, ResultadoReservaFalhou, motivo, time.Now()),
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			return ErrReservaJaRegistrada
		}
		return fmt.Errorf("erro ao registrar falha de reserva: %w", err)
	}
	return nil
}

// BuscarRegistroReserva retorna o resultado ja registrado da reserva da nota,
// ou nil se a nota ainda nao foi processada. Usa leitura fortemente consistente.
func (r *RepositorioDynamoDB) BuscarRegistroReserva(ctx context.Context, notaID uuid.UUID) (*RegistroReserva, error) {
	out, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(r.tableName),
		Key:            chaveReserva(notaID),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("erro ao buscar registro de reserva: %w", err)
	}
	if out.Item == nil {
		return nil, nil
	}
	reg := &RegistroReserva{}
	if v, ok := out.Item["Resultado"].(*types.AttributeValueMemberS); ok {
		reg.Resultado = v.Value
	}
	if v, ok := out.Item["Motivo"].(*types.AttributeValueMemberS); ok {
		reg.Motivo = v.Value
	}
	return reg, nil
}

// TransicionarStatusNota altera o status da nota somente se o status atual
// for `de`. Retorna false (sem erro) quando a nota nao esta mais em `de` —
// por exemplo, evento de reserva reentregue apos a nota ja ter sido
// atualizada. Impede que um evento atrasado sobrescreva um estado final.
func (r *RepositorioDynamoDB) TransicionarStatusNota(ctx context.Context, notaID uuid.UUID, de, para string) (bool, error) {
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", notaID)},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		ConditionExpression: aws.String("#status = :de"),
		UpdateExpression:    aws.String("SET #status = :para, GSI2_PK = :gsi2pk"),
		ExpressionAttributeNames: map[string]string{
			"#status": "Status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":de":     &types.AttributeValueMemberS{Value: de},
			":para":   &types.AttributeValueMemberS{Value: para},
			":gsi2pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", para)},
		},
	})
	if err != nil {
		var ccf *types.ConditionalCheckFailedException
		if errors.As(err, &ccf) {
			slog.Warn("Transicao de status ignorada: nota nao esta no status esperado", "notaId", notaID, "de", de, "para", para)
			return false, nil
		}
		return false, fmt.Errorf("error updating nota status: %w", err)
	}
	slog.Info("Nota status updated", "id", notaID, "de", de, "status", para)
	return true, nil
}
