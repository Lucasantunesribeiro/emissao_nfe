# servico-faturamento

Lambdas Go do faturamento. Visao geral, arquitetura e como rodar estao no [README da raiz](../README.md); decisoes em [`docs/adr`](../docs/adr).

| Entrada | Funcao |
|---|---|
| `cmd/lambda` | API de notas e solicitacoes de impressao (API Gateway) e handler SQS da saga (`ReservaConfirmada`/`ReservaFalhou`). Com `HTTP_ADDR` serve HTTP comum (`internal/demohttp`) |
| `cmd/lambda-estoque-consumer` | Reserva de estoque atomica e idempotente por nota a partir de `Faturamento.NotaFechada` |
| `cmd/lambda-pdf` | Gera o PDF da nota (aviso de homologacao fora de producao) e grava no S3 |
| `cmd/lambda-outbox` | Publicador de outbox por `Scan` (nao provisionado pelo CDK serverless atual) |

Pacotes em `internal/`: `dominio` (nota, itens, `Dinheiro` em centavos), `fiscal` (ambiente homologacao/producao), `repositorio` (DynamoDB), `pdf`, `publicador`, `logger`, `observability`.

```bash
go vet ./...
go test ./...
# integracao (DynamoDB Local em :8000)
DYNAMODB_ENDPOINT=http://localhost:8000 AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local AWS_REGION=us-east-1 \
  go test ./internal/repositorio/
```

Exemplo de chamada local (compose ou `HTTP_ADDR=:5002`):

```bash
curl -X POST http://localhost:5002/api/v1/notas/<id>/imprimir -H "Idempotency-Key: <chave-unica>"
```
