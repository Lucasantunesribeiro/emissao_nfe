package repositorio

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"

	"servico-faturamento/internal/dominio"
)

// RepositorioDynamoDB implements NotaFiscal repository using DynamoDB
type RepositorioDynamoDB struct {
	client          *dynamodb.Client
	tableName       string
	eventsTableName string
}

// NewRepositorioDynamoDB creates a new DynamoDB repository
func NewRepositorioDynamoDB(client *dynamodb.Client, tableName, eventsTableName string) *RepositorioDynamoDB {
	return &RepositorioDynamoDB{
		client:          client,
		tableName:       tableName,
		eventsTableName: eventsTableName,
	}
}

// BuscarNotaPorID fetches a nota by ID from DynamoDB
func (r *RepositorioDynamoDB) BuscarNotaPorID(ctx context.Context, id uuid.UUID) (*dominio.NotaFiscal, error) {
	// Get nota metadata
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", id.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error fetching nota: %w", err)
	}

	if result.Item == nil {
		return nil, nil // Not found
	}

	// Temporary struct for unmarshaling with string IDs
	type NotaDynamoDB struct {
		ID          string     `dynamodbav:"ID"`
		Numero      string     `dynamodbav:"Numero"`
		Status      string     `dynamodbav:"Status"`
		DataCriacao time.Time  `dynamodbav:"DataCriacao"`
		DataFechada *time.Time `dynamodbav:"DataFechada,omitempty"`
	}

	var notaDDB NotaDynamoDB
	if err := attributevalue.UnmarshalMap(result.Item, &notaDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling nota: %w", err)
	}

	// Convert to domain type
	notaID, err := uuid.Parse(notaDDB.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid UUID: %w", err)
	}

	nota := &dominio.NotaFiscal{
		ID:          notaID,
		Numero:      notaDDB.Numero,
		Status:      notaDDB.Status,
		DataCriacao: notaDDB.DataCriacao,
		DataFechada: notaDDB.DataFechada,
	}

	// Get nota items
	itens, err := r.BuscarItensDaNota(ctx, notaID)
	if err != nil {
		return nil, err
	}
	nota.Itens = itens

	return nota, nil
}

// BuscarItensDaNota fetches items of a nota from DynamoDB
func (r *RepositorioDynamoDB) BuscarItensDaNota(ctx context.Context, notaID uuid.UUID) ([]dominio.ItemNota, error) {
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", notaID.String())},
			":sk": &types.AttributeValueMemberS{Value: "ITEM#"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error querying items: %w", err)
	}

	// Temporary struct for unmarshaling with string IDs
	type ItemDynamoDB struct {
		ID            string  `dynamodbav:"ID"`
		NotaID        string  `dynamodbav:"NotaID"`
		ProdutoID     string  `dynamodbav:"ProdutoID"`
		Quantidade    int     `dynamodbav:"Quantidade"`
		PrecoUnitario float64 `dynamodbav:"PrecoUnitario"`
	}

	var itensDDB []ItemDynamoDB
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &itensDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling items: %w", err)
	}

	// Convert to domain type
	itens := make([]dominio.ItemNota, 0, len(itensDDB))
	for _, item := range itensDDB {
		id, err := uuid.Parse(item.ID)
		if err != nil {
			slog.Error("Invalid UUID in item", "id", item.ID, "error", err)
			continue
		}
		nid, err := uuid.Parse(item.NotaID)
		if err != nil {
			slog.Error("Invalid UUID in item NotaID", "notaId", item.NotaID, "error", err)
			continue
		}
		pid, err := uuid.Parse(item.ProdutoID)
		if err != nil {
			slog.Error("Invalid UUID in item ProdutoID", "produtoId", item.ProdutoID, "error", err)
			continue
		}
		itens = append(itens, dominio.ItemNota{
			ID:            id,
			NotaID:        nid,
			ProdutoID:     pid,
			Quantidade:    item.Quantidade,
			PrecoUnitario: item.PrecoUnitario,
		})
	}

	return itens, nil
}

// BuscarPorNumero finds a nota by its numero (invoice number)
func (r *RepositorioDynamoDB) BuscarPorNumero(ctx context.Context, numero string) (*dominio.NotaFiscal, error) {
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1_PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("NUMERO#%s", numero)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error querying by numero: %w", err)
	}

	if len(result.Items) == 0 {
		return nil, nil // Not found
	}

	// Temporary struct for unmarshaling with string IDs
	type NotaDynamoDB struct {
		ID          string     `dynamodbav:"ID"`
		Numero      string     `dynamodbav:"Numero"`
		Status      string     `dynamodbav:"Status"`
		DataCriacao time.Time  `dynamodbav:"DataCriacao"`
		DataFechada *time.Time `dynamodbav:"DataFechada,omitempty"`
	}

	var notaDDB NotaDynamoDB
	if err := attributevalue.UnmarshalMap(result.Items[0], &notaDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling nota: %w", err)
	}

	// Convert to domain type
	notaID, err := uuid.Parse(notaDDB.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid UUID: %w", err)
	}

	nota := &dominio.NotaFiscal{
		ID:          notaID,
		Numero:      notaDDB.Numero,
		Status:      notaDDB.Status,
		DataCriacao: notaDDB.DataCriacao,
		DataFechada: notaDDB.DataFechada,
	}

	// Get items
	itens, err := r.BuscarItensDaNota(ctx, notaID)
	if err != nil {
		return nil, err
	}
	nota.Itens = itens

	return nota, nil
}

// CriarNota creates a new nota in DynamoDB
func (r *RepositorioDynamoDB) CriarNota(ctx context.Context, nota *dominio.NotaFiscal) error {
	now := time.Now()
	if nota.DataCriacao.IsZero() {
		nota.DataCriacao = now
	}
	if nota.Status == "" {
		nota.Status = dominio.StatusNotaAberta
	}

	item := map[string]types.AttributeValue{
		"PK":           &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", nota.ID.String())},
		"SK":           &types.AttributeValueMemberS{Value: "#METADATA"},
		"GSI1_PK":      &types.AttributeValueMemberS{Value: fmt.Sprintf("NUMERO#%s", nota.Numero)},
		"GSI2_PK":      &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", nota.Status)},
		"GSI2_SK":      &types.AttributeValueMemberS{Value: nota.DataCriacao.Format(time.RFC3339)},
		"entity_type":  &types.AttributeValueMemberS{Value: "NOTA"},
		"ID":           &types.AttributeValueMemberS{Value: nota.ID.String()},
		"Numero":       &types.AttributeValueMemberS{Value: nota.Numero},
		"Status":       &types.AttributeValueMemberS{Value: nota.Status},
		"DataCriacao":  &types.AttributeValueMemberS{Value: nota.DataCriacao.Format(time.RFC3339)},
	}

	if nota.DataFechada != nil {
		item["DataFechada"] = &types.AttributeValueMemberS{Value: nota.DataFechada.Format(time.RFC3339)}
	}

	_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(r.tableName),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if err != nil {
		return fmt.Errorf("error creating nota: %w", err)
	}

	slog.Info("Nota created in DynamoDB", "id", nota.ID, "numero", nota.Numero)
	return nil
}

// AdicionarItem adds an item to a nota
func (r *RepositorioDynamoDB) AdicionarItem(ctx context.Context, item *dominio.ItemNota) error {
	dynamoItem := map[string]types.AttributeValue{
		"PK":            &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", item.NotaID.String())},
		"SK":            &types.AttributeValueMemberS{Value: fmt.Sprintf("ITEM#%s", item.ID.String())},
		"entity_type":   &types.AttributeValueMemberS{Value: "ITEM"},
		"ID":            &types.AttributeValueMemberS{Value: item.ID.String()},
		"NotaID":        &types.AttributeValueMemberS{Value: item.NotaID.String()},
		"ProdutoID":     &types.AttributeValueMemberS{Value: item.ProdutoID.String()},
		"Quantidade":    &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", item.Quantidade)},
		"PrecoUnitario": &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", item.PrecoUnitario)},
	}

	_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      dynamoItem,
	})
	if err != nil {
		return fmt.Errorf("error adding item: %w", err)
	}

	slog.Info("Item added to nota", "notaId", item.NotaID, "itemId", item.ID)
	return nil
}

// FecharNota closes a nota using DynamoDB transaction
func (r *RepositorioDynamoDB) FecharNota(ctx context.Context, notaID uuid.UUID) error {
	now := time.Now()

	// Transaction: Update nota status + Create outbox event
	_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{
				Update: &types.Update{
					TableName: aws.String(r.tableName),
					Key: map[string]types.AttributeValue{
						"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", notaID.String())},
						"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
					},
					ConditionExpression: aws.String("#status = :aberta"),
					UpdateExpression:    aws.String("SET #status = :fechada, DataFechada = :now, GSI2_PK = :status_pk"),
					ExpressionAttributeNames: map[string]string{
						"#status": "Status",
					},
					ExpressionAttributeValues: map[string]types.AttributeValue{
						":aberta":    &types.AttributeValueMemberS{Value: dominio.StatusNotaAberta},
						":fechada":   &types.AttributeValueMemberS{Value: dominio.StatusNotaFechada},
						":now":       &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
						":status_pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", dominio.StatusNotaFechada)},
					},
				},
			},
			{
				Put: &types.Put{
					TableName: aws.String(r.eventsTableName),
					Item: map[string]types.AttributeValue{
						"PK":          &types.AttributeValueMemberS{Value: fmt.Sprintf("OUTBOX#%d", now.Unix())},
						"SK":          &types.AttributeValueMemberS{Value: uuid.New().String()},
						"TTL":         &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Add(7*24*time.Hour).Unix())},
						"TipoEvento":  &types.AttributeValueMemberS{Value: "Faturamento.NotaFechada"},
						"IdAgregado":  &types.AttributeValueMemberS{Value: notaID.String()},
						"Payload":     &types.AttributeValueMemberS{Value: fmt.Sprintf(`{"notaId":"%s","timestamp":"%s"}`, notaID.String(), now.Format(time.RFC3339))},
						"DataOcorrencia": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
					},
				},
			},
		},
	})

	if err != nil {
		return fmt.Errorf("error closing nota: %w", err)
	}

	slog.Info("Nota closed", "id", notaID)
	return nil
}

// ListarNotas lists notas filtered by status. If status is empty, returns all notas.
func (r *RepositorioDynamoDB) ListarNotas(ctx context.Context, status string) ([]dominio.NotaFiscal, error) {
	if status != "" {
		return r.listarNotasPorStatus(ctx, status)
	}
	return r.listarTodasNotas(ctx)
}

// ListarNotasAbertas lists all open notas (kept for backward compatibility).
func (r *RepositorioDynamoDB) ListarNotasAbertas(ctx context.Context) ([]dominio.NotaFiscal, error) {
	return r.listarNotasPorStatus(ctx, dominio.StatusNotaAberta)
}

func unmarshalNotas(items []map[string]types.AttributeValue) ([]dominio.NotaFiscal, error) {
	type NotaDynamoDB struct {
		ID          string     `dynamodbav:"ID"`
		Numero      string     `dynamodbav:"Numero"`
		Status      string     `dynamodbav:"Status"`
		DataCriacao time.Time  `dynamodbav:"DataCriacao"`
		DataFechada *time.Time `dynamodbav:"DataFechada,omitempty"`
	}

	var notasDDB []NotaDynamoDB
	if err := attributevalue.UnmarshalListOfMaps(items, &notasDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling notas: %w", err)
	}

	notas := make([]dominio.NotaFiscal, 0, len(notasDDB))
	for _, n := range notasDDB {
		id, err := uuid.Parse(n.ID)
		if err != nil {
			slog.Error("Invalid UUID in nota", "id", n.ID, "error", err)
			continue
		}
		notas = append(notas, dominio.NotaFiscal{
			ID:          id,
			Numero:      n.Numero,
			Status:      n.Status,
			DataCriacao: n.DataCriacao,
			DataFechada: n.DataFechada,
		})
	}

	return notas, nil
}

func (r *RepositorioDynamoDB) listarNotasPorStatus(ctx context.Context, status string) ([]dominio.NotaFiscal, error) {
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		IndexName:              aws.String("GSI2"),
		KeyConditionExpression: aws.String("GSI2_PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", status)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error listing notas by status %s: %w", status, err)
	}

	return unmarshalNotas(result.Items)
}

func (r *RepositorioDynamoDB) listarTodasNotas(ctx context.Context) ([]dominio.NotaFiscal, error) {
	result, err := r.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(r.tableName),
		FilterExpression: aws.String("entity_type = :et"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":et": &types.AttributeValueMemberS{Value: "NOTA"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error listing all notas: %w", err)
	}

	return unmarshalNotas(result.Items)
}

// MarcarMensagemProcessada marks a message as processed for idempotency
func (r *RepositorioDynamoDB) MarcarMensagemProcessada(ctx context.Context, idMensagem string) error {
	ttl := time.Now().Add(7 * 24 * time.Hour).Unix()

	_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.eventsTableName),
		Item: map[string]types.AttributeValue{
			"PK":             &types.AttributeValueMemberS{Value: fmt.Sprintf("IDEM#%s", idMensagem)},
			"SK":             &types.AttributeValueMemberS{Value: "#METADATA"},
			"TTL":            &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
			"IdMensagem":     &types.AttributeValueMemberS{Value: idMensagem},
			"DataProcessada": &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})

	if err != nil {
		// Conditional check failed means message already processed
		return fmt.Errorf("message already processed: %w", err)
	}

	return nil
}

// MensagemJaProcessada checks if a message was already processed
func (r *RepositorioDynamoDB) MensagemJaProcessada(ctx context.Context, idMensagem string) (bool, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.eventsTableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("IDEM#%s", idMensagem)},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
	})
	if err != nil {
		return false, fmt.Errorf("error checking message: %w", err)
	}

	return result.Item != nil, nil
}

// BuscarSolicitacaoPorChave finds a print request by idempotency key
func (r *RepositorioDynamoDB) BuscarSolicitacaoPorChave(ctx context.Context, chaveIdempotencia string) (*dominio.SolicitacaoImpressao, error) {
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		IndexName:              aws.String("GSI1"),
		KeyConditionExpression: aws.String("GSI1_PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("IDEM#%s", chaveIdempotencia)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error querying by idempotency key: %w", err)
	}

	if len(result.Items) == 0 {
		return nil, nil // Not found
	}

	// Temporary struct for unmarshaling
	type SolDynamoDB struct {
		ID                string     `dynamodbav:"ID"`
		NotaID            string     `dynamodbav:"NotaID"`
		Status            string     `dynamodbav:"Status"`
		MensagemErro      *string    `dynamodbav:"MensagemErro,omitempty"`
		PdfURL            *string    `dynamodbav:"PdfURL,omitempty"`
		ChaveIdempotencia string     `dynamodbav:"ChaveIdempotencia"`
		DataCriacao       time.Time  `dynamodbav:"DataCriacao"`
		DataConclusao     *time.Time `dynamodbav:"DataConclusao,omitempty"`
	}

	var solDDB SolDynamoDB
	if err := attributevalue.UnmarshalMap(result.Items[0], &solDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling solicitacao: %w", err)
	}

	// Convert to domain type
	id, err := uuid.Parse(solDDB.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid ID UUID: %w", err)
	}
	notaID, err := uuid.Parse(solDDB.NotaID)
	if err != nil {
		return nil, fmt.Errorf("invalid NotaID UUID: %w", err)
	}

	return &dominio.SolicitacaoImpressao{
		ID:                id,
		NotaID:            notaID,
		Status:            solDDB.Status,
		MensagemErro:      solDDB.MensagemErro,
		PdfURL:            solDDB.PdfURL,
		ChaveIdempotencia: solDDB.ChaveIdempotencia,
		DataCriacao:       solDDB.DataCriacao,
		DataConclusao:     solDDB.DataConclusao,
	}, nil
}

// CriarSolicitacaoImpressao creates a new print request in DynamoDB
func (r *RepositorioDynamoDB) CriarSolicitacaoImpressao(ctx context.Context, sol *dominio.SolicitacaoImpressao) error {
	now := time.Now()
	if sol.DataCriacao.IsZero() {
		sol.DataCriacao = now
	}
	if sol.Status == "" {
		sol.Status = "PENDENTE"
	}

	item := map[string]types.AttributeValue{
		"PK":                &types.AttributeValueMemberS{Value: fmt.Sprintf("PRINT#%s", sol.ID.String())},
		"SK":                &types.AttributeValueMemberS{Value: "#METADATA"},
		"GSI1_PK":           &types.AttributeValueMemberS{Value: fmt.Sprintf("IDEM#%s", sol.ChaveIdempotencia)},
		"GSI2_PK":           &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", sol.Status)},
		"GSI2_SK":           &types.AttributeValueMemberS{Value: sol.DataCriacao.Format(time.RFC3339)},
		"entity_type":       &types.AttributeValueMemberS{Value: "PRINT"},
		"ID":                &types.AttributeValueMemberS{Value: sol.ID.String()},
		"NotaID":            &types.AttributeValueMemberS{Value: sol.NotaID.String()},
		"Status":            &types.AttributeValueMemberS{Value: sol.Status},
		"ChaveIdempotencia": &types.AttributeValueMemberS{Value: sol.ChaveIdempotencia},
		"DataCriacao":       &types.AttributeValueMemberS{Value: sol.DataCriacao.Format(time.RFC3339)},
	}

	if sol.MensagemErro != nil {
		item["MensagemErro"] = &types.AttributeValueMemberS{Value: *sol.MensagemErro}
	}
	if sol.PdfURL != nil {
		item["PdfURL"] = &types.AttributeValueMemberS{Value: *sol.PdfURL}
	}
	if sol.DataConclusao != nil {
		item["DataConclusao"] = &types.AttributeValueMemberS{Value: sol.DataConclusao.Format(time.RFC3339)}
	}

	_, err := r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("error creating print request: %w", err)
	}

	return nil
}

// PublicarEvento publishes an event to the events table (outbox pattern)
func (r *RepositorioDynamoDB) PublicarEvento(ctx context.Context, tipoEvento string, idAgregado uuid.UUID, payload interface{}) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("error marshaling payload: %w", err)
	}

	now := time.Now()
	eventID := uuid.New()

	item := map[string]types.AttributeValue{
		"PK":              &types.AttributeValueMemberS{Value: fmt.Sprintf("OUTBOX#%d", now.Unix())},
		"SK":              &types.AttributeValueMemberS{Value: eventID.String()},
		"tipo_evento":     &types.AttributeValueMemberS{Value: tipoEvento},
		"id_agregado":     &types.AttributeValueMemberS{Value: idAgregado.String()},
		"payload":         &types.AttributeValueMemberS{Value: string(payloadJSON)},
		"data_ocorrencia": &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		"TTL":             &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Add(7*24*time.Hour).Unix())},
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.eventsTableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("error publishing event: %w", err)
	}

	slog.Info("Event published", "type", tipoEvento, "aggregateId", idAgregado)
	return nil
}

// BuscarSaldoProduto reads the product stock directly from the shared DynamoDB table.
// Returns (saldo, exists, error). Returns exists=false if product not found or inactive.
func (r *RepositorioDynamoDB) BuscarSaldoProduto(ctx context.Context, produtoID uuid.UUID) (int, bool, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRODUTO#%s", produtoID.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		ProjectionExpression: aws.String("saldo, ativo"),
	})
	if err != nil {
		return 0, false, fmt.Errorf("error fetching product: %w", err)
	}

	if result.Item == nil {
		return 0, false, nil
	}

	if ativoAttr, ok := result.Item["ativo"]; ok {
		if b, ok := ativoAttr.(*types.AttributeValueMemberBOOL); ok && !b.Value {
			return 0, false, nil // inactive product
		}
	}

	saldoAttr, ok := result.Item["saldo"]
	if !ok {
		return 0, true, nil
	}

	saldoNum, ok := saldoAttr.(*types.AttributeValueMemberN)
	if !ok {
		return 0, true, nil
	}

	saldo, err := strconv.Atoi(saldoNum.Value)
	if err != nil {
		return 0, true, fmt.Errorf("invalid saldo value: %w", err)
	}

	return saldo, true, nil
}

// AtualizarStatusNota updates the status of a nota
func (r *RepositorioDynamoDB) AtualizarStatusNota(ctx context.Context, notaID uuid.UUID, novoStatus string) error {
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("NOTA#%s", notaID.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		UpdateExpression: aws.String("SET #status = :status, GSI2_PK = :gsi2pk"),
		ExpressionAttributeNames: map[string]string{
			"#status": "Status",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":status":  &types.AttributeValueMemberS{Value: novoStatus},
			":gsi2pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", novoStatus)},
		},
	})
	if err != nil {
		return fmt.Errorf("error updating nota status: %w", err)
	}
	slog.Info("Nota status updated", "id", notaID, "status", novoStatus)
	return nil
}

// AtualizarSolicitacaoImpressao updates a print request with result
func (r *RepositorioDynamoDB) AtualizarSolicitacaoImpressao(ctx context.Context, solID uuid.UUID, status, pdfURL string, errMsg *string) error {
	now := time.Now()

	expr := "SET #status = :status, DataConclusao = :now, GSI2_PK = :gsi2pk"
	vals := map[string]types.AttributeValue{
		":status":  &types.AttributeValueMemberS{Value: status},
		":now":     &types.AttributeValueMemberS{Value: now.Format(time.RFC3339)},
		":gsi2pk": &types.AttributeValueMemberS{Value: fmt.Sprintf("STATUS#%s", status)},
	}

	if pdfURL != "" {
		expr += ", PdfURL = :pdfurl"
		vals[":pdfurl"] = &types.AttributeValueMemberS{Value: pdfURL}
	}
	if errMsg != nil {
		expr += ", MensagemErro = :errmsg"
		vals[":errmsg"] = &types.AttributeValueMemberS{Value: *errMsg}
	}

	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRINT#%s", solID.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		UpdateExpression:          aws.String(expr),
		ExpressionAttributeNames:  map[string]string{"#status": "Status"},
		ExpressionAttributeValues: vals,
	})
	if err != nil {
		return fmt.Errorf("error updating print request: %w", err)
	}
	slog.Info("Print request updated", "id", solID, "status", status)
	return nil
}

// ReservarEstoqueProduto atomically decrements product stock
func (r *RepositorioDynamoDB) ReservarEstoqueProduto(ctx context.Context, produtoID uuid.UUID, quantidade int) error {
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRODUTO#%s", produtoID.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		UpdateExpression:    aws.String("SET saldo = saldo - :qty"),
		ConditionExpression: aws.String("attribute_exists(PK) AND saldo >= :qty"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":qty": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", quantidade)},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to reserve stock for produto %s: %w", produtoID, err)
	}
	slog.Info("Stock reserved", "produtoId", produtoID, "quantidade", quantidade)
	return nil
}

// LiberarEstoqueProduto adds back stock (compensation for failed reservation)
func (r *RepositorioDynamoDB) LiberarEstoqueProduto(ctx context.Context, produtoID uuid.UUID, quantidade int) error {
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRODUTO#%s", produtoID.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
		UpdateExpression: aws.String("SET saldo = saldo + :qty"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":qty": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", quantidade)},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to release stock for produto %s: %w", produtoID, err)
	}
	slog.Info("Stock released (compensation)", "produtoId", produtoID, "quantidade", quantidade)
	return nil
}

// BuscarSolicitacaoPorID finds a print request by ID
func (r *RepositorioDynamoDB) BuscarSolicitacaoPorID(ctx context.Context, id uuid.UUID) (*dominio.SolicitacaoImpressao, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: fmt.Sprintf("PRINT#%s", id.String())},
			"SK": &types.AttributeValueMemberS{Value: "#METADATA"},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("error fetching print request: %w", err)
	}

	if result.Item == nil {
		return nil, nil // Not found
	}

	// Temporary struct for unmarshaling
	type SolDynamoDB struct {
		ID                string     `dynamodbav:"ID"`
		NotaID            string     `dynamodbav:"NotaID"`
		Status            string     `dynamodbav:"Status"`
		MensagemErro      *string    `dynamodbav:"MensagemErro,omitempty"`
		PdfURL            *string    `dynamodbav:"PdfURL,omitempty"`
		ChaveIdempotencia string     `dynamodbav:"ChaveIdempotencia"`
		DataCriacao       time.Time  `dynamodbav:"DataCriacao"`
		DataConclusao     *time.Time `dynamodbav:"DataConclusao,omitempty"`
	}

	var solDDB SolDynamoDB
	if err := attributevalue.UnmarshalMap(result.Item, &solDDB); err != nil {
		return nil, fmt.Errorf("error unmarshaling solicitacao: %w", err)
	}

	// Convert to domain type
	solID, err := uuid.Parse(solDDB.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid ID UUID: %w", err)
	}
	notaID, err := uuid.Parse(solDDB.NotaID)
	if err != nil {
		return nil, fmt.Errorf("invalid NotaID UUID: %w", err)
	}

	return &dominio.SolicitacaoImpressao{
		ID:                solID,
		NotaID:            notaID,
		Status:            solDDB.Status,
		MensagemErro:      solDDB.MensagemErro,
		PdfURL:            solDDB.PdfURL,
		ChaveIdempotencia: solDDB.ChaveIdempotencia,
		DataCriacao:       solDDB.DataCriacao,
		DataConclusao:     solDDB.DataConclusao,
	}, nil
}
