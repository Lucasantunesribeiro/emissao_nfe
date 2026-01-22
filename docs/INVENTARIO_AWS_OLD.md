# Inventário AWS - Conta Antiga (212051644015)
**Data:** 2026-01-19
**Região Principal:** us-east-1
**Usuário IAM:** nfe-deploy-user

---

## 📋 RESUMO EXECUTIVO

**Sistema Principal Identificado:** Sistema de Emissão de Notas Fiscais (NFe)
**Arquitetura:** Serverless (Lambda + API Gateway + RDS + EventBridge + CloudFront)
**Ambiente:** Development (dev)
**Status:** ✅ Operacional

**Custo Estimado Mensal (dev):**
- RDS db.t4g.micro: ~$15/mês
- Lambda (baixo uso): ~$5-10/mês
- EventBridge: ~$1/mês
- CloudFront: ~$1/mês (baixo tráfego)
- S3: ~$0.50/mês
- **TOTAL ESTIMADO: ~$22-27/mês**

---

## 🏗️ INFRAESTRUTURA COMO CÓDIGO (IaC)

**Ferramenta:** AWS CDK (TypeScript)
**Localização:** `/mnt/d/Programacao/Emissao_NFE/infra/cdk/`

### CloudFormation Stacks Deployadas:

1. ✅ **nfe-secrets-serverless-dev** (criado: 2026-01-12)
2. ✅ **nfe-network-serverless-dev** (atualizado: 2026-01-14)
3. ✅ **nfe-messaging-serverless-dev** (atualizado: 2026-01-14)
4. ✅ **nfe-database-serverless-dev** (atualizado: 2026-01-14)
5. ✅ **nfe-frontend-serverless-dev** (atualizado: 2026-01-14)
6. ✅ **nfe-compute-serverless-dev** (criado: 2026-01-14)
7. ✅ **CDKToolkit** (bootstrap stack)

**Status:** Todas as stacks estão em `CREATE_COMPLETE` ou `UPDATE_COMPLETE`

---

## 🖥️ COMPUTE (Lambda Functions)

### Serviços Principais:

| Nome | Runtime | Tamanho | Memória | Timeout | VPC | Descrição |
|------|---------|---------|---------|---------|-----|-----------|
| **nfe-estoque-dev** | .NET 9 (provided.al2023) | 53.5 MB | 512 MB | 30s | ✅ | Serviço de Estoque (.NET/C#) |
| **nfe-faturamento-dev** | Go (provided.al2023) | 5 MB | 512 MB | 30s | ✅ | Serviço de Faturamento (Go) |
| **nfe-outbox-processor-dev** | Go (provided.al2023) | 4.5 MB | 256 MB | 60s | ✅ | Processador Outbox Pattern (Go) |

### Funções de Infraestrutura:

- `nfe-network-serverless-de-CustomVpcRestrictDefault-*` (CDK custom resource)
- `nfe-frontend-serverless-d-CustomS3AutoDeleteObject-*` (S3 auto-delete)
- `nfe-messaging-serverless--AWS679f53fac002430cb0da5-*` (CloudWatch Logs)
- `nfe-database-serverless-d-LogRetentionaae0aa3c5b4d-*` (Log retention)

**VPC Configuration:**
- Subnets: `subnet-0ff7bcacd7528eda3` (us-east-1a), `subnet-0a26241557fc9281c` (us-east-1b)
- Security Group: `sg-08ea906a06ee802b4`
- VPC: `vpc-0b5efd8a245fea948`

---

## 🌐 API GATEWAY

### API REST - Estoque:

- **ID:** `q99vlf2ppd`
- **Stage:** `dev`
- **Endpoints:**
  - `GET /health`
  - `GET /api/v1/produtos`
  - `POST /api/v1/produtos`
  - `GET /api/v1/produtos/{id}`
  - `PUT /api/v1/produtos/{id}`

### API REST - Faturamento:

- **ID:** `r9d99rnsz6`
- **Stage:** `dev`
- **Endpoints:**
  - `GET /health`
  - `GET /api/v1/notas`
  - `POST /api/v1/notas`
  - `GET /api/v1/notas/{id}`
  - `PUT /api/v1/notas/{id}`
  - `POST /api/v1/notas/{id}/impressao`
  - `POST /api/v1/notas/{id}/itens`

**CORS:** Configurado com CloudFront domain

---

## 🗄️ DATABASE

### RDS PostgreSQL:

- **Identificador:** `nfe-db-dev`
- **Classe:** `db.t4g.micro` (Graviton2, 1 vCPU, 1 GB RAM)
- **Engine:** PostgreSQL 16.4
- **Storage:** 20 GB gp3 (IOPS: 3000, Throughput: 125 MB/s)
- **Max Storage:** 50 GB (Auto Scaling)
- **Endpoint:** `nfe-db-dev.cch2gou443t0.us-east-1.rds.amazonaws.com:5432`
- **Database:** `nfe_db`
- **Schemas:** `faturamento`, `estoque`
- **Multi-AZ:** ❌ (Single-AZ para economia em dev)
- **Public Access:** ✅ Sim
- **Backup Retention:** 1 dia
- **Deletion Protection:** ❌ Desabilitado
- **Encryption:** ✅ Habilitado (KMS)
- **VPC:** `vpc-0b5efd8a245fea948`
- **Security Group:** `sg-03420f57f816cd889`

**⚠️ ATENÇÃO:**
- Database está publicamente acessível (para facilitar dev, mas risco de segurança)
- Sem Multi-AZ (downtime em falhas)
- Deletion protection desabilitado (risco de perda acidental)

---

## 📨 MESSAGING (EventBridge + SQS)

### EventBridge:

- **Event Bus:** `nfe-events-dev`
- **Archive:** `nfe-archive-dev` (retention configurável)
- **CloudWatch Logs:** `/aws/events/nfe-dev`

#### Event Rules:

1. **nfe-nota-criada-dev** → Trigger ao criar nota fiscal
2. **nfe-reserva-confirmada-dev** → Trigger quando estoque confirma reserva
3. **nfe-reserva-falhou-dev** → Trigger quando estoque falha ao reservar
4. **nfe-log-all-events-dev** → Logging de todos eventos para CloudWatch
5. **nfe-outbox-processor-dev** → Trigger a cada 1 minuto para processar outbox

### SQS Queues:

1. **nfe-estoque-reserva-dev**
   - URL: `https://sqs.us-east-1.amazonaws.com/212051644015/nfe-estoque-reserva-dev`
   - Consumer: Lambda `nfe-estoque-dev`

2. **nfe-faturamento-confirmacao-dev**
   - URL: `https://sqs.us-east-1.amazonaws.com/212051644015/nfe-faturamento-confirmacao-dev`
   - Consumer: Lambda `nfe-faturamento-dev`

3. **nfe-dlq-dev**
   - URL: `https://sqs.us-east-1.amazonaws.com/212051644015/nfe-dlq-dev`
   - Uso: Dead Letter Queue para mensagens que falharam

---

## 🌍 FRONTEND (CloudFront + S3)

### S3 Buckets:

1. **nfe-frontend-dev-212051644015**
   - Uso: Hospedagem do frontend (Angular)
   - Criado: 2026-01-12

2. **cdk-hnb659fds-assets-212051644015-us-east-1**
   - Uso: Assets do CDK (infraestrutura)
   - Criado: 2026-01-12

### CloudFront Distribution:

- **ID:** `E2WP4QF7I5V84W`
- **Domain:** `d3065hze06690c.cloudfront.net`
- **Origin:** S3 bucket `nfe-frontend-dev-212051644015`
- **OAI:** `E1S3QHH5TX0NF0` (Origin Access Identity)
- **Cache Policies:**
  - HTML: `5a2d065c-7a3c-4881-b07a-10a06ff43f6c` (TTL curto)
  - Assets: `8e11b447-5e51-4acc-83a8-1aa4cc3d7e01` (TTL longo)
- **Price Class:** PriceClass_100 (NA + EU)

---

## 🔒 SECURITY

### IAM Roles:

1. **LambdaExecutionRole** (nfe-compute-serverless-de-LambdaExecutionRoleD5C260-*)
   - Usado por: nfe-estoque-dev, nfe-faturamento-dev, nfe-outbox-processor-dev
   - Permissões: VPC, RDS, SQS, EventBridge, Secrets Manager, CloudWatch Logs

2. **API Gateway CloudWatch Roles** (2 roles, um para cada API)

3. **Custom Resource Roles** (CDK managed)

### Security Groups:

- **sg-08ea906a06ee802b4**: Lambda functions (acesso à VPC)
- **sg-03420f57f816cd889**: RDS (PostgreSQL)

### Secrets Manager:

- Configurado via stack `nfe-secrets-serverless-dev`
- Armazena credenciais do banco de dados

---

## 🌐 NETWORK

### VPC:

- **ID:** `vpc-0b5efd8a245fea948`
- **CIDR:** `10.0.0.0/16`
- **AZs:** 2 (us-east-1a, us-east-1b)
- **NAT Gateways:** 0 (economia em dev - usa VPC Endpoints para serviços AWS)
- **Flow Logs:** ❌ Desabilitado (economia)

### Subnets:

- **subnet-0ff7bcacd7528eda3** (us-east-1a) - Public
- **subnet-0a26241557fc9281c** (us-east-1b) - Public

---

## 📊 OBSERVABILIDADE

### CloudWatch Log Groups:

- `/aws/lambda/nfe-estoque-dev`
- `/aws/lambda/nfe-faturamento-dev`
- `/aws/lambda/nfe-outbox-processor-dev`
- `/aws/events/nfe-dev`
- Outros log groups de funções CDK custom resources

### CloudWatch Alarms:

- **Status:** ⚠️ Configurado no código CDK mas não verificado se estão ativos

---

## ⚠️ RECURSOS NÃO RELACIONADOS AO NFe

### EC2 Instance (EmailTriageAI):

- **ID:** `i-01052b975ba194c38`
- **Tipo:** `t3.micro`
- **Estado:** Running
- **Nome:** EmailTriageAI
- **⚠️ IMPORTANTE:** Este workload NÃO faz parte do sistema NFe e deve ser tratado separadamente na migração

---

## 🚨 PROBLEMAS DE PERMISSÃO DETECTADOS

O usuário IAM `nfe-deploy-user` **NÃO** tem as seguintes permissões:

1. ❌ `ec2:DescribeRegions` (necessário para listar regiões)
2. ❌ `elasticloadbalancing:DescribeLoadBalancers` (ALB/NLB)
3. ❌ `cloudfront:ListDistributions` (CloudFront)

**Recomendação:** Adicionar permissões de leitura completa para facilitar o inventário e a migração.

---

## 📍 SERVIDOR PRINCIPAL IDENTIFICADO

**Conclusão Automática:**

O **"servidor principal"** a ser migrado é o **Sistema NFe Serverless** composto por:

1. ✅ **3 Lambda Functions** (estoque, faturamento, outbox)
2. ✅ **2 API Gateways** (endpoints REST)
3. ✅ **1 RDS PostgreSQL** (banco de dados central)
4. ✅ **EventBridge + SQS** (mensageria)
5. ✅ **CloudFront + S3** (frontend)

**Indicadores que confirmam que este é o workload principal:**
- Exposto publicamente via CloudFront e API Gateway
- Tem domínio público: `d3065hze06690c.cloudfront.net`
- Database centralizado com múltiplos schemas
- Arquitetura completa (frontend + backend + mensageria)
- Deployado recentemente (Janeiro 2026)
- Gerenciado via IaC (CDK) com múltiplas stacks

---

## 🎯 PRÓXIMOS PASSOS (FASE 1)

1. ✅ Inventário completo multi-região (apenas us-east-1 tem recursos)
2. ⏳ Mapear grafo de dependências detalhado
3. ⏳ Classificar recursos (MIGRAR/PAUSAR/DECOMISSIONAR/MANTER)
4. ⏳ Estimar custos de migração
5. ⏳ Preparar credenciais da conta aws-new
