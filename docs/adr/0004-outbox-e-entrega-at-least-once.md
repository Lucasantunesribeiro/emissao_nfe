# 0004 - Outbox com DynamoDB Streams e entrega at-least-once

- Status: aceita
- Data: 2026-11-03

## Contexto

Publicar no EventBridge depois de gravar no DynamoDB, em chamadas separadas, perde eventos quando a Lambda falha entre as duas operacoes. A documentacao antiga afirmava entrega *exactly-once*, o que nenhum componente garante.

## Decisao

- O evento e gravado na tabela de eventos (`PK = OUTBOX#<epoch>`, `SK` unico por evento) **na mesma transacao** da mudanca de negocio (fechamento de nota no Go; reserva no .NET).
- O `OutboxPublisher` (.NET) e acionado por DynamoDB Streams, publica no EventBridge e marca `data_publicacao`. Se o `PutEvents` rejeitar a entrada (`FailedEntryCount > 0`), lanca excecao para o lote do stream ser reprocessado, em vez de marcar como publicado.
- Os consumidores sao idempotentes (ADR 0003 e transicao condicional `FECHADA -> RESERVADA/CANCELADA`), porque a entrega e *at-least-once*: o stream pode reprocessar, o EventBridge e o SQS podem duplicar.
- Consumidores SQS devolvem `BatchItemFailures` por registro; mensagens que esgotam as tentativas vao para a DLQ, que tem alarme.

## Consequencias

- Nenhum evento e perdido por falha entre a escrita e a publicacao, ou por rejeicao parcial do EventBridge.
- Duplicatas sao esperadas e tratadas pelos consumidores.
- A Lambda Go `cmd/lambda-outbox` (varredura por `Scan`) faz o mesmo papel e nao e provisionada pelo CDK serverless; rodar as duas ao mesmo tempo publicaria eventos em dobro.
- O `SK` do outbox no .NET era `evento.Id` (sempre 0): dois eventos no mesmo segundo colidiam e um era sobrescrito. Corrigido com `Guid` por evento.
