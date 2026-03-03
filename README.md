# 📄 Sistema de Emissão de Nota Fiscal Eletrônica (NFe)

> **Arquitetura Serverless Event-Driven completa** para emissão de notas fiscais com microserviços, mensageria e geração automática de PDFs.

[![AWS](https://img.shields.io/badge/AWS-Serverless-FF9900?logo=amazon-aws)](https://aws.amazon.com)
[![Go](https://img.shields.io/badge/Go-1.23-00ADD8?logo=go)](https://go.dev)
[![.NET](https://img.shields.io/badge/.NET-9-512BD4?logo=dotnet)](https://dotnet.microsoft.com)
[![Angular](https://img.shields.io/badge/Angular-18-DD0031?logo=angular)](https://angular.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-CDK-3178C6?logo=typescript)](https://aws.amazon.com/cdk/)

**🔗 Demo:** [https://d1gdw7rlsi8u42.cloudfront.net](https://d1gdw7rlsi8u42.cloudfront.net)

---

## 🎯 Sobre o Projeto

Sistema distribuído **100% serverless** para gestão de notas fiscais eletrônicas, desenvolvido com **arquitetura orientada a eventos** e **práticas de FinOps** para otimização de custos AWS.

### Principais Diferenciais Técnicos

✅ **Arquitetura Event-Driven**: EventBridge + SQS com padrão Outbox
✅ **Microserviços Poliglota**: Go + .NET 9 em Lambda Functions
✅ **Single-Table Design**: DynamoDB com GSI otimizados
✅ **Geração Dinâmica de PDF**: Lambda + gofpdf com dados reais da nota
✅ **Infraestrutura como Código**: AWS CDK com cost guardrails
✅ **Otimização de Custos**: ~$0/mês no Free Tier ($5.49/mês fora)

---

## 🛠️ Stack Tecnológica

### Backend

| Serviço | Linguagem | Framework/Libs | Responsabilidade |
|---------|-----------|----------------|------------------|
| **servico-faturamento** | Go 1.23 | AWS Lambda Go SDK, gofpdf, DynamoDB | Gestão de notas fiscais e geração de PDFs |
| **servico-estoque** | .NET 9 | ASP.NET Minimal APIs, EF Core | Controle de produtos e reservas de estoque |

**Arquitetura:**
- **Runtime**: AWS Lambda (provided.al2023 para Go, dotnet9 para .NET)
- **API Gateway**: REST APIs com CORS e rate limiting
- **Mensageria**: EventBridge (event bus customizado) + SQS + DLQ
- **Banco de Dados**: DynamoDB (single-table design) + RDS PostgreSQL
- **Storage**: S3 para PDFs + CloudFront para CDN
- **Segurança**: Secrets Manager, IAM roles com least privilege

### Frontend

- **Angular 18** (Standalone Components, SSR-ready)
- **TailwindCSS** para design system
- **RxJS** para programação reativa
- **TypeScript** strict mode
- **Hospedagem**: S3 Static Website + CloudFront

### Infraestrutura (IaC)

- **AWS CDK** (TypeScript) com 6 stacks modulares
- **Cost Guardrails**: CDK Aspects para prevenir recursos caros
- **Multi-ambiente**: dev/prod com configurações separadas
- **CI/CD Ready**: Scripts de deploy automatizado

---

## 🏗️ Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Angular 18)                     │
│                     S3 + CloudFront Distribution                 │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AWS API GATEWAY (REST)                        │
│              ┌──────────────┬──────────────┐                     │
│              │  Faturamento │   Estoque    │                     │
│              │   API (Go)   │  API (.NET)  │                     │
└──────────────┴──────┬───────┴──────┬───────┴─────────────────────┘
                      │              │
                      ▼              ▼
           ┌──────────────────────────────────┐
           │   AWS LAMBDA FUNCTIONS           │
           │                                  │
           │  ┌─────────────┐  ┌───────────┐ │
           │  │ Faturamento │  │  Estoque  │ │
           │  │   (Go)      │  │  (.NET 9) │ │
           │  └──────┬──────┘  └─────┬─────┘ │
           │         │               │       │
           │         ▼               ▼       │
           │  ┌──────────────────────────┐  │
           │  │   PDF Generator (Go)     │  │
           │  │   gofpdf + S3 Upload     │  │
           │  └────────┬─────────────────┘  │
           └───────────┼─────────────────────┘
                       │
                       ▼
      ┌────────────────────────────────────────┐
      │      EVENT BUS (EventBridge)           │
      │  • Faturamento.NotaFechada             │
      │  • Faturamento.ImpressaoSolicitada     │
      │  • Estoque.ReservaConfirmada           │
      └────────┬───────────────────────────────┘
               │
               ▼
      ┌────────────────────────────────────────┐
      │    QUEUES (SQS + DLQ)                  │
      │  • estoque-reserva-queue               │
      │  • faturamento-confirmacao-queue       │
      │  • dead-letter-queue                   │
      └────────┬───────────────────────────────┘
               │
               ▼
      ┌────────────────────────────────────────┐
      │         DATA LAYER                     │
      │                                        │
      │  ┌──────────────┐  ┌───────────────┐  │
      │  │  DynamoDB    │  │ RDS PostgreSQL│  │
      │  │ (Main Table) │  │  (Relational) │  │
      │  │   + GSI1/2   │  │   Migrations  │  │
      │  └──────────────┘  └───────────────┘  │
      └────────────────────────────────────────┘
               │
               ▼
      ┌────────────────────────────────────────┐
      │     STORAGE & CDN                      │
      │  • S3 Bucket (nfe-pdfs-mock)           │
      │  • CloudFront Distribution (PDFs)      │
      └────────────────────────────────────────┘
```

### Padrões Implementados

- **Event Sourcing**: Outbox pattern para garantia de entrega
- **CQRS**: Separação de leitura/escrita (DynamoDB queries otimizadas)
- **Idempotência**: Idempotency-Key em todas operações críticas
- **Circuit Breaker**: Dead Letter Queue (DLQ) para mensagens falhadas
- **Retry Logic**: Exponential backoff em integrações externas

---

## 💡 Funcionalidades Implementadas

### ✅ Gestão de Produtos (Estoque)
- Cadastro e atualização de produtos
- Controle de saldo em tempo real
- Reserva de estoque com validação de disponibilidade
- Rollback automático em caso de falha

### ✅ Emissão de Notas Fiscais
- Criação de notas com múltiplos itens
- Validação de estoque disponível antes do fechamento
- Fechamento transacional com atualização de estoque
- Histórico completo de operações

### ✅ Geração Automática de PDF
- **Trigger**: Evento `Faturamento.ImpressaoSolicitada` no EventBridge
- **Processamento**: Lambda Go gera PDF com `gofpdf` em ~500ms
- **Conteúdo Dinâmico**: Dados reais da nota (itens, quantidades, preços, total)
- **Armazenamento**: Upload automático para S3 com URL pública
- **Idempotência**: Chave única previne duplicação

### ✅ Processamento Assíncrono
- Mensageria desacoplada via EventBridge
- SQS para processamento em lote
- DLQ para análise de falhas
- Outbox pattern implementado no DynamoDB

---

## 🚀 Quick Start

### Pré-requisitos

- **Go 1.23+** ([download](https://go.dev/dl/))
- **.NET 9 SDK** ([download](https://dotnet.microsoft.com/download))
- **Node.js 22+** ([download](https://nodejs.org/))
- **AWS CLI v2** configurado ([guia](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html))
- **AWS CDK CLI**: `npm install -g aws-cdk`

### 1️⃣ Configuração

```bash
# Clone o repositório
git clone https://github.com/Lucasantunesribeiro/emissao_nfe.git
cd emissao_nfe

# Instalar dependências
cd web-app && npm install && cd ..
cd infra/cdk && npm install && cd ../..
cd servico-faturamento && go mod download && cd ..
```

### 2️⃣ Build

```bash
# Build Serviço Estoque (.NET)
cd servico-estoque
dotnet publish -c Release -r linux-x64 --self-contained false -o publish
cd ..

# Build Serviço Faturamento (Go)
cd servico-faturamento
GOOS=linux GOARCH=amd64 go build -tags lambda.norpc -o build/bootstrap cmd/lambda/main.go
cd ..

# Build Frontend (Angular)
cd web-app
npm run build:prod
cd ..
```

### 3️⃣ Deploy AWS

```bash
cd infra/cdk

# Bootstrap CDK (primeira vez)
cdk bootstrap

# Deploy todas as stacks
cdk deploy --all --require-approval never
```

### 4️⃣ Testar

```bash
# Obter URL da API (output do CDK)
API_URL=$(aws cloudformation describe-stacks \
  --stack-name nfe-compute-serverless-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiFaturamentoUrl`].OutputValue' \
  --output text)

# Criar nota fiscal
curl -X POST $API_URL/api/v1/notas \
  -H "Content-Type: application/json" \
  -d '{"numero": "NFE-001"}'

# Frontend disponível em CloudFront
echo "Acesse: https://d1gdw7rlsi8u42.cloudfront.net"
```

---

## 📊 FinOps: Otimização de Custos AWS

### Estratégias Implementadas

| Otimização | Economia Mensal | Implementação |
|------------|-----------------|---------------|
| **Serverless-only** | $28.47 | Eliminado ECS, Fargate, ALB, NAT Gateway |
| **DynamoDB On-Demand** | $0 (Free Tier) | 25GB + 25 WCU/RCU permanente grátis |
| **Lambda Fora da VPC** | $21.90 | Sem VPC Endpoints necessários |
| **RDS Scheduler** | $9.48 | Database rodando apenas horário comercial (dev) |
| **Logs 1-day Retention** | $2.50 | CloudWatch Logs com retenção curta |
| **CDK Cost Guardrails** | Prevenção | CDK Aspect bloqueia recursos caros (NAT, Fargate) |

**Resultado:** $5.49/mês (86% de economia vs. baseline $45.37/mês)

### Free Tier Completo (12 meses)

- ✅ **Lambda**: 1M invocações/mês
- ✅ **API Gateway**: 1M chamadas/mês
- ✅ **DynamoDB**: 25GB + 25 WCU/RCU (permanente)
- ✅ **S3**: 5GB storage + 20K GET requests
- ✅ **CloudFront**: 1TB transferência/mês
- ✅ **EventBridge**: 100K eventos/mês
- ✅ **SQS**: 1M requests/mês

---

## 📁 Estrutura do Projeto

```
emissao_nfe/
├── servico-estoque/              # Microserviço .NET 9
│   ├── Api/                      # Controllers e startup
│   ├── Aplicacao/               # Use cases (CQRS)
│   ├── Dominio/                 # Entities e business rules
│   └── Infraestrutura/          # EF Core, repositories, EventBridge
│
├── servico-faturamento/          # Microserviço Go
│   ├── cmd/lambda/              # Lambda handler
│   ├── internal/
│   │   ├── dominio/             # Domain models
│   │   ├── repositorio/         # DynamoDB repositories
│   │   └── pdf/                 # PDF generator (gofpdf)
│   └── go.mod
│
├── web-app/                      # Frontend Angular 18
│   ├── src/app/
│   │   ├── core/                # Services, guards, interceptors
│   │   ├── features/            # Feature modules (notas, produtos)
│   │   └── shared/              # Shared components
│   └── tailwind.config.js
│
├── infra/                        # Infraestrutura como Código
│   ├── cdk/                     # AWS CDK (TypeScript)
│   │   ├── bin/                 # CDK app entry points
│   │   └── lib/
│   │       ├── aspects/         # Cost guardrails
│   │       ├── config/          # Environment configs
│   │       └── stacks/          # CloudFormation stacks
│   │           ├── database-dynamodb-stack.ts
│   │           ├── compute-stack-serverless.ts
│   │           ├── messaging-stack-serverless.ts
│   │           └── frontend-stack-serverless.ts
│   └── scripts/                 # Deploy automation
│
└── scripts/                      # Utility scripts
    ├── aws-cost-check.sh        # Cost monitoring
    └── aws-cost-kill-switch.sh  # Emergency shutdown
```

---

## 🧪 Testes e Qualidade

### Backend
- **Go**: `go test ./...` (unit tests)
- **.NET**: `dotnet test` (xUnit + FluentAssertions)

### Frontend
- **Angular**: `npm test` (Jasmine + Karma)
- **E2E**: `npm run e2e` (Playwright)

### Infraestrutura
- **CDK**: `npm run test` (snapshot tests)
- **Cost Validation**: CDK Aspects em tempo de synth

---

## 📈 Monitoramento

### CloudWatch

```bash
# Logs em tempo real
aws logs tail /aws/lambda/nfe-faturamento-dev --follow
aws logs tail /aws/lambda/nfe-estoque-dev --follow

# Métricas
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=nfe-faturamento-dev \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

### Cost Explorer

```bash
# Custo atual do mês
./scripts/aws-cost-check.sh
```

---

## 🔒 Segurança

- ✅ **Secrets Manager**: Credenciais de banco criptografadas
- ✅ **IAM Roles**: Least privilege principle
- ✅ **CORS**: Configuração restritiva por origem
- ✅ **API Rate Limiting**: Throttling configurado
- ✅ **Input Validation**: DTO validation em todos endpoints
- ✅ **SQL Injection Protection**: ORM com parametrização (EF Core, GORM)
- ✅ **DDoS Protection**: CloudFront + AWS Shield Standard

---

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor:

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add: AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

---

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](LICENSE) para mais detalhes.

---

## 👤 Autor

**Lucas Antunes Ribeiro**

- GitHub: [@Lucasantunesribeiro](https://github.com/Lucasantunesribeiro)
- LinkedIn: [Lucas Antunes Ribeiro](https://www.linkedin.com/in/lucas-antunes-ribeiro)

---

## 🎓 Aprendizados e Decisões Técnicas

### Por que Go + .NET?

- **Go**: Performance excepcional em Lambda (cold start <200ms), ideal para geração de PDFs
- **.NET 9**: Produtividade e type safety, excelente para lógica de negócio complexa

### Por que DynamoDB + PostgreSQL?

- **DynamoDB**: Single-table design para queries otimizadas (100% Free Tier permanente)
- **PostgreSQL**: Dados relacionais complexos com migrations controladas

### Por que EventBridge ao invés de RabbitMQ?

- **EventBridge**: Serverless, $0 no Free Tier, integração nativa com Lambda
- **RabbitMQ (Amazon MQ)**: $28/mês mínimo, requer manutenção

### Por que CDK ao invés de Terraform?

- **AWS CDK**: Type safety (TypeScript), constructs reutilizáveis, testes unitários
- **Terraform**: Agnóstico, mas verboso e sem type checking

---

**⭐ Se este projeto foi útil, considere dar uma estrela no GitHub!**
