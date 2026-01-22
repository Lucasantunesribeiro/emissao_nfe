# Grafo de Dependências - Sistema NFe

**Data:** 2026-01-19
**Conta:** aws-old (212051644015)
**Região:** us-east-1

---

## 🎯 WORKLOAD PRINCIPAL: Sistema NFe Serverless

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USUÁRIO FINAL                               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CloudFront Distribution                           │
│                  d3065hze06690c.cloudfront.net                       │
│                      (E2WP4QF7I5V84W)                                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
                ▼                       ▼
┌───────────────────────┐   ┌─────────────────────────────────────────┐
│   S3 Frontend         │   │    API Gateway Endpoints                │
│ nfe-frontend-dev-*    │   │  (Proxy para Lambda Functions)          │
│  (Angular App)        │   │                                         │
└───────────────────────┘   │  - ApiEstoque (q99vlf2ppd)              │
                            │  - ApiFaturamento (r9d99rnsz6)          │
                            └─────────────┬───────────────────────────┘
                                          │
                      ┌───────────────────┼───────────────────┐
                      │                   │                   │
                      ▼                   ▼                   ▼
          ┌───────────────────┐ ┌─────────────────┐ ┌──────────────────┐
          │ Lambda: Estoque   │ │ Lambda:         │ │ Lambda: Outbox   │
          │ nfe-estoque-dev   │ │ Faturamento     │ │ Processor        │
          │   (.NET/C#)       │ │ nfe-fatur...-dev│ │ nfe-outbox-...   │
          │   53.5 MB         │ │   (Go)          │ │   (Go)           │
          │   512 MB RAM      │ │   5 MB          │ │   256 MB RAM     │
          │   30s timeout     │ │   512 MB RAM    │ │   60s timeout    │
          └─────┬─────────────┘ └────┬────────────┘ └────┬─────────────┘
                │                    │                    │
                │ VPC: vpc-0b5efd8a245fea948              │
                │ SG: sg-08ea906a06ee802b4                │
                │                    │                    │
                │                    │                    │
    ┌───────────┼────────────────────┼────────────────────┼───────────┐
    │           │                    │                    │           │
    │           ▼                    ▼                    ▼           │
    │   ┌────────────────────────────────────────────────────┐       │
    │   │         RDS PostgreSQL: nfe-db-dev                 │       │
    │   │       (db.t4g.micro, 20GB, PostgreSQL 16.4)        │       │
    │   │  Endpoint: nfe-db-dev.cch2gou443t0...rds.aws...   │       │
    │   │         Schemas: estoque, faturamento              │       │
    │   │       SG: sg-03420f57f816cd889                     │       │
    │   └────────────────────────────────────────────────────┘       │
    │                                                                 │
    │                  EVENT-DRIVEN COMMUNICATION                     │
    │                                                                 │
    │   ┌─────────────────────────────────────────────────────┐      │
    │   │          EventBridge Bus: nfe-events-dev            │      │
    │   │          Archive: nfe-archive-dev                   │      │
    │   │                                                     │      │
    │   │  Event Rules:                                       │      │
    │   │  - nfe-nota-criada-dev                             │      │
    │   │  - nfe-reserva-confirmada-dev                      │      │
    │   │  - nfe-reserva-falhou-dev                          │      │
    │   │  - nfe-outbox-processor-dev (trigger a cada 1min)  │      │
    │   │  - nfe-log-all-events-dev → CloudWatch Logs        │      │
    │   └───────┬─────────────────────────────────────────────┘      │
    │           │                                                     │
    │           │ Events                                              │
    │           ▼                                                     │
    │   ┌────────────────────────────────────────────────────┐       │
    │   │              SQS Queues                            │       │
    │   │                                                    │       │
    │   │  1. nfe-estoque-reserva-dev                       │       │
    │   │     → Consumer: Lambda Estoque                     │       │
    │   │                                                    │       │
    │   │  2. nfe-faturamento-confirmacao-dev               │       │
    │   │     → Consumer: Lambda Faturamento                 │       │
    │   │                                                    │       │
    │   │  3. nfe-dlq-dev (Dead Letter Queue)               │       │
    │   │                                                    │       │
    │   └────────────────────────────────────────────────────┘       │
    │                                                                 │
    └─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     OBSERVABILIDADE                                  │
│                                                                      │
│  CloudWatch Logs:                                                   │
│  - /aws/lambda/nfe-estoque-dev                                      │
│  - /aws/lambda/nfe-faturamento-dev                                  │
│  - /aws/lambda/nfe-outbox-processor-dev                             │
│  - /aws/events/nfe-dev                                              │
│                                                                      │
│  CloudWatch Alarms: (configurados via CDK, status a verificar)      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     SECURITY & SECRETS                               │
│                                                                      │
│  Secrets Manager: (stack nfe-secrets-serverless-dev)                │
│  - Database credentials                                             │
│  - API keys (se houver)                                             │
│                                                                      │
│  IAM Roles:                                                         │
│  - LambdaExecutionRole (compartilhada por todas as Lambdas)         │
│  - API Gateway CloudWatch Roles (2)                                 │
│                                                                      │
│  Security Groups:                                                   │
│  - sg-08ea906a06ee802b4 (Lambda → RDS, VPC endpoints)               │
│  - sg-03420f57f816cd889 (RDS ingress)                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 📊 FLUXO DE DADOS PRINCIPAL

### 1️⃣ Criação de Nota Fiscal:

```
Usuário (Frontend)
  → CloudFront
    → S3 (Angular App carrega no browser)
      → Browser faz requisição à API
        → API Gateway (ApiFaturamento)
          → Lambda Faturamento
            → RDS (insere nota na tabela faturamento.notas_fiscais)
            → RDS (insere evento na tabela faturamento.outbox)
            → Retorna sucesso para o usuário

Outbox Processor (trigger a cada 1 minuto):
  → Lambda Outbox Processor
    → RDS (lê eventos pendentes da tabela outbox)
      → EventBridge (publica evento "NotaFiscalCriada")
        → EventBridge Rule "nfe-nota-criada-dev"
          → SQS: nfe-estoque-reserva-dev
            → Lambda Estoque (processa mensagem)
              → Verifica estoque disponível
              → Se OK: publica "ReservaConfirmada" via EventBridge
              → Se NOK: publica "ReservaFalhou" via EventBridge
```

### 2️⃣ Confirmação de Reserva:

```
EventBridge (evento "ReservaConfirmada")
  → EventBridge Rule "nfe-reserva-confirmada-dev"
    → SQS: nfe-faturamento-confirmacao-dev
      → Lambda Faturamento
        → RDS (atualiza status da nota para "CONFIRMADA")
        → Retorna OK
```

### 3️⃣ Consulta de Produtos/Notas:

```
Usuário (Frontend)
  → CloudFront
    → Browser faz GET
      → API Gateway (ApiEstoque ou ApiFaturamento)
        → Lambda correspondente
          → RDS (query no schema correspondente)
          → Retorna dados para o frontend
```

---

## 🔗 DEPENDÊNCIAS POR RECURSO

### Lambda: nfe-estoque-dev

**Depende de:**
- ✅ VPC: `vpc-0b5efd8a245fea948`
- ✅ Subnets: `subnet-0ff7bcacd7528eda3`, `subnet-0a26241557fc9281c`
- ✅ Security Group: `sg-08ea906a06ee802b4`
- ✅ RDS: `nfe-db-dev` (schema: estoque)
- ✅ SQS: `nfe-estoque-reserva-dev` (event source mapping)
- ✅ EventBridge: `nfe-events-dev` (publica eventos)
- ✅ IAM Role: `LambdaExecutionRoleD5C260-*`
- ✅ CloudWatch Logs: `/aws/lambda/nfe-estoque-dev`
- ✅ API Gateway: `ApiEstoque` (q99vlf2ppd)

**Conecta-se a (downstream):**
- EventBridge (publica ReservaConfirmada, ReservaFalhou)
- SQS Faturamento (indiretamente via EventBridge)

---

### Lambda: nfe-faturamento-dev

**Depende de:**
- ✅ VPC: `vpc-0b5efd8a245fea948`
- ✅ Subnets: `subnet-0ff7bcacd7528eda3`, `subnet-0a26241557fc9281c`
- ✅ Security Group: `sg-08ea906a06ee802b4`
- ✅ RDS: `nfe-db-dev` (schema: faturamento)
- ✅ SQS: `nfe-faturamento-confirmacao-dev` (event source mapping)
- ✅ SQS: `nfe-estoque-reserva-dev` (publica mensagens)
- ✅ EventBridge: `nfe-events-dev` (publica eventos via outbox)
- ✅ IAM Role: `LambdaExecutionRoleD5C260-*`
- ✅ CloudWatch Logs: `/aws/lambda/nfe-faturamento-dev`
- ✅ API Gateway: `ApiFaturamento` (r9d99rnsz6)

**Conecta-se a (downstream):**
- SQS Estoque (publica pedidos de reserva)
- RDS Outbox (escreve eventos para processamento)

---

### Lambda: nfe-outbox-processor-dev

**Depende de:**
- ✅ VPC: `vpc-0b5efd8a245fea948`
- ✅ Subnets: `subnet-0ff7bcacd7528eda3`, `subnet-0a26241557fc9281c`
- ✅ Security Group: `sg-08ea906a06ee802b4`
- ✅ RDS: `nfe-db-dev` (schema: faturamento.outbox)
- ✅ EventBridge: `nfe-events-dev` (publica eventos processados)
- ✅ EventBridge Rule: `nfe-outbox-processor-dev` (trigger a cada 1 min)
- ✅ IAM Role: `LambdaExecutionRoleD5C260-*`
- ✅ CloudWatch Logs: `/aws/lambda/nfe-outbox-processor-dev`

**Conecta-se a (downstream):**
- EventBridge (publica todos os eventos do outbox)

---

### RDS PostgreSQL: nfe-db-dev

**Depende de:**
- ✅ VPC: `vpc-0b5efd8a245fea948`
- ✅ DB Subnet Group: `nfe-database-serverless-dev-dbsubnetgroup-*`
- ✅ Subnets: `subnet-0ff7bcacd7528eda3`, `subnet-0a26241557fc9281c`
- ✅ Security Group: `sg-03420f57f816cd889`
- ✅ KMS Key: `arn:aws:kms:us-east-1:212051644015:key/5c3920d1-b081-491a-95f8-1e4bc4b9001e`
- ✅ DB Parameter Group: `nfe-database-serverless-dev-dbparametergroupd5340a4d-*`
- ✅ Secrets Manager: (credenciais via stack nfe-secrets-serverless-dev)

**Conecta-se a (upstream):**
- Lambda Estoque
- Lambda Faturamento
- Lambda Outbox Processor

---

### API Gateway: ApiEstoque

**Depende de:**
- ✅ Lambda: `nfe-estoque-dev` (backend integration)
- ✅ CloudWatch Logs: (API Gateway logging)
- ✅ IAM Role: `ApiEstoqueCloudWatchRoleC-*`

**Conecta-se a (upstream):**
- CloudFront (CORS origin: `https://d3065hze06690c.cloudfront.net`)

---

### API Gateway: ApiFaturamento

**Depende de:**
- ✅ Lambda: `nfe-faturamento-dev` (backend integration)
- ✅ CloudWatch Logs: (API Gateway logging)
- ✅ IAM Role: `ApiFaturamentoCloudWatchRole5-*`

**Conecta-se a (upstream):**
- CloudFront (CORS origin: `https://d3065hze06690c.cloudfront.net`)

---

### CloudFront Distribution

**Depende de:**
- ✅ S3 Bucket: `nfe-frontend-dev-212051644015` (origin)
- ✅ OAI: `E1S3QHH5TX0NF0` (Origin Access Identity)
- ✅ Cache Policies: HTML e Assets
- ✅ API Gateway: Endpoints Estoque e Faturamento (via proxy paths, se configurado)

**Conecta-se a (upstream):**
- Usuários finais (público)

---

### EventBridge Bus: nfe-events-dev

**Depende de:**
- ✅ EventBridge Archive: `nfe-archive-dev`
- ✅ CloudWatch Logs: `/aws/events/nfe-dev`
- ✅ Event Rules (5 rules configuradas)

**Conecta-se a:**
- SQS Queues (via rules)
- Lambda Outbox Processor (via rules)
- CloudWatch Logs (logging)

---

### SQS Queues

**nfe-estoque-reserva-dev:**
- Consumer: Lambda Estoque (event source mapping)
- DLQ: `nfe-dlq-dev`

**nfe-faturamento-confirmacao-dev:**
- Consumer: Lambda Faturamento (event source mapping)
- DLQ: `nfe-dlq-dev`

**nfe-dlq-dev:**
- Uso: Armazena mensagens que falharam após N tentativas

---

## 🎯 ORDEM DE CRIAÇÃO DE RECURSOS (para migração)

### Stack de Dependências (ordem obrigatória):

```
1. SECRETS (nfe-secrets-serverless-dev)
   └─> Secrets Manager com credenciais do DB

2. NETWORK (nfe-network-serverless-dev)
   ├─> VPC
   ├─> Subnets
   └─> Security Groups

3. MESSAGING (nfe-messaging-serverless-dev)
   ├─> EventBridge Bus
   ├─> EventBridge Archive
   ├─> CloudWatch Logs
   └─> EventBridge Rules (básicas)

4. DATABASE (nfe-database-serverless-dev)
   ├─> DB Subnet Group (depende: Network)
   ├─> RDS Instance (depende: Network, Secrets)
   └─> Schemas criados via migration scripts

5. COMPUTE (nfe-compute-serverless-dev)
   ├─> IAM Roles
   ├─> Lambda Functions (depende: Network, Database, Secrets)
   ├─> API Gateway (depende: Lambda)
   ├─> SQS Queues
   ├─> Event Source Mappings (Lambda ← SQS)
   └─> EventBridge Rules completas (depende: Lambda, SQS)

6. FRONTEND (nfe-frontend-serverless-dev)
   ├─> S3 Bucket
   ├─> CloudFront Distribution (depende: S3, API Gateway URLs)
   └─> Deploy do Angular app no S3
```

---

## 🔍 PONTOS CRÍTICOS PARA MIGRAÇÃO

### ⚠️ Dados Persistentes (CRÍTICO):

1. **RDS PostgreSQL** (`nfe-db-dev`)
   - **Migração:** Snapshot → Compartilhar → Restaurar na aws-new
   - **Downtime:** Sim (durante restore + cutover)
   - **Validação:** Comparar row counts, checksums

2. **EventBridge Archive** (`nfe-archive-dev`)
   - **Migração:** Replay events se necessário
   - **Downtime:** Não (pode recriar vazio)

3. **SQS Messages in-flight**
   - **Migração:** Drenar filas antes do cutover
   - **Downtime:** Sim (pausar processamento)

### ⚠️ Configurações Hardcoded:

1. **CORS_ORIGINS** nas Lambdas:
   - Atual: `https://d3065hze06690c.cloudfront.net`
   - **Ação:** Atualizar com novo CloudFront domain após deploy

2. **Database Connection Strings** nas Lambdas:
   - Atual: `nfe-db-dev.cch2gou443t0.us-east-1.rds.amazonaws.com`
   - **Ação:** Atualizar com novo RDS endpoint

3. **SQS URLs** nas Lambdas:
   - Atual: `https://sqs.us-east-1.amazonaws.com/212051644015/...`
   - **Ação:** Atualizar com novos SQS URLs (novo account ID)

4. **EventBridge Bus Name**:
   - Atual: `nfe-events-dev`
   - **Ação:** Manter mesmo nome ou atualizar código

### ⚠️ Recursos que NÃO podem ser movidos:

- ❌ Lambda Functions (recriar na aws-new)
- ❌ API Gateway (recriar na aws-new)
- ❌ EventBridge Bus (recriar na aws-new)
- ❌ SQS Queues (recriar na aws-new)
- ❌ CloudFront Distribution (recriar na aws-new, novo domain)
- ❌ S3 Bucket (recriar e copiar objetos)

### ✅ Recursos que PODEM ser movidos/copiados:

- ✅ RDS Snapshot (compartilhar entre contas)
- ✅ S3 Objects (sync entre buckets)
- ✅ Código das Lambdas (zip files no CDK assets bucket)
- ✅ CloudFormation Templates (IaC local)

---

## 💰 ESTIMATIVA DE CUSTO PÓS-MIGRAÇÃO (aws-new)

**Premissa:** Mesmo ambiente (dev), mesma configuração

| Serviço | Recurso | Custo Mensal |
|---------|---------|--------------|
| RDS | db.t4g.micro (20GB gp3, Single-AZ) | ~$15 |
| Lambda | 3 functions, baixo tráfego dev | ~$5-10 |
| API Gateway | 2 APIs, baixo tráfego | ~$1 |
| EventBridge | Custom bus + rules | ~$1 |
| SQS | 3 queues, baixo volume | ~$0.50 |
| S3 | Frontend bucket (<1GB) | ~$0.25 |
| CloudFront | Baixo tráfego dev | ~$1 |
| Data Transfer | Mínimo | ~$1 |
| **TOTAL** | | **~$24-29/mês** |

**Custo adicional temporário durante migração:**
- RDS Snapshot storage: ~$0.10/GB/mês × 20GB = ~$2/mês (manter por 30 dias)

---

## 🚀 PRÓXIMO PASSO: Classificação de Recursos

Avançar para **FASE 1.4**: Classificar cada recurso como:
- **MIGRAR** (essencial para o workload)
- **PAUSAR** (temporariamente desligar)
- **DECOMISSIONAR** (deletar após migração)
- **MANTER** (deixar na conta antiga, ex: EmailTriageAI EC2)
