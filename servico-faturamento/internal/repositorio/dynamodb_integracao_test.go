package repositorio

// Testes de integracao contra o DynamoDB Local. So rodam quando
// DYNAMODB_ENDPOINT esta definido, por exemplo:
//
//	docker run -d -p 8000:8000 amazon/dynamodb-local:2.5.2
//	DYNAMODB_ENDPOINT=http://localhost:8000 go test ./internal/repositorio/ -run Integracao

import (
	"context"
	"errors"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
)

func repoIntegracao(t *testing.T) (*RepositorioDynamoDB, *dynamodb.Client, string) {
	t.Helper()
	endpoint := os.Getenv("DYNAMODB_ENDPOINT")
	if endpoint == "" {
		t.Skip("DYNAMODB_ENDPOINT nao definido; pulando teste de integracao")
	}
	client := dynamodb.NewFromConfig(aws.Config{
		Region: "us-east-1",
		Credentials: aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
			return aws.Credentials{AccessKeyID: "local", SecretAccessKey: "local"}, nil
		}),
	}, func(o *dynamodb.Options) { o.BaseEndpoint = aws.String(endpoint) })

	tabela := "nfe-teste-" + uuid.NewString()[:8]
	ctx := context.Background()
	_, err := client.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:   aws.String(tabela),
		BillingMode: types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String("PK"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("SK"), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String("PK"), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String("SK"), KeyType: types.KeyTypeRange},
		},
	})
	if err != nil {
		t.Fatalf("erro ao criar tabela: %v", err)
	}
	t.Cleanup(func() {
		_, _ = client.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{TableName: aws.String(tabela)})
	})
	return NewRepositorioDynamoDB(client, tabela, tabela), client, tabela
}

func criarProduto(t *testing.T, client *dynamodb.Client, tabela string, id uuid.UUID, saldo int, ativo bool) {
	t.Helper()
	_, err := client.PutItem(context.Background(), &dynamodb.PutItemInput{
		TableName: aws.String(tabela),
		Item: map[string]types.AttributeValue{
			"PK":     &types.AttributeValueMemberS{Value: "PRODUTO#" + id.String()},
			"SK":     &types.AttributeValueMemberS{Value: "#METADATA"},
			"saldo":  &types.AttributeValueMemberN{Value: strconv.Itoa(saldo)},
			"versao": &types.AttributeValueMemberN{Value: "3"},
			"ativo":  &types.AttributeValueMemberBOOL{Value: ativo},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func lerProduto(t *testing.T, client *dynamodb.Client, tabela string, id uuid.UUID) (saldo, versao string) {
	t.Helper()
	out, err := client.GetItem(context.Background(), &dynamodb.GetItemInput{
		TableName:      aws.String(tabela),
		ConsistentRead: aws.Bool(true),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: "PRODUTO#" + id.String()},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return out.Item["saldo"].(*types.AttributeValueMemberN).Value, out.Item["versao"].(*types.AttributeValueMemberN).Value
}

func TestIntegracao_ReservarEstoqueNota_ConcorrenteDebitaUmaVez(t *testing.T) {
	repo, client, tabela := repoIntegracao(t)
	ctx := context.Background()
	produto := uuid.New()
	criarProduto(t, client, tabela, produto, 10, true)
	notaID := uuid.New()

	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		sucessos int
	)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := repo.ReservarEstoqueNota(ctx, notaID, map[uuid.UUID]int{produto: 4})
			if err == nil {
				mu.Lock()
				sucessos++
				mu.Unlock()
			} else if errors.Is(err, ErrSaldoInsuficiente) {
				t.Errorf("nao deveria faltar saldo: %v", err)
			}
		}()
	}
	wg.Wait()

	if sucessos != 1 {
		t.Fatalf("esperava exatamente 1 reserva aplicada, obteve %d", sucessos)
	}
	saldo, versao := lerProduto(t, client, tabela, produto)
	if saldo != "6" || versao != "4" {
		t.Fatalf("esperava saldo=6 versao=4, obteve saldo=%s versao=%s", saldo, versao)
	}
	reg, err := repo.BuscarRegistroReserva(ctx, notaID)
	if err != nil || reg == nil || reg.Resultado != ResultadoReservaConfirmada {
		t.Fatalf("registro de reserva esperado CONFIRMADA, obteve %+v (err=%v)", reg, err)
	}
	if err := repo.ReservarEstoqueNota(ctx, notaID, map[uuid.UUID]int{produto: 4}); !errors.Is(err, ErrReservaJaRegistrada) {
		t.Fatalf("reentrega deve retornar ErrReservaJaRegistrada, obteve %v", err)
	}
}

func TestIntegracao_ReservarEstoqueNota_SaldoInsuficienteEhAtomico(t *testing.T) {
	repo, client, tabela := repoIntegracao(t)
	ctx := context.Background()
	p1, p2, inativo := uuid.New(), uuid.New(), uuid.New()
	criarProduto(t, client, tabela, p1, 10, true)
	criarProduto(t, client, tabela, p2, 2, true)
	criarProduto(t, client, tabela, inativo, 100, false)

	notaID := uuid.New()
	err := repo.ReservarEstoqueNota(ctx, notaID, map[uuid.UUID]int{p1: 5, p2: 3})
	var semSaldo *ErroSaldoInsuficiente
	if !errors.As(err, &semSaldo) || semSaldo.ProdutoID != p2 {
		t.Fatalf("esperava saldo insuficiente em p2, obteve %v", err)
	}
	if s, _ := lerProduto(t, client, tabela, p1); s != "10" {
		t.Fatalf("p1 nao pode ser debitado quando p2 falha (atomicidade), saldo=%s", s)
	}
	if s, _ := lerProduto(t, client, tabela, p2); s != "2" {
		t.Fatalf("p2 nao pode ficar negativo, saldo=%s", s)
	}
	if reg, _ := repo.BuscarRegistroReserva(ctx, notaID); reg != nil {
		t.Fatalf("falha nao deve gravar registro CONFIRMADA: %+v", reg)
	}

	if err := repo.ReservarEstoqueNota(ctx, uuid.New(), map[uuid.UUID]int{inativo: 1}); !errors.Is(err, ErrSaldoInsuficiente) {
		t.Fatalf("produto inativo deve ser recusado, obteve %v", err)
	}
	if err := repo.ReservarEstoqueNota(ctx, uuid.New(), map[uuid.UUID]int{uuid.New(): 1}); !errors.Is(err, ErrSaldoInsuficiente) {
		t.Fatalf("produto inexistente deve ser recusado, obteve %v", err)
	}

	if err := repo.RegistrarFalhaReserva(ctx, notaID, "sem saldo"); err != nil {
		t.Fatal(err)
	}
	if err := repo.RegistrarFalhaReserva(ctx, notaID, "sem saldo"); !errors.Is(err, ErrReservaJaRegistrada) {
		t.Fatalf("segunda falha deve retornar ErrReservaJaRegistrada, obteve %v", err)
	}
	if err := repo.ReservarEstoqueNota(ctx, notaID, map[uuid.UUID]int{p1: 1}); !errors.Is(err, ErrReservaJaRegistrada) {
		t.Fatalf("nota com falha registrada nao pode reservar depois, obteve %v", err)
	}
}

func TestIntegracao_TransicionarStatusNota_SoAPartirDoStatusEsperado(t *testing.T) {
	repo, _, _ := repoIntegracao(t)
	ctx := context.Background()
	nota := &dominio.NotaFiscal{ID: uuid.New(), Numero: "NF-1", Status: dominio.StatusNotaFechada, DataCriacao: time.Now()}
	if err := repo.CriarNota(ctx, nota); err != nil {
		t.Fatal(err)
	}

	ok, err := repo.TransicionarStatusNota(ctx, nota.ID, dominio.StatusNotaFechada, dominio.StatusNotaCancelada)
	if err != nil || !ok {
		t.Fatalf("transicao FECHADA->CANCELADA deveria aplicar: ok=%v err=%v", ok, err)
	}
	// Evento atrasado de confirmacao nao pode "ressuscitar" a nota cancelada.
	ok, err = repo.TransicionarStatusNota(ctx, nota.ID, dominio.StatusNotaFechada, dominio.StatusNotaReservada)
	if err != nil || ok {
		t.Fatalf("transicao a partir de status errado deve ser no-op: ok=%v err=%v", ok, err)
	}
	lida, _ := repo.BuscarNotaPorID(ctx, nota.ID)
	if lida.Status != dominio.StatusNotaCancelada {
		t.Fatalf("status final esperado CANCELADA, obteve %s", lida.Status)
	}
}

func TestIntegracao_PrecoUnitario_RoundTripEmCentavos(t *testing.T) {
	repo, client, tabela := repoIntegracao(t)
	ctx := context.Background()
	notaID := uuid.New()
	item := &dominio.ItemNota{ID: uuid.New(), NotaID: notaID, ProdutoID: uuid.New(), Quantidade: 3, PrecoUnitario: dominio.Centavos(29)}
	if err := repo.AdicionarItem(ctx, item); err != nil {
		t.Fatal(err)
	}
	// Item legado gravado antes da mudanca (formato %.2f / numero curto).
	_, err := client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(tabela),
		Item: map[string]types.AttributeValue{
			"PK":            &types.AttributeValueMemberS{Value: "NOTA#" + notaID.String()},
			"SK":            &types.AttributeValueMemberS{Value: "ITEM#legado"},
			"ID":            &types.AttributeValueMemberS{Value: uuid.NewString()},
			"NotaID":        &types.AttributeValueMemberS{Value: notaID.String()},
			"ProdutoID":     &types.AttributeValueMemberS{Value: uuid.NewString()},
			"Quantidade":    &types.AttributeValueMemberN{Value: "1"},
			"PrecoUnitario": &types.AttributeValueMemberN{Value: "10.5"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	itens, err := repo.BuscarItensDaNota(ctx, notaID)
	if err != nil {
		t.Fatal(err)
	}
	soma := map[int64]bool{}
	for _, it := range itens {
		soma[it.PrecoUnitario.Centavos()] = true
	}
	if len(itens) != 2 || !soma[29] || !soma[1050] {
		t.Fatalf("precos lidos incorretos: %+v", itens)
	}
}
