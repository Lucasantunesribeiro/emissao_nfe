# Sistema de Emissão de Nota Fiscal Eletrônica (NFe)

> **Arquitetura Serverless Event-Driven completa** para emissão de notas fiscais com microserviços, saga coreografada, autenticação JWT e geração assíncrona de PDFs.

[![CI](https://github.com/Lucasantunesribeiro/emissao_nfe/actions/workflows/ci.yml/badge.svg)](https://github.com/Lucasantunesribeiro/emissao_nfe/actions/workflows/ci.yml)
[![AWS](https://img.shields.io/badge/AWS-Serverless-FF9900?logo=amazon-aws)](https://aws.amazon.com)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go)](https://go.dev)
[![.NET](https://img.shields.io/badge/.NET-9-512BD4?logo=dotnet)](https://dotnet.microsoft.com)
[![Angular](https://img.shields.io/badge/Angular-17-DD0031?logo=angular)](https://angular.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-CDK-3178C6?logo=typescript)](https://aws.amazon.com/cdk/)

**Demo:** [https://d1gdw7rlsi8u42.cloudfront.net](https://d1gdw7rlsi8u42.cloudfront.net)

---

## Sobre o Projeto

Sistema distribuído **100% serverless** para gestão de notas fiscais eletrônicas, desenvolvido com **arquitetura orientada a eventos**, **saga coreografada** e **práticas de FinOps** para operar no AWS Free Tier (~$3–5/mês).

### Diferenciais Técnicos

- **Saga Coreografada completa** — EventBridge → SQS → Lambda com compensação automática
- **Outbox Pattern** — exactly-once delivery via DynamoDB Streams (sem two-phase commit)
- **SQS Mux** — um Lambda processa HTTP e SQS no mesmo binário (detecção por `json.RawMessage`)
- **PDF 100% assíncrono** — 202 Accepted + polling, sem timeout de Lambda
- **Autenticação JWT com Cognito** — Lambda Authorizer em todas as rotas protegidas
- **Single-Table Design** — DynamoDB com PK/SK e GSI1/GSI2 otimizados
- **CloudWatch Alarms** — DLQ, erros Lambda faturamento e estoque monitorados
- **28 testes automatizados** — Go (domain), .NET (xUnit + Moq), Angular (Jest)
- **CI completo** — 4 jobs independentes: Go, .NET, Angular, CDK synth

---

## Stack Tecnológica

### Backend

| Serviço | Linguagem | Runtime | Responsabilidade |
|---------|-----------|---------|------------------|
| `servico-faturamento` | Go 1.25 | Lambda `provided.al2023` | CRUD de notas, outbox, PDF assíncrono, saga SQS handler |
| `servico-estoque` | .NET 9 | Lambda `dotnet8` | CRUD de produtos, reserva de estoque |

**4 Lambdas Go:**
- `cmd/lambda/` — API HTTP + SQS handler (mux de eventos)
- `cmd/lambda-outbox/` — DynamoDB Streams → EventBridge
- `cmd/lambda-pdf/` — Geração assíncrona de PDF + upload S3
- `cmd/lambda-estoque-consumer/` — Saga: reserva/liberação de estoque com compensação

### Frontend

- **Angular 17** — Standalone Components, `inject()`, `authGuard`, `auth.interceptor`
- **TailwindCSS** — design system utilitário
- **RxJS** — polling de status, interceptors HTTP, fluxo reativo
- **Jest** — testes unitários (11 specs)

### Infraestrutura

- **AWS CDK** (TypeScript) — 6 stacks modulares com cost guardrails
- **API Gateway HTTP** + **Lambda Authorizer** (Cognito JWT)
- **Cognito User Pool** — autenticação (Free Tier: 50K MAU)
- **DynamoDB** — single-table design, Free Tier permanente
- **EventBridge** + **SQS** + **DLQ** — mensageria serverless sem broker
- **S3** + **CloudFront** — frontend e PDFs gerados
- **CloudWatch Alarms** — DLQ (threshold=1), Lambda errors (threshold=3/5min)

---

## Arquitetura do Sistema

```
[Usuário]
    │ HTTPS + JWT Bearer
    ▼
API Gateway (HTTP API)
    │ Lambda Authorizer (Cognito JWT)
    ├──────────────────┬─────────────────────
    ▼                  ▼
Lambda Faturamento     Lambda Estoque
(Go — HTTP+SQS mux)   (.NET 9 — REST API)
    │                  │
    ▼                  ▼
DynamoDB (single-table: PK/SK + GSI1 + GSI2)
    │
    ▼ DynamoDB Streams
Lambda Outbox ──────► EventBridge (nfe-events-dev)
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
           SQS estoque-reserva    SQS faturamento-confirmacao
               │                         │
               ▼                         ▼
    Lambda EstoqueConsumer    Lambda Faturamento (SQS mux)
    (reserva / libera)        (atualiza status: RESERVADA/CANCELADA)
               │
     ReservaConfirmada / ReservaFalhou → EventBridge

[PDF Async]
POST /imprimir → 202 Accepted (SolicitacaoImpressao PENDENTE)
    → EventBridge (ImpressaoSolicitada)
    → Lambda PDF → S3
    → SolicitacaoImpressao CONCLUIDA
Frontend polls GET /solicitacoes-impressao/{id}
```

**Eventos no barramento:**

| Evento | Publicador | Consumidor |
|--------|-----------|-----------|
| `Faturamento.NotaFechada` | Lambda Outbox | Lambda EstoqueConsumer |
| `Faturamento.ImpressaoSolicitada` | Lambda Outbox | Lambda PDF |
| `ReservaConfirmada` | Lambda EstoqueConsumer | Lambda Faturamento (SQS) |
| `ReservaFalhou` | Lambda EstoqueConsumer | Lambda Faturamento (SQS) |

---

## Funcionalidades

### Gestão de Produtos (Estoque — .NET)
- Cadastro e atualização de produtos com SKU e saldo
- Reserva de estoque via `DebitarEstoque` com validação de saldo, produto ativo e quantidade positiva
- Rollback automático em falha de saga (compensação item a item)

### Emissão de Notas Fiscais (Faturamento — Go)
- Criação e composição de notas com múltiplos itens
- Fechamento transacional → publica evento outbox atomicamente
- Status da nota: `ABERTA` → `FECHADA` → `RESERVADA` | `CANCELADA`
- Idempotência por `Idempotency-Key` no header HTTP

### Geração Assíncrona de PDF
- `POST /notas/{id}/imprimir` → `202 Accepted` + `solicitacaoId`
- Lambda PDF recebe evento, busca nota no DynamoDB, gera PDF com `gofpdf`, faz upload no S3
- Status: `PENDENTE` → `CONCLUIDA` | `FALHOU`
- Frontend faz polling com RxJS até receber link do PDF

### Autenticação
- Cognito User Pool com User/Password flow
- Lambda Authorizer valida JWT e injeta `userId`, `email`, `groups` no contexto da Lambda
- Angular `authGuard` protege rotas e `auth.interceptor` injeta Bearer token automaticamente

---

## Quick Start

### Pré-requisitos

- Go 1.25+
- .NET 9 SDK
- Node.js 22+
- AWS CLI v2 configurado (`aws configure`)
- `npm install -g aws-cdk`

### Build local

```bash
# Clone
git clone https://github.com/Lucasantunesribeiro/emissao_nfe.git
cd emissao_nfe

# Go — faturamento (testes + binários)
cd servico-faturamento
go test ./...
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build/bootstrap cmd/lambda/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-outbox/bootstrap cmd/lambda-outbox/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-pdf/bootstrap cmd/lambda-pdf/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-estoque-consumer/bootstrap cmd/lambda-estoque-consumer/main.go
cd ..

# .NET — estoque (testes + publish)
cd servico-estoque
dotnet test Tests/ServicoEstoque.Tests.csproj
dotnet publish -c Release -r linux-x64 --self-contained false -o publish-dynamodb/
cd ..

# Angular — frontend (testes + build)
cd web-app
npm install
npm test
npm run build:prod
cd ..
```

### Deploy AWS

```bash
cd infra/cdk
npm install
npm run build

# Validar (sem deploy)
npm run synth:serverless -- --context env=dev

# Deploy completo
npm run deploy:serverless:dev
```

### Deploy Frontend

```bash
cd web-app && npm run build:prod
aws s3 sync dist/web-app/ s3://nfe-frontend-dev-246599827442/ --delete
aws cloudfront create-invalidation --distribution-id E3GS1ORK9UYGOX --paths "/*"
```

---

## Testes

### Go (servico-faturamento)

```bash
cd servico-faturamento && go test ./...
```

Cobre: `NotaFiscal.Fechar()`, `CalcularTotal()`, `CalcularSubtotal()`, status RESERVADA/CANCELADA, nota vazia.

### .NET (servico-estoque)

```bash
cd servico-estoque && dotnet test Tests/ServicoEstoque.Tests.csproj
```

17 testes (xUnit + Moq):
- `ProdutoTests` — construtor, `DebitarEstoque` (suficiente/insuficiente/zero/negativo/inativo/exato), `Desativar/Ativar`, `AtualizarSaldo`, `Resultado`
- `ReservarEstoqueHandlerTests` — sucesso, produto não encontrado, saldo insuficiente com evento de rejeição, evento Estoque.Reservado

### Angular (web-app)

```bash
cd web-app && npm test
```

11 testes (Jest + jest-preset-angular):
- `NotaFiscalService` — GET/POST/PUT com `HttpTestingController`, header `Idempotency-Key`, URL de solicitações
- `authGuard / publicGuard` — bloqueio sem auth, acesso com auth, redirecionamento

---

## CI/CD

### GitHub Actions

| Job | Trigger | Etapas |
|-----|---------|--------|
| **Build & Vet – Faturamento (Go)** | push/PR | `go vet`, `go test ./...`, build dos 4 binários Lambda |
| **Build & Test – Estoque (.NET)** | push/PR | `dotnet restore`, `dotnet build`, `dotnet test` |
| **Build – Frontend (Angular)** | push/PR | `npm install`, `npm run test:ci`, `npm run build:prod` |
| **Synth – CDK Serverless** | push/PR | build lambda-authorizer, placeholders, `cdk synth` |
| **Deploy – Development** | push em `main` | CDK deploy automático + frontend S3 sync |

---

## Estrutura do Projeto

```
emissao_nfe/
├── servico-faturamento/          # Microserviço Go
│   ├── cmd/
│   │   ├── lambda/               # Lambda API + SQS mux
│   │   ├── lambda-outbox/        # DynamoDB Streams → EventBridge
│   │   ├── lambda-pdf/           # Gerador PDF assíncrono
│   │   └── lambda-estoque-consumer/ # Saga: reserva estoque
│   ├── internal/
│   │   ├── dominio/              # Entidades + regras (+ testes)
│   │   ├── repositorio/          # DynamoDB (CRUD + reserva + outbox)
│   │   ├── pdf/                  # Gerador gofpdf
│   │   └── logger/
│   └── go.mod
│
├── servico-estoque/              # Microserviço .NET 9
│   ├── Api/                      # Minimal API endpoints + Program.cs
│   ├── Aplicacao/               # Casos de uso (ReservarEstoqueHandler)
│   ├── Dominio/                 # Entidades (Produto, ReservaEstoque)
│   ├── Infraestrutura/          # Repositórios DynamoDB
│   └── Tests/                   # xUnit + Moq (17 testes)
│       ├── Dominio/ProdutoTests.cs
│       └── Aplicacao/ReservarEstoqueHandlerTests.cs
│
├── web-app/                      # Frontend Angular 17
│   ├── src/app/
│   │   ├── core/
│   │   │   ├── services/         # NotaFiscalService, ProdutoService (+ specs Jest)
│   │   │   ├── guards/           # authGuard, publicGuard (+ specs Jest)
│   │   │   └── models/
│   │   └── features/
│   ├── jest.config.js
│   ├── setup-jest.ts
│   └── tsconfig.spec.json
│
├── infra/
│   ├── cdk/
│   │   ├── bin/nfe-infra-serverless.ts  # Entry point ativo
│   │   └── lib/
│   │       ├── aspects/          # Cost guardrails (sem NAT, ECS, RDS)
│   │       ├── config/           # dev.ts, prod.ts
│   │       └── stacks/
│   │           ├── network-stack.ts
│   │           ├── auth-stack.ts         # Cognito User Pool
│   │           ├── database-dynamodb-stack.ts
│   │           ├── messaging-stack-serverless.ts  # EventBridge + SQS + DLQ
│   │           ├── compute-stack-serverless.ts    # Lambdas + API Gateway + Alarms
│   │           └── frontend-stack.ts     # S3 + CloudFront
│   └── lambda-authorizer/        # Node.js JWT validator (aws-jwt-verify)
│
└── .github/workflows/
    ├── ci.yml                    # Build + test em todos os serviços
    ├── deploy-dev.yml            # Auto-deploy em push para main
    └── deploy-prod.yml           # Deploy manual com aprovação
```

---

## FinOps: Custos AWS

| Recurso | Custo |
|---------|-------|
| Lambda (1M req/mês) | Free Tier |
| API Gateway (1M req/mês) | Free Tier |
| DynamoDB (25GB + 25 WCU/RCU) | Free Tier permanente |
| EventBridge (100K eventos) | Free Tier |
| SQS (1M requests) | Free Tier |
| Cognito (50K MAU) | Free Tier |
| S3 + CloudFront | ~$1–2/mês |
| **Total estimado** | **$1–3/mês** |

**CDK Cost Guardrails** impedem no `cdk synth` o provisionamento de NAT Gateway, ECS/Fargate, RDS, Amazon MQ ou qualquer recurso com custo fixo alto.

---

## Segurança

- **Autenticação JWT** — Cognito User Pool + Lambda Authorizer em todas as rotas (exceto `/health`)
- **IAM least privilege** — cada Lambda tem apenas as permissões necessárias
- **CORS restritivo** — apenas o domínio CloudFront em produção
- **Idempotência** — `Idempotency-Key` HTTP + deduplicação `IDEM#{messageId}` no DynamoDB
- **Input validation** — DTO validation no .NET, validação de domínio no Go
- **Security headers** — `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` nas gateway responses

---

## Observabilidade

```bash
# Logs em tempo real
aws logs tail /aws/lambda/nfe-faturamento-dev --follow
aws logs tail /aws/lambda/nfe-estoque-dev --follow
aws logs tail /aws/lambda/nfe-estoque-consumer-dev --follow
aws logs tail /aws/lambda/nfe-pdf-dev --follow

# Status dos alarms
aws cloudwatch describe-alarms --alarm-name-prefix nfe-

# Mensagens na DLQ (deve ser 0)
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name nfe-estoque-dlq-dev --query QueueUrl --output text) \
  --attribute-names ApproximateNumberOfMessages
```

**CloudWatch Alarms ativos:**
- `nfe-dlq-messages-dev` — mensagens na DLQ (threshold=1, indica falha na saga)
- `nfe-faturamento-errors-dev` — erros Lambda faturamento (threshold=3/5min)
- `nfe-estoque-errors-dev` — erros Lambda estoque (threshold=3/5min)

---

## Aprendizados e Decisões Técnicas

### Por que Go para faturamento?

Cold start <100ms com `provided.al2023` e binário estático (`CGO_ENABLED=0`). Um único binário processa tanto `APIGatewayProxyRequest` quanto `SQSEvent` via detecção por `json.RawMessage` — sem overhead de framework.

### Por que .NET para estoque?

Produtividade para lógica de domínio complexa (reservas, validações, casos de uso) com separação clara de camadas. `Amazon.Lambda.AspNetCoreServer` permite reusar Minimal APIs dentro de Lambda sem reescrever handlers.

### Por que DynamoDB (single-table)?

Free Tier permanente (25GB + 25 WCU/RCU). Single-table design com PK/SK compostos e GSI1/GSI2 resolve todos os access patterns sem múltiplas tabelas. O trade-off é acoplamento entre domínios na mesma tabela — consciente e aceitável para o contexto.

### Por que EventBridge + SQS (sem RabbitMQ)?

RabbitMQ via Amazon MQ custa $28/mês mínimo com overhead operacional. EventBridge + SQS é $0 no Free Tier, integração nativa com Lambda, sem manutenção de broker. A saga coreografada funciona com visibilidade equivalente.

### Por que CDK ao invés de Terraform?

Type safety em TypeScript, constructs reutilizáveis e CDK Aspects para cost guardrails em tempo de synth. O feedback de erro antes do deploy (ex: "sem NAT Gateway") é mais rápido do que descobrir o custo depois.

---

## Autor

**Lucas Antunes Ribeiro**

- GitHub: [@Lucasantunesribeiro](https://github.com/Lucasantunesribeiro/emissao_nfe)
- LinkedIn: [linkedin.com/in/lucas-antunes-ribeiro](https://www.linkedin.com/in/lucas-antunes-ribeiro)

---

**Se este projeto foi útil, considere dar uma estrela no GitHub!**
