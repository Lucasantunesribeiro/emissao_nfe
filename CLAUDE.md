# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sistema de Emissão de Nota Fiscal Eletrônica (NFe) — a Brazilian electronic invoice system. 100% serverless on AWS, optimized for Free Tier (~$3–5/month).

## Architecture

**Microservices:**
- `servico-faturamento/` — Go 1.25, 4 Lambda functions (API, Outbox, PDF, EstoqueConsumer)
- `servico-estoque/` — .NET 9, Lambda, handles inventory/products via DynamoDB
- `web-app/` — Angular 17 + TailwindCSS, hosted on S3/CloudFront
- `infra/cdk/` — AWS CDK (TypeScript), deploys all stacks

**Infrastructure (serverless only):**
- API Gateway (HTTP) → Lambda → DynamoDB (single-table design)
- EventBridge → SQS → Lambda (async event processing / saga choreography)
- DynamoDB Streams → Outbox Lambda → EventBridge (exactly-once delivery)
- Cognito User Pool + Lambda Authorizer (JWT validation on all routes except /health)
- CloudWatch Alarms on DLQ and Lambda errors
- Active CDK entry: `infra/cdk/bin/nfe-infra-serverless.ts` (ignore `nfe-infra.ts` — legacy ECS/Fargate)

**Event flow (saga coreografada):**
```
Frontend → API Gateway (JWT auth) → Lambda → DynamoDB
                                           ↓
                               EventBridge (nfe-events-dev)
                                           ↓
                          SQS → Lambda EstoqueConsumer (Go)
                                           ↓
                        ReservaConfirmada / ReservaFalhou → EventBridge
                                           ↓
                          SQS → Lambda Faturamento (atualiza status nota)
```

**PDF async flow:**
```
POST /notas/{id}/imprimir → 202 Accepted (SolicitacaoImpressao PENDENTE)
                          → EventBridge (Faturamento.ImpressaoSolicitada)
                          → Lambda PDF → S3 → SolicitacaoImpressao CONCLUIDA
Frontend polls GET /solicitacoes-impressao/{id}
```

## Build Commands

### Go (servico-faturamento)
```bash
cd servico-faturamento
go test ./...     # run all unit tests
go vet ./...      # static analysis

# Lambda binaries (required for deploy)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build/bootstrap cmd/lambda/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-outbox/bootstrap cmd/lambda-outbox/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-pdf/bootstrap cmd/lambda-pdf/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-estoque-consumer/bootstrap cmd/lambda-estoque-consumer/main.go
```

### .NET (servico-estoque)
```bash
cd servico-estoque
dotnet build
dotnet test Tests/ServicoEstoque.Tests.csproj      # unit tests (xUnit + Moq)
dotnet publish -c Release -r linux-x64 --self-contained false -o publish-dynamodb/
```

### Angular (web-app)
```bash
cd web-app
npm start                    # dev server on :4200
npm test                     # unit tests (Jest)
npm run test:ci              # CI mode (no watch)
npm run build:prod           # production build → dist/web-app/
```

### CDK (infra)
```bash
cd infra/cdk
npm run synth:serverless                    # validate stacks
npm run deploy:serverless:dev               # deploy to dev
```

## Deploy Frontend to Production
```bash
cd web-app && npm run build:prod
aws s3 sync dist/web-app/ s3://nfe-frontend-dev-246599827442/ --delete
aws cloudfront create-invalidation --distribution-id E3GS1ORK9UYGOX --paths "/*"
```

## Key Architectural Decisions

**DynamoDB single-table design:** All entities share one table. Access patterns are encoded via `PK`/`SK` + GSI1/GSI2. Add new access patterns via GSI, not new tables.

**Outbox pattern:** Events are written to DynamoDB atomically with the business operation, then published to EventBridge by a separate Lambda triggered via DynamoDB Streams. This ensures exactly-once delivery.

**SQS multiplexing:** The faturamento Lambda (`cmd/lambda/main.go`) handles both `APIGatewayProxyRequest` (HTTP routes) and `SQSEvent` (saga responses) by detecting the event type via `json.RawMessage` inspection. The estoque consumer is a separate Lambda (`cmd/lambda-estoque-consumer/main.go`).

**PDF generation is 100% async:** `POST /notas/{id}/imprimir` returns 202 immediately with a `solicitacaoId`. The frontend polls `GET /solicitacoes-impressao/{id}` until status is `CONCLUIDA`. The PDF Lambda generates the PDF and uploads to S3.

**Lambda entry points:**
- `servico-faturamento/cmd/lambda/main.go` — faturamento API + SQS saga handler (mux)
- `servico-faturamento/cmd/lambda-outbox/main.go` — DynamoDB → EventBridge publisher
- `servico-faturamento/cmd/lambda-pdf/main.go` — async PDF generation
- `servico-faturamento/cmd/lambda-estoque-consumer/main.go` — saga estoque consumer
- `servico-estoque/Api/Program.cs` — inventory Lambda via `Amazon.Lambda.AspNetCoreServer`

**Cost guardrails:** CDK Aspects in `infra/cdk/lib/aspects/` enforce no NAT Gateways, no ECS, no RDS, etc. Serverless-only constraint is enforced at synth time.

**Auth:** Cognito User Pool (Free Tier: 50K MAU) + Lambda Authorizer validates JWT on every route except `/health`. Angular has `authGuard`, `auth.interceptor.ts`, and `AuthService` already wired.

**CDK Authorizer build:** The Lambda Authorizer (`infra/lambda-authorizer/`) uses a local CDK bundler (no Docker required). CI pre-builds it with `npm install && npm run build`.

## CI/CD (GitHub Actions)
- `ci.yml` — build + test on every push (Go tests, .NET xUnit, Angular Jest, CDK synth)
- `deploy-dev.yml` — auto-deploy to dev on push to main
- `deploy-prod.yml` — manual approval required
- `build-lambda-estoque.yml` — builds .NET Lambda artifact

## Observability
- CloudWatch Alarms: DLQ messages (threshold=1), Faturamento Lambda errors (threshold=3/5min), Estoque Lambda errors (threshold=3/5min)
- DLQ: `nfe-estoque-dlq-dev` — mensagens indicam falha na saga que não foi retentada
- Logs: structured JSON via `slog` (Go) e `Serilog` (.NET)
