# Dossiê Técnico de Portfólio - Sistema de Emissão de NFe (v2)

Análise atualizada após evolução arquitetural completa. Março de 2026.

---

## 1. Visão Geral

Sistema serverless de emissão de notas fiscais eletrônicas (NFe), implementado como dois microserviços independentes integrados via eventos assíncronos na AWS. O sistema demonstra padrões de engenharia de software aplicados em contexto cloud-native: saga coreografada, outbox pattern, geração assíncrona de PDF, autenticação JWT e observabilidade com CloudWatch.

**Custo operacional:** ~$3–5/mês no Free Tier da AWS (Lambda + DynamoDB + EventBridge + S3/CloudFront gratuitos). Sem NAT Gateway, sem RDS, sem RabbitMQ.

**URL de demonstração:** https://d1gdw7rlsi8u42.cloudfront.net

---

## 2. Arquitetura

### Microserviços

| Serviço | Linguagem | Runtime | Função |
|---------|-----------|---------|--------|
| `servico-faturamento` | Go 1.25 | Lambda (provided.al2023) | CRUD de notas, fechamento, PDF assíncrono, saga consumer |
| `servico-estoque` | .NET 9 | Lambda (managed dotnet8) | CRUD de produtos, reserva de estoque |
| `web-app` | Angular 17 | S3 + CloudFront | Interface administrativa |
| `infra/cdk` | TypeScript | CDK | Provisionamento de toda a infraestrutura |

### Fluxo de Eventos (Saga Coreografada)

```
[Usuário] POST /notas/{id}/fechar
    → Lambda Faturamento → DynamoDB (nota FECHADA + evento OUTBOX)
    → Lambda Outbox (DynamoDB Streams) → EventBridge
    → SQS → Lambda EstoqueConsumer (Go)
        ↓ sucesso: ReservaConfirmada → SQS → Lambda Faturamento (nota RESERVADA)
        ↓ falha:   ReservaFalhou    → SQS → Lambda Faturamento (nota CANCELADA)
```

### Fluxo de PDF (100% Assíncrono)

```
[Usuário] POST /notas/{id}/imprimir → 202 Accepted (solicitacaoId)
    → DynamoDB (SolicitacaoImpressao PENDENTE + evento OUTBOX)
    → Lambda Outbox → EventBridge (ImpressaoSolicitada)
    → Lambda PDF → S3 → DynamoDB (status CONCLUIDA + pdfUrl)
[Usuário] GET /solicitacoes-impressao/{id} → polling até CONCLUIDA → link PDF
```

### Infraestrutura AWS

```
API Gateway (HTTP API)
    ↓ JWT (Lambda Authorizer + Cognito)
Lambda Go / Lambda .NET
    ↓
DynamoDB (single-table: PK/SK + GSI1 + GSI2)
    ↓ DynamoDB Streams
Lambda Outbox → EventBridge → SQS → Lambda consumers
                                          ↓ DLQ (com CloudWatch Alarm)
S3 + CloudFront ← PDFs gerados
```

---

## 3. Stack Tecnológica

### Backend
- **Go 1.25** — 4 Lambdas: API (mux HTTP+SQS), Outbox, PDF, EstoqueConsumer
- **C# .NET 9** — Lambda via `Amazon.Lambda.AspNetCoreServer`, Minimal APIs, Serilog
- **AWS SDK Go v2 / AWSSDK.NET** — DynamoDB, EventBridge, S3
- **gofpdf** — geração de PDF em Go puro (sem dependências C)
- **`slog`** (Go) + **Serilog** (.NET) — logs JSON estruturados para CloudWatch

### Frontend
- **Angular 17** — standalone components, `inject()`, signals-ready
- **TailwindCSS** — estilização utilitária
- **RxJS** — polling reativo de status de impressão, interceptors HTTP
- **AuthService + auth.guard** — integração com Cognito JWT

### Infraestrutura
- **AWS CDK (TypeScript)** — todos os recursos versionados como código
- **Cognito User Pool** — autenticação JWT (Free Tier: 50K MAU)
- **Lambda Authorizer (Node.js + aws-jwt-verify)** — validação JWT em API Gateway
- **EventBridge + SQS** — mensageria serverless sem broker
- **DynamoDB** — single-table design, Free Tier (25 GB + 25 WCU/RCU permanente)
- **CloudWatch Alarms** — DLQ, erros Lambda (observabilidade automatizada)

### Qualidade
- **Go:** `go test ./...` — testes de domínio (`notafiscal_test.go`) + CI verde
- **.NET:** xUnit + Moq — 17 testes unitários (`ProdutoTests`, `ReservarEstoqueHandlerTests`)
- **Angular:** Jest + jest-preset-angular — 11 testes (`NotaFiscalService`, `authGuard`)
- **CI (GitHub Actions):** 4 jobs — Go build+test, .NET build+test, Angular test+build, CDK synth

---

## 4. Padrões Aplicados

### Outbox Pattern
Eventos são gravados na tabela DynamoDB (`OUTBOX#`) atomicamente com a operação de negócio (sem two-phase commit). Um Lambda separado, acionado por DynamoDB Streams, publica no EventBridge. Garante exactly-once delivery mesmo em falhas de rede ou timeout de Lambda.

### Saga Coreografada
Não há orquestrador central. Cada serviço reage a eventos e publica seus próprios resultados. O faturamento publica `NotaFechada` → o consumer de estoque tenta reservar → publica `ReservaConfirmada` ou `ReservaFalhou` → o faturamento atualiza o status da nota. Compensação: se um item falha, os já reservados são liberados antes de publicar `ReservaFalhou`.

### Idempotência
Cada mensagem SQS é identificada pelo `MessageId`. Antes de processar, o consumer consulta `IDEM#{messageId}` no DynamoDB. Se já existe, descarta silenciosamente. Protege contra re-entrega de eventos sem efeitos colaterais duplicados.

### SQS Mux (Event Multiplexing)
O Lambda de faturamento processa dois tipos de evento no mesmo binário. O `main.go` inspeciona o `json.RawMessage` recebido: se contém `Records[].eventSource == "aws:sqs"`, roteia para `HandleSQSEvent`; caso contrário, trata como `APIGatewayProxyRequest`. Reduz custo de Lambda (um binário em vez de dois).

### Single-Table Design (DynamoDB)
Todas as entidades compartilham uma tabela com `PK` / `SK` compostos. Exemplos:
- Nota: `PK=NOTA#{id}`, `SK=NOTA#{id}`
- Item: `PK=NOTA#{id}`, `SK=ITEM#{itemId}`
- Produto: `PK=PROD#{id}`, `SK=PROD#{id}`
- Solicitação de impressão: `PK=SOL#{id}`, `SK=SOL#{id}`
- Outbox: `PK=OUTBOX#{id}`, tabela de eventos separada

---

## 5. Evolução Arquitetural (v1 → v2)

| Ponto | v1 (antes) | v2 (atual) |
|-------|-----------|------------|
| Código legado | `cmd/api/` (Gin+PostgreSQL+RabbitMQ) presente e compilando com erros | Removido completamente, `go mod tidy` zerou dependências |
| SQS handlers | CDK mapeava SQS para Lambdas que não processavam `SQSEvent` → saga silenciosamente quebrada | SQS mux em faturamento + novo Lambda Go para estoque consumer |
| PDF geração | Síncrona (dentro de `handleImprimirNota`) E evento para Lambda PDF → dupla geração | 100% assíncrona: 202 Accepted + polling |
| Autenticação | Auth stack comentada no CDK, routes sem autorização | Cognito User Pool ativo, Lambda Authorizer em todas as rotas protegidas |
| Outbox/PDF Lambda | Importavam `internal/config` (PostgreSQL/GORM) → panic no cold start | Reescritos para DynamoDB via `RepositorioDynamoDB` |
| EventBridge rule | Escutava `NotaFiscalCriada`, outbox publicava `Faturamento.NotaFechada` → consumer nunca acionado | Rule corrigida para `Faturamento.NotaFechada` |
| Testes no CI | `go test ./...` ausente no CI, zero testes .NET e Angular | Go: `go test ./...`; .NET: 17 testes xUnit; Angular: 11 testes Jest — todos no CI |
| Observabilidade | DLQ sem alarm | 3 CloudWatch Alarms: DLQ, erros Lambda faturamento, erros Lambda estoque |
| CDK synth no CI | Usava Docker bundling para Lambda Authorizer → falha com exit 243 | Local bundler (Node.js nativo no runner), sem Docker |

---

## 6. Como Explicar em Entrevista

**"Me conta sobre o projeto NFe."**

> É um sistema serverless de emissão de nota fiscal eletrônica, com dois microserviços — um em Go e outro em .NET — integrados via saga coreografada. A saga garante que quando uma nota é fechada, o estoque dos produtos é reservado de forma assíncrona, com compensação automática se algum item não tiver saldo suficiente.
>
> Eu optei por EventBridge e SQS em vez de um message broker gerenciado como RabbitMQ porque isso elimina o custo fixo (~$30/mês do AmazonMQ) e o overhead operacional. No Free Tier, o sistema roda por menos de cinco dólares por mês.
>
> Um padrão que me orgulho de ter implementado é o Outbox Pattern com DynamoDB Streams: eventos são gravados atomicamente com a operação de negócio, sem two-phase commit, e publicados no EventBridge por um Lambda separado. Isso garante exactly-once delivery.
>
> Além disso, a geração de PDF é 100% assíncrona — o endpoint retorna 202 imediatamente, o frontend faz polling até o status ser CONCLUIDA. Isso evita timeout em PDFs maiores e demonstra um design orientado a eventos de ponta a ponta.
>
> Em termos de qualidade, tenho testes unitários em Go (domínio de nota fiscal), .NET (xUnit + Moq para handler de reserva) e Angular (Jest para service e guard). Tudo roda no CI com GitHub Actions.

**"Que problemas você encontrou e resolveu?"**

> O mais interessante foi descobrir que a saga estava silenciosamente quebrada: o CDK configurava SQS event sources nos Lambdas, mas os handlers só processavam `APIGatewayProxyRequest`. Eventos SQS chegavam e retornavam erro sem log visível.
>
> Para resolver, implementei um mux que inspeciona o payload bruto: se o campo `Records[0].eventSource == "aws:sqs"`, roteia para o handler SQS; caso contrário, trata como HTTP. Ao mesmo tempo criei um Lambda Go separado para o consumer de estoque, já que o Lambda .NET usa ASP.NET Core que não tem suporte nativo a multiplexing com SQS.
>
> Também havia dupla geração de PDF — o handler criava o PDF sincronamente e ainda publicava um evento que acionava o Lambda PDF. Resolvi removendo a geração síncrona e tornando o fluxo 100% assíncrono.

---

## 7. Métricas e Pontos Fortes

- **4 Lambdas Go** compilando com `CGO_ENABLED=0` para `PROVIDED_AL2023` (binário estático, cold start mínimo)
- **CI com 4 jobs** independentes: Go, .NET, Angular, CDK — todos verdes
- **28 testes automatizados** (7 Go domain, 17 .NET xUnit, 11 Angular Jest)
- **Custo estimado:** $0–5/mês no Free Tier
- **Zero dependências de infraestrutura paga** além de S3 storage (~$0.50/mês)
- **IaC 100%**: toda a infraestrutura versionada em CDK TypeScript com cost guardrails no synth
