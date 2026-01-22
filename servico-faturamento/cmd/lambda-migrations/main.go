package main

import (
	"context"
	"fmt"
	"servico-faturamento/internal/config"

	"github.com/aws/aws-lambda-go/lambda"
)

type Response struct {
	Message string `json:"message"`
	Status  string `json:"status"`
}

func handler(ctx context.Context) (Response, error) {
	db, err := config.InicializarDB()
	if err != nil {
		return Response{Message: fmt.Sprintf("Erro ao conectar: %v", err), Status: "error"}, err
	}

	// Limpar faturamento
	db.Exec("SET search_path TO faturamento")
	db.Exec("DELETE FROM eventos_outbox")
	db.Exec("DELETE FROM mensagens_processadas")
	db.Exec("DELETE FROM solicitacoes_impressao")
	db.Exec("DELETE FROM itens_nota")
	db.Exec("DELETE FROM notas_fiscais")

	// Limpar estoque
	db.Exec("SET search_path TO estoque")
	db.Exec("DELETE FROM eventos_outbox")
	db.Exec("DELETE FROM mensagens_processadas")
	db.Exec("DELETE FROM reservas_estoque")
	db.Exec("DELETE FROM produtos")

	// Criar dados de teste
	db.Exec(`INSERT INTO estoque.produtos (id, nome, saldo, data_criacao, data_atualizacao) VALUES ('550e8400-e29b-41d4-a716-446655440000', 'Produto Teste - Notebook Dell', 100, NOW(), NOW())`)
	
	db.Exec("SET search_path TO faturamento")
	db.Exec(`INSERT INTO faturamento.notas_fiscais (id, numero, status, data_criacao) VALUES ('a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', 'NFE-TESTE-001', 'ABERTA', NOW())`)
	db.Exec(`INSERT INTO faturamento.itens_nota (id, nota_id, produto_id, quantidade, preco_unitario) VALUES ('f6e5d4c3-b2a1-4c5d-8e9f-0a1b2c3d4e5f', 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d', '550e8400-e29b-41d4-a716-446655440000', 2, 1500.00)`)

	return Response{
		Message: "Banco limpo e dados de teste criados com sucesso!",
		Status:  "success",
	}, nil
}

func main() {
	lambda.Start(handler)
}
