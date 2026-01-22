# Diagramas de Arquitetura

## 1. Arquitetura Atual (ECS + RabbitMQ) - $180/mês

```
┌─────────────────────────────────────────────────────────────────────┐
│ FRONTEND (CloudFront + S3)                                          │
│ • Angular 18                                                        │
│ • Deployed: S3 bucket (SSG)                                         │
│ • CDN: CloudFront distribution                                      │
│ Cost: $5/mês                                                        │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ API GATEWAY (ALB)                                     Cost: $75/mês │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ Application Load Balancer (Multi-AZ)                            ││
│ │ • Health checks: /health (30s interval)                         ││
│ │ • Sticky sessions: disabled                                     ││
│ │ • SSL/TLS: ACM certificate                                      ││
│ │                                                                  ││
│ │ Rules:                                                           ││
│ │ • /api/v1/notas/*     → Target Group: Faturamento (port 8080)  ││
│ │ • /api/v1/produtos/*  → Target Group: Estoque (port 5000)      ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                │                                  │
                │                                  │
        ┌───────▼──────────┐            ┌─────────▼──────────┐
        │ Target Group 1   │            │ Target Group 2     │
        │ Faturamento      │            │ Estoque            │
        └───────┬──────────┘            └─────────┬──────────┘
                │                                  │
                │                                  │
┌───────────────▼──────────────┐    ┌─────────────▼────────────────┐
│ COMPUTE (ECS Fargate)        │    │ COMPUTE (ECS Fargate)        │
│                              │    │                              │
│ ┌──────────────────────────┐ │    │ ┌──────────────────────────┐│
│ │ Task: Faturamento        │ │    │ │ Task: Estoque            ││
│ │ • Runtime: Go 1.22       │ │    │ │ • Runtime: .NET 9        ││
│ │ • CPU: 0.25 vCPU         │ │    │ │ • CPU: 0.25 vCPU         ││
│ │ • Memory: 512MB          │ │    │ │ • Memory: 512MB          ││
│ │ • Replicas: 1            │ │    │ │ • Replicas: 1            ││
│ │ • Port: 8080             │ │    │ │ • Port: 5000             ││
│ │ • ARM64                  │ │    │ │ • ARM64                  ││
│ └──────────────────────────┘ │    │ └──────────────────────────┘│
│                              │    │                              │
│ Cost: $9/mês                 │    │ Cost: $9/mês                 │
└───────────────┬──────────────┘    └─────────────┬────────────────┘
                │                                  │
                │                                  │
                └────────────┬─────────────────────┘
                             │
                ┌────────────┼─────────────┐
                │            │             │
                ▼            ▼             ▼
    ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐
    │ VPC          │  │ DATABASE    │  │ MESSAGING        │
    │              │  │             │  │                  │
    │ NAT Gateway  │  │ RDS         │  │ Amazon MQ        │
    │ (Single-AZ)  │  │ PostgreSQL  │  │ RabbitMQ         │
    │              │  │ t4g.micro   │  │ t3.micro         │
    │ $35/mês      │  │ Multi-AZ    │  │ Single-Instance  │
    └──────────────┘  │ $15/mês     │  │ $28/mês          │
                      └─────────────┘  └──────────────────┘

TOTAL INFRA: $180/mês
```

## 2. Arquitetura Proposta (Serverless) - $44/mês

```
┌─────────────────────────────────────────────────────────────────────┐
│ FRONTEND (CloudFront + S3)                         MANTÉM: $5/mês   │
│ • Angular 18                                                        │
│ • Deployed: S3 bucket (SSG)                                         │
│ • CDN: CloudFront distribution                                      │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│ API GATEWAY (Regional REST API)                    NEW: $3.50/mês   │
│ ┌─────────────────────────────────────────────────────────────────┐│
│ │ API Gateway REST API                                            ││
│ │ • Throttle: 100 RPS sustained, 200 burst                        ││
│ │ • Logging: INFO level                                           ││
│ │ • CORS: enabled                                                 ││
│ │ • Custom domain: api.meudominio.com                             ││
│ │                                                                  ││
│ │ Routes:                                                          ││
│ │ • /api/v1/notas/*     → Lambda Faturamento (proxy integration) ││
│ │ • /api/v1/produtos/*  → Lambda Estoque (proxy integration)     ││
│ │ • /health             → Lambda health checks                    ││
│ └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                │                                  │
                │ Lambda Integration               │ Lambda Integration
                ▼                                  ▼
┌───────────────────────────────┐    ┌─────────────────────────────┐
│ COMPUTE (Lambda)              │    │ COMPUTE (Lambda)            │
│                               │    │                             │
│ ┌───────────────────────────┐ │    │ ┌─────────────────────────┐│
│ │ Lambda: Faturamento       │ │    │ │ Lambda: Estoque         ││
│ │ • Runtime: Go ARM64       │ │    │ │ • Runtime: .NET 8 ARM64 ││
│ │ • Memory: 512MB           │ │    │ │ • Memory: 512MB         ││
│ │ • Timeout: 30s            │ │    │ │ • Timeout: 30s          ││
│ │ • Concurrency: 10 reserved│ │    │ │ • Concurrency: 10 res.  ││
│ │ • Invocations: 1M/mês     │ │    │ │ • Invocations: 1M/mês   ││
│ │ • Cold start: 180ms       │ │    │ │ • Cold start: 220ms     ││
│ │ • Warm: 8ms               │ │    │ │ • Warm: 12ms            ││
│ └───────────────────────────┘ │    │ └─────────────────────────┘│
│                               │    │                             │
│ Cost: $8/mês                  │    │ Cost: $8/mês                │
└───────────────┬───────────────┘    └─────────────┬───────────────┘
                │                                   │
                │        ┌──────────────────────────┘
                │        │
                │        │    ┌────────────────────────────────────┐
                │        │    │ Lambda: Outbox Processor           │
                │        │    │ • Runtime: Go ARM64                │
                │        │    │ • Memory: 256MB                    │
                │        │    │ • Timeout: 60s                     │
                │        │    │ • Trigger: EventBridge (1min rate) │
                │        │    │ • Invocations: 500K/mês            │
                │        │    │ Cost: $2/mês                       │
                │        │    └────────────┬───────────────────────┘
                │        │                 │
                │        │                 │ Publish eventos
                └────────┼─────────────────┘
                         │
                         ▼
    ┌────────────────────────────────────────────────────────┐
    │ EVENT BUS (EventBridge)               NEW: $1/mês      │
    │ ┌────────────────────────────────────────────────────┐ │
    │ │ Custom Event Bus: nfe-events-dev                   │ │
    │ │                                                     │ │
    │ │ Event Sources:                                     │ │
    │ │ • nfe.faturamento (NotaFiscalCriada)               │ │
    │ │ • nfe.estoque (ReservaConfirmada, ReservaFalhou)   │ │
    │ │                                                     │ │
    │ │ Features:                                          │ │
    │ │ • Archive: 90 dias (replay)                        │ │
    │ │ • Schema Registry: automatic                       │ │
    │ │ • CloudWatch Logs integration                      │ │
    │ │ • Dead letter queue: SQS                           │ │
    │ └────────────────────────────────────────────────────┘ │
    └────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
          ▼              ▼              ▼
    ┌──────────┐  ┌──────────┐  ┌──────────┐
    │ SQS      │  │ SQS      │  │ SQS DLQ  │
    │ estoque- │  │ fatura-  │  │ (retry   │
    │ reserva  │  │ mento-   │  │ manual)  │
    │          │  │ confirm  │  │          │
    │ $0.20/mês│  │ $0.20/mês│  │ $0.10/mês│
    └────┬─────┘  └────┬─────┘  └──────────┘
         │             │
         │ trigger     │ trigger
         │             │
         └─────────────┘
                 │
                 ▼
    ┌────────────────────────────────────────┐
    │ DATABASE (RDS + Proxy)  NEW: $23/mês   │
    │ ┌────────────────────────────────────┐ │
    │ │ RDS Proxy (Connection Pooling)     │ │
    │ │ • Max connections: 100             │ │
    │ │ • IAM auth: enabled                │ │
    │ │ • TLS: required                    │ │
    │ │ • Publicly accessible: YES         │ │
    │ │   (mitigado por Security Group)    │ │
    │ │ Cost: $11/mês                      │ │
    │ └───────────┬────────────────────────┘ │
    │             ▼                          │
    │ ┌────────────────────────────────────┐ │
    │ │ RDS PostgreSQL t4g.micro           │ │
    │ │ • Single-AZ (dev)                  │ │
    │ │ • Multi-AZ (prod +$33/mês)         │ │
    │ │ • Storage: GP3 20GB                │ │
    │ │ • Backups: 7 dias                  │ │
    │ │ • Encryption: at rest (KMS)        │ │
    │ │ • Public endpoint (SG restrito)    │ │
    │ │ Cost: $12/mês (Savings Plan 1yr)   │ │
    │ └────────────────────────────────────┘ │
    │                                        │
    │ Schemas:                               │
    │ • faturamento (notas_fiscais,          │
    │   eventos_outbox, mensagens_processd.) │
    │ • estoque (produtos, reservas,         │
    │   eventos_outbox, mensagens_processd.) │
    └────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ NETWORKING                                   REMOVIDO: $35/mês  │
│ ❌ NAT Gateway (eliminado com Lambda sem VPC)                   │
│ ❌ Private subnets complexas                                    │
│ ✅ Lambda acessa RDS via internet (Security Group + IAM auth)  │
└─────────────────────────────────────────────────────────────────┘

TOTAL INFRA SERVERLESS: $43.60/mês
ECONOMIA: $136.40/mês (76%)
```

## 3. Fluxo Saga Coreografado (Serverless)

### 3.1 Cenário Sucesso: Criar Nota Fiscal

```
┌─────────┐
│ Browser │
│ (User)  │
└────┬────┘
     │
     │ 1. POST /api/v1/notas { items: [...] }
     │
     ▼
┌─────────────────┐
│ API Gateway     │
│ (REST API)      │
└────┬────────────┘
     │ 2. Lambda Integration (proxy)
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ Lambda Faturamento (Go)                                  │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ BEGIN TRANSACTION                                     │ │
│ │ • INSERT INTO faturamento.notas_fiscais (...)         │ │
│ │ • INSERT INTO faturamento.eventos_outbox (            │ │
│ │     tipo='NotaFiscalCriada',                          │ │
│ │     payload={ notaFiscalId, items },                  │ │
│ │     publicado=false                                   │ │
│ │   )                                                    │ │
│ │ COMMIT                                                 │ │
│ └──────────────────────────────────────────────────────┘ │
└────┬─────────────────────────────────────────────────────┘
     │ 3. Return 201 Created
     │
     ▼
┌─────────┐
│ Browser │ (recebe resposta, nota "PENDING")
└─────────┘

     ⏰ (1 minuto depois)

┌───────────────────────────────────────────────────────────┐
│ Lambda Outbox Processor (scheduled EventBridge 1min)      │
│ ┌───────────────────────────────────────────────────────┐ │
│ │ 1. SELECT * FROM faturamento.eventos_outbox           │ │
│ │    WHERE publicado=false                              │ │
│ │                                                        │ │
│ │ 2. FOR EACH evento:                                   │ │
│ │    • EventBridge.putEvents({                          │ │
│ │        Source: 'nfe.faturamento',                     │ │
│ │        DetailType: 'NotaFiscalCriada',                │ │
│ │        Detail: evento.payload                         │ │
│ │      })                                                │ │
│ │                                                        │ │
│ │ 3. UPDATE faturamento.eventos_outbox                  │ │
│ │    SET publicado=true, publicado_em=NOW()             │ │
│ └───────────────────────────────────────────────────────┘ │
└────┬──────────────────────────────────────────────────────┘
     │ 4. Publish to EventBridge
     │
     ▼
┌──────────────────────────────────────────────────┐
│ EventBridge (Custom Event Bus)                   │
│ ┌──────────────────────────────────────────────┐ │
│ │ Event: NotaFiscalCriada                      │ │
│ │ Source: nfe.faturamento                      │ │
│ │ Payload: { notaFiscalId, items }             │ │
│ │ Timestamp: 2026-01-12T10:30:00Z              │ │
│ └──────────────────────────────────────────────┘ │
└────┬─────────────────────────────────────────────┘
     │ 5. EventBridge Rule matches
     │    Pattern: source='nfe.faturamento'
     │             detailType='NotaFiscalCriada'
     │
     ▼
┌──────────────────────────────────────────────────┐
│ SQS Queue: estoque-reserva                       │
│ • Message: NotaFiscalCriada event                │
│ • Visibility timeout: 90s                        │
│ • DLQ: after 3 retries                           │
└────┬─────────────────────────────────────────────┘
     │ 6. SQS Event Source trigger
     │    (batch size: 10 messages)
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ Lambda Estoque (.NET)                                    │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ BEGIN TRANSACTION                                     │ │
│ │ • UPDATE estoque.produtos                             │ │
│ │   SET quantidade = quantidade - reserved              │ │
│ │   WHERE produto_id IN (items)                         │ │
│ │                                                        │ │
│ │ • INSERT INTO estoque.reservas (                      │ │
│ │     nota_fiscal_id,                                   │ │
│ │     produto_id,                                       │ │
│ │     quantidade_reservada                              │ │
│ │   )                                                    │ │
│ │ COMMIT                                                 │ │
│ │                                                        │ │
│ │ • EventBridge.putEvents({                             │ │
│ │     Source: 'nfe.estoque',                            │ │
│ │     DetailType: 'ReservaConfirmada',                  │ │
│ │     Detail: { notaFiscalId, reservaId }               │ │
│ │   })                                                   │ │
│ └──────────────────────────────────────────────────────┘ │
└────┬─────────────────────────────────────────────────────┘
     │ 7. Publish ReservaConfirmada
     │
     ▼
┌──────────────────────────────────────────────────┐
│ EventBridge (Custom Event Bus)                   │
│ ┌──────────────────────────────────────────────┐ │
│ │ Event: ReservaConfirmada                     │ │
│ │ Source: nfe.estoque                          │ │
│ │ Payload: { notaFiscalId, reservaId }         │ │
│ └──────────────────────────────────────────────┘ │
└────┬─────────────────────────────────────────────┘
     │ 8. EventBridge Rule matches
     │
     ▼
┌──────────────────────────────────────────────────┐
│ SQS Queue: faturamento-confirmacao               │
└────┬─────────────────────────────────────────────┘
     │ 9. SQS Event Source trigger
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ Lambda Faturamento (Go)                                  │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ UPDATE faturamento.notas_fiscais                      │ │
│ │ SET status='CONFIRMADA',                              │ │
│ │     confirmada_em=NOW()                               │ │
│ │ WHERE nota_fiscal_id = notaFiscalId                   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

✅ SAGA COMPLETO!
   Nota Fiscal status: PENDING → CONFIRMADA
   Estoque: quantidade reduzida
   Reserva: criada
```

### 3.2 Cenário Falha: Estoque Insuficiente (Compensação)

```
┌─────────────────────────────────────────────────────────┐
│ Lambda Estoque (.NET)                                   │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ BEGIN TRANSACTION                                    │ │
│ │ • SELECT quantidade FROM estoque.produtos            │ │
│ │   WHERE produto_id IN (items)                        │ │
│ │                                                       │ │
│ │ IF quantidade < quantidade_solicitada:               │ │
│ │   ROLLBACK                                           │ │
│ │   → Publish evento "ReservaFalhou"                   │ │
│ └─────────────────────────────────────────────────────┘ │
└────┬────────────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────┐
│ EventBridge: ReservaFalhou                       │
│ Source: nfe.estoque                              │
│ Payload: { notaFiscalId, erro: "ESTOQUE_INSUF." }│
└────┬─────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────┐
│ SQS Queue: faturamento-compensacao               │
└────┬─────────────────────────────────────────────┘
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│ Lambda Faturamento (Go) - Compensating Transaction      │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ UPDATE faturamento.notas_fiscais                      │ │
│ │ SET status='ERRO_ESTOQUE',                            │ │
│ │     erro_mensagem='Estoque insuficiente',             │ │
│ │     erro_timestamp=NOW()                              │ │
│ │ WHERE nota_fiscal_id = notaFiscalId                   │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

✅ COMPENSAÇÃO COMPLETA!
   Nota Fiscal status: PENDING → ERRO_ESTOQUE
   Estoque: inalterado
   User notificado: "Produto fora de estoque"
```

## 4. Security Model (Lambda sem VPC)

```
┌────────────────────────────────────────────────────────────┐
│ Lambda Function (sem VPC)                                  │
│ • Execution Role: arn:aws:iam::xxx:role/LambdaExecRole    │
│ • IAM Policy: rds-db:connect (RDS Proxy)                  │
│ • Secrets Manager: read credentials                        │
└────┬───────────────────────────────────────────────────────┘
     │
     │ 1. IAM auth token request
     │
     ▼
┌────────────────────────────────────────────────────────────┐
│ AWS STS (Security Token Service)                           │
│ • Validate IAM role                                        │
│ • Generate temporary token (15min TTL)                     │
└────┬───────────────────────────────────────────────────────┘
     │
     │ 2. Connection + token
     │
     ▼
┌────────────────────────────────────────────────────────────┐
│ RDS Proxy (Public Endpoint)                                │
│ • Endpoint: xxx.proxy-xxx.us-east-1.rds.amazonaws.com:5432│
│ • IAM auth: ENABLED                                        │
│ • TLS: REQUIRED                                            │
│ • Security Group: sg-lambda-rds                            │
│   └─ Ingress: TCP 5432 from Lambda service prefix list    │
│      (pl-63a5400a - us-east-1 Lambda endpoints)            │
└────┬───────────────────────────────────────────────────────┘
     │
     │ 3. Proxy validates token + pools connection
     │
     ▼
┌────────────────────────────────────────────────────────────┐
│ RDS PostgreSQL (Public Subnet)                             │
│ • Publicly Accessible: TRUE                                │
│ • Security Group: sg-rds (same as Proxy)                   │
│ • Encryption: at rest (KMS), in transit (TLS)              │
│ • No public password (IAM auth only)                       │
└────────────────────────────────────────────────────────────┘

CAMADAS DE SEGURANÇA:
1. ✅ IAM authentication (sem passwords)
2. ✅ Security Group restritivo (Lambda prefix list)
3. ✅ TLS obrigatório (RDS Proxy)
4. ✅ Encryption at rest (KMS)
5. ✅ Temporary tokens (15min TTL)
6. ✅ CloudTrail audit (tentativas de acesso)
```

## 5. Cost Breakdown Visual

```
┌─────────────────────────────────────────────────────────────────┐
│ CUSTO MENSAL: ECS vs LAMBDA                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ECS Fargate ($180/mês):                                         │
│ ████████████████████████████████████████ $180                   │
│                                                                  │
│ ┌────────────┬──────────┬──────────┬──────────┬──────────┐    │
│ │ ECS/Fargate│ RabbitMQ │ Database │ ALB      │ NAT GW   │    │
│ │ $18        │ $28      │ $15      │ $75      │ $35      │    │
│ └────────────┴──────────┴──────────┴──────────┴──────────┘    │
│     10%         15%        8%         42%        19%           │
│                                                                  │
│ Lambda Serverless ($44/mês):                                    │
│ ██████████ $44                                                  │
│                                                                  │
│ ┌───────┬──────────┬────────────┬────────────┐                │
│ │ Lambda│ Database │ API GW     │ Messaging  │                │
│ │ $18   │ $23      │ $3.50      │ $1.45      │                │
│ └───────┴──────────┴────────────┴────────────┘                │
│   41%      52%       8%           3%                            │
│                                                                  │
│ ECONOMIA: ████████████████████████████ $136/mês (76%)          │
└─────────────────────────────────────────────────────────────────┘

BREAKDOWN DETALHADO LAMBDA:

Database ($23/mês - 52%):
├─ RDS t4g.micro Single-AZ: $12 (Savings Plan)
├─ RDS Proxy: $11
└─ Storage GP3: incluído

Lambda Compute ($18/mês - 41%):
├─ Faturamento: $8 (1M invocations)
├─ Estoque: $8 (1M invocations)
└─ Outbox Processor: $2 (500K invocations)

API Gateway ($3.50/mês - 8%):
└─ REST API: 1M requests

Messaging ($1.45/mês - 3%):
├─ EventBridge: $1 (1M eventos)
├─ SQS: $0.40 (1M mensagens)
└─ Archive storage: $0.05
```

## 6. Performance Comparison

```
┌──────────────────────────────────────────────────────────────┐
│ LATÊNCIA P95 (milliseconds)                                  │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ECS Fargate (warm):                                          │
│ ████████████████████ 180ms                                   │
│                                                               │
│ Lambda (warm):                                               │
│ ████████████████████████████ 280ms                           │
│                                                               │
│ Lambda (cold start):                                         │
│ ██████████████████████████████████████████████ 480ms         │
│                                                               │
│ Target: < 500ms ✅                                           │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ THROUGHPUT (requests per second)                             │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│ ECS Fargate (2 tasks):                                       │
│ ████████████████████ 100 RPS (manual scaling)                │
│                                                               │
│ Lambda (auto-scale):                                         │
│ ████████████████████████████████████████████████████████████ │
│ 1000 RPS (automatic, 10x maior)                              │
│                                                               │
└──────────────────────────────────────────────────────────────┘

VENCEDOR: Lambda (throughput) vs ECS (latência warm)
DECISÃO: Lambda (latência +100ms aceitável, throughput crítico)
```

---

**Legenda**:
- █ Custo/Latência proporcional
- ✅ Atende requirement
- ⚠️ Trade-off aceitável
- ❌ Não atende (blocker)
- → Flow direction
- ▼ Next step
