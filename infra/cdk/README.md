# NFe Infrastructure - AWS CDK

Infraestrutura completa do sistema NFe usando AWS CDK (TypeScript).

## 📋 Pré-requisitos

### Software Necessário

- **Node.js 22+** - [Download](https://nodejs.org/)
- **AWS CLI v2** - [Download](https://aws.amazon.com/cli/)
- **AWS CDK CLI** - `npm install -g aws-cdk`
- **Git** - Para versionamento

### Credenciais AWS

```bash
# Configurar credenciais AWS
aws configure

# Verificar configuração
aws sts get-caller-identity
```

### Permissões IAM Necessárias

O usuário/role IAM precisa de:

- **AdministratorAccess** (recomendado para setup inicial)
- OU políticas específicas:
  - `AWSCloudFormationFullAccess`
  - `IAMFullAccess`
  - `AmazonEC2FullAccess`
  - `AmazonECSFullAccess`
  - `AmazonRDSFullAccess`
  - `AmazonMQFullAccess`
  - `AmazonS3FullAccess`
  - `CloudFrontFullAccess`
  - `AWSSecretsManagerFullAccess`

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                         CloudFront (CDN)                         │
│                     ↓ S3 Bucket (Frontend)                       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  Application Load Balancer (ALB)                 │
│              /api/faturamento/*  │  /api/estoque/*              │
└────────────────────┬──────────────┴──────────┬───────────────────┘
                     │                         │
         ┌───────────▼──────────┐  ┌──────────▼──────────┐
         │  ECS Fargate (Go)    │  │ ECS Fargate (.NET)  │
         │  Faturamento Service │  │  Estoque Service    │
         └───────────┬──────────┘  └──────────┬──────────┘
                     │                         │
         ┌───────────▼─────────────────────────▼──────────┐
         │          RDS PostgreSQL (2 schemas)             │
         │       faturamento  │  estoque                   │
         └─────────────────────────────────────────────────┘

         ┌─────────────────────────────────────────────────┐
         │      Amazon MQ (RabbitMQ - AMQPS 5671)          │
         └─────────────────────────────────────────────────┘
```

## 📁 Estrutura do Projeto

```
infra/cdk/
├── bin/
│   └── nfe-infra.ts          # Entry point CDK
├── lib/
│   ├── stacks/
│   │   ├── network-stack.ts        # VPC, Subnets, Security Groups
│   │   ├── secrets-stack.ts        # Secrets Manager
│   │   ├── database-stack.ts       # RDS PostgreSQL
│   │   ├── messaging-stack.ts      # Amazon MQ RabbitMQ
│   │   ├── compute-stack.ts        # ECS Fargate + ECR
│   │   ├── loadbalancer-stack.ts   # ALB + Target Groups
│   │   └── frontend-stack.ts       # S3 + CloudFront
│   └── config/
│       ├── dev.ts             # Configuração ambiente dev
│       └── prod.ts            # Configuração ambiente prod
├── cdk.json                   # CDK config
├── package.json               # Dependências
├── tsconfig.json              # TypeScript config
└── README.md                  # Este arquivo
```

## 🚀 Quick Start

### 1. Instalar Dependências

```bash
cd infra/cdk
npm install
```

### 2. Build TypeScript

```bash
npm run build
```

### 3. Bootstrap CDK (primeira vez apenas)

```bash
# Bootstrap para região us-east-1
npm run bootstrap

# OU manualmente
cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

### 4. Synth (Gerar CloudFormation)

```bash
# Ambiente dev
npm run synth:dev

# Ambiente prod
npm run synth:prod

# Verificar templates em cdk.out/
```

### 5. Deploy

#### Opção A: Via Script Interativo (Recomendado)

```bash
cd ../scripts
chmod +x deploy.sh
./deploy.sh
```

#### Opção B: Via CDK CLI

```bash
# Deploy ambiente dev
npm run deploy:dev

# Deploy ambiente prod
npm run deploy:prod
```

## 🔧 Configuração por Ambiente

### **Dev** (Economia de Custos)

- VPC: 2 AZs, 1 NAT Gateway
- RDS: db.t4g.micro, Single-AZ
- Amazon MQ: mq.t3.micro, Single Instance
- ECS: 1 task/service, 0.25 vCPU / 0.5 GB
- Auto-scaling: Desabilitado
- **Custo estimado**: ~$150-200/mês

### **Prod** (Alta Disponibilidade)

- VPC: 2 AZs, 2 NAT Gateways
- RDS: db.t4g.small, Multi-AZ
- Amazon MQ: mq.t3.micro, Active/Standby
- ECS: 2 tasks/service, 0.5 vCPU / 1 GB
- Auto-scaling: Habilitado (max 10 tasks)
- **Custo estimado**: ~$400-500/mês

## 📊 Outputs Importantes

Após deploy, verifique os outputs:

```bash
# Listar todos outputs (dev)
aws cloudformation describe-stacks \
  --stack-name nfe-loadbalancer-dev \
  --query 'Stacks[0].Outputs'

# Outputs principais:
- AlbDnsName: Endpoint do ALB
- CloudFrontUrl: URL do frontend
- DbEndpoint: Endpoint do RDS
- MqAmqpsEndpoint: Endpoint do RabbitMQ (porta 5671)
- FaturamentoRepoUri: URI do ECR (Faturamento)
- EstoqueRepoUri: URI do ECR (Estoque)
```

## 🗄️ Pós-Deploy: Criar Schemas PostgreSQL

### Opção 1: Via psql (manual)

```bash
# 1. Obter endpoint RDS
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name nfe-database-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' \
  --output text)

# 2. Obter senha do Secrets Manager
DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id nfe/db/credentials-dev \
  --query 'SecretString' --output text | jq -r '.password')

# 3. Conectar e executar SQL
psql -h $DB_ENDPOINT -U nfeadmin -d nfe_db -f ../scripts/create-schemas.sql
```

### Opção 2: Via Lambda (automatizado)

Ver: `docs/post-deploy-setup.md`

## 🔑 Secrets Manager - Pós-Deploy

Após deploy, criar secrets adicionais:

```bash
# 1. Obter endpoint do Amazon MQ
MQ_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name nfe-messaging-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`MqAmqpsEndpoint`].OutputValue' \
  --output text)

# 2. Obter credenciais MQ
MQ_CREDS=$(aws secretsmanager get-secret-value \
  --secret-id nfe/mq/credentials-dev \
  --query 'SecretString' --output text)

MQ_USERNAME=$(echo $MQ_CREDS | jq -r '.username')
MQ_PASSWORD=$(echo $MQ_CREDS | jq -r '.password')

# 3. Criar secret: RabbitMQ URL (Faturamento - GO)
aws secretsmanager create-secret \
  --name nfe/mq/url-dev \
  --secret-string "amqps://$MQ_USERNAME:$MQ_PASSWORD@$MQ_ENDPOINT:5671/"

# 4. Criar secret: RabbitMQ Host (Estoque - .NET)
aws secretsmanager create-secret \
  --name nfe/mq/host-dev \
  --secret-string "$MQ_ENDPOINT"

# 5. Obter DB endpoint
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name nfe-database-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' \
  --output text)

# 6. Criar secret: Connection String Estoque
aws secretsmanager create-secret \
  --name nfe/db/connstring-estoque-dev \
  --secret-string "Host=$DB_ENDPOINT;Port=5432;Database=nfe_db;Username=$MQ_USERNAME;Password=$MQ_PASSWORD;SSL Mode=Require;Search Path=estoque"
```

## 🐳 Build e Push Docker Images para ECR

```bash
# 1. Login no ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# 2. Build e Push Faturamento (Go)
cd ../../servico-faturamento
docker build --platform linux/arm64 -t nfe-faturamento:latest .
docker tag nfe-faturamento:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/nfe-faturamento-dev:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/nfe-faturamento-dev:latest

# 3. Build e Push Estoque (.NET)
cd ../servico-estoque
docker build --platform linux/arm64 -t nfe-estoque:latest .
docker tag nfe-estoque:latest ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/nfe-estoque-dev:latest
docker push ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/nfe-estoque-dev:latest

# 4. Forçar novo deployment ECS
aws ecs update-service --cluster nfe-cluster-dev --service nfe-faturamento-dev --force-new-deployment
aws ecs update-service --cluster nfe-cluster-dev --service nfe-estoque-dev --force-new-deployment
```

## 🌐 Deploy Frontend (Angular)

```bash
# 1. Build Angular
cd ../../web-app
npm run build

# 2. Obter nome do bucket S3
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`BucketName`].OutputValue' \
  --output text)

# 3. Sync para S3
aws s3 sync ./dist/web-app s3://$BUCKET_NAME/ --delete

# 4. Invalidar cache CloudFront
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

## 🧪 Testar Deploy

```bash
# 1. Obter URL do ALB
ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name nfe-loadbalancer-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
  --output text)

# 2. Health checks
curl http://$ALB_URL/api/faturamento/health | jq .
curl http://$ALB_URL/api/estoque/health | jq .

# 3. Frontend (CloudFront)
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-dev \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
  --output text)

curl -I $CLOUDFRONT_URL
```

## 🗑️ Destroy (Limpar Recursos)

### Opção A: Via Script (Recomendado)

```bash
cd ../scripts
chmod +x destroy.sh
./destroy.sh
```

### Opção B: Via CDK CLI

```bash
# Destroy dev
npm run destroy:dev

# Destroy prod (requer confirmações)
npm run destroy:prod
```

## 📝 Comandos Úteis CDK

```bash
# Listar stacks
cdk list --context environment=dev

# Diff (preview changes)
npm run diff:dev

# Watch mode (rebuild automático)
npm run watch

# Synth stack específica
cdk synth NfeNetworkStack-dev --context environment=dev

# Deploy stack específica
cdk deploy NfeNetworkStack-dev --context environment=dev

# Destroy stack específica
cdk destroy NfeNetworkStack-dev --context environment=dev
```

## 🔍 Monitoramento

### CloudWatch Logs

```bash
# Logs Faturamento (Go)
aws logs tail /ecs/nfe-faturamento-dev --follow --format short

# Logs Estoque (.NET)
aws logs tail /ecs/nfe-estoque-dev --follow --format short

# Filtrar erros
aws logs filter-log-events \
  --log-group-name /ecs/nfe-faturamento-dev \
  --filter-pattern "ERROR"
```

### CloudWatch Alarms

Alarms configurados automaticamente (prod):

- ALB 5xx errors > 2/5min
- ALB latency > 500ms
- Unhealthy target count >= 1
- (ECS alarms via auto-scaling)

### ECS Metrics

```bash
# Status do cluster
aws ecs describe-clusters --clusters nfe-cluster-dev

# Status dos serviços
aws ecs describe-services \
  --cluster nfe-cluster-dev \
  --services nfe-faturamento-dev nfe-estoque-dev

# Tasks em execução
aws ecs list-tasks --cluster nfe-cluster-dev --service-name nfe-faturamento-dev
```

## 🛠️ Troubleshooting

### Problema: ECS tasks não iniciam

```bash
# Verificar task definition
aws ecs describe-task-definition --task-definition nfe-faturamento-dev

# Verificar eventos do serviço
aws ecs describe-services \
  --cluster nfe-cluster-dev \
  --services nfe-faturamento-dev \
  | jq '.services[0].events[:5]'

# Verificar logs da task
TASK_ARN=$(aws ecs list-tasks --cluster nfe-cluster-dev --service-name nfe-faturamento-dev --query 'taskArns[0]' --output text)
aws ecs describe-tasks --cluster nfe-cluster-dev --tasks $TASK_ARN
```

### Problema: Health check falha

```bash
# Testar health endpoint diretamente da task
TASK_IP=$(aws ecs describe-tasks \
  --cluster nfe-cluster-dev \
  --tasks $TASK_ARN \
  --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value' \
  --output text)

# Via Session Manager (se habilitado)
aws ecs execute-command \
  --cluster nfe-cluster-dev \
  --task $TASK_ARN \
  --container faturamento \
  --interactive \
  --command "/bin/sh"
```

### Problema: RDS não acessível

```bash
# Verificar security group
aws ec2 describe-security-groups --group-ids sg-xxxxx

# Testar conectividade (via Lambda ou EC2 na mesma VPC)
# Ver: docs/troubleshooting.md
```

## 📚 Recursos Adicionais

- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [ECS Best Practices](https://docs.aws.amazon.com/AmazonECS/latest/bestpracticesguide/)
- [RDS PostgreSQL](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/)
- [Amazon MQ RabbitMQ](https://docs.aws.amazon.com/amazon-mq/latest/developer-guide/)

## 🤝 Suporte

Para issues, abrir ticket no GitHub ou contatar equipe DevOps.

---

**Status**: ✅ Pronto para deploy
**Última atualização**: 2026-01-11
