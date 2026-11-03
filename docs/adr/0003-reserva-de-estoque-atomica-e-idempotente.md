# 0003 - Reserva de estoque atomica, idempotente e sem saldo negativo

- Status: aceita
- Data: 2026-11-03

## Contexto

Ha dois caminhos que debitam estoque na mesma tabela DynamoDB (`PRODUTO#<id>/#METADATA`):

1. **Saga** (`servico-faturamento/cmd/lambda-estoque-consumer`, Go): reage a `Faturamento.NotaFechada` vindo de EventBridge + SQS. A entrega e *at-least-once*: a mesma nota pode chegar mais de uma vez, com `MessageId` diferente.
2. **API** (`POST /api/v1/reservas`, .NET): cliente HTTP pode repetir a requisicao (timeout, retry).

Problemas encontrados: idempotencia pelo `MessageId` do SQS (nao protege reentrega do EventBridge); baixa item a item com compensacao manual (falha no meio deixava estoque debitado); a API .NET debitava de novo a cada retry (reproduzido: saldo 10 -> 4 com duas chamadas de 3); o Go nao incrementava `versao`, que o .NET usa no controle otimista.

## Decisao

- **Go (saga):** uma unica `TransactWriteItems` por nota com (a) `Put` de `NOTA#<id>/#RESERVA_ESTOQUE` condicionado a `attribute_not_exists(PK)` e (b) um `Update` por produto com quantidades agregadas, condicao `saldo >= :qty` e produto ativo, e `ADD versao 1`. Reentrega encontra o registro e republica o mesmo resultado (`CONFIRMADA`/`FALHOU`) sem movimentar estoque.
- **.NET (API):** o Id da reserva e derivado de (nota, produto) (`ReservaEstoque.GerarId`). Reserva (`attribute_not_exists`), baixa do produto (condicionada a `versao` lida) e evento `Estoque.Reservado` no outbox vao numa unica `TransactWriteItems`. Retry com a mesma quantidade devolve a reserva existente; com quantidade diferente, falha sem nova baixa.
- Ambos os lados usam o mesmo atributo `versao`; um teste de integracao .NET aplica a expressao do Go e verifica que a escrita .NET posterior e recusada por conflito.

## Consequencias

- Saldo nunca fica negativo (condicao no banco, nao so no dominio) e nenhuma nota/requisicao debita duas vezes.
- Nota com mais de 99 produtos distintos nao cabe numa transacao e e recusada (`ErrItensDemais`).
- Sob corrida real, uma requisicao concorrente identica pode receber "Produto modificado. Tente novamente." e gerar um evento `Estoque.ReservaRejeitada` mesmo com a reserva vencedora gravada; o saldo continua correto.
- `ExecutarLote` (.NET) nao e exposto por rota e nao recebeu as mesmas garantias.
- Cobertura: testes unitarios do consumer (fake transacional), testes de integracao Go e .NET com DynamoDB Local, incluindo concorrencia.
