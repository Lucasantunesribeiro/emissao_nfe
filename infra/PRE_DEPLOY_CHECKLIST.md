# Pre-Deploy Checklist - NFe AWS Infrastructure

Checklist completo antes de executar deploy em produção.

## ✅ Pré-requisitos Técnicos

### Software Local

- [ ] **Node.js 22+** instalado
  ```bash
  node --version  # deve retornar >= 22.0.0
  ```

- [ ] **AWS CLI v2** instalado
  ```bash
  aws --version  # deve retornar >= 2.0.0
  ```

- [ ] **AWS CDK CLI** instalado globalmente
  ```bash
  cdk --version  # deve retornar >= 2.175.0
  npm install -g aws-cdk
  ```

- [ ] **Docker** instalado (para build de imagens)
  ```bash
  docker --version
  docker compose version
  ```

- [ ] **Git** configurado
  ```bash
  git --version
  ```

---

## 🔑 Credenciais e Permissões AWS

### Configuração Básica

- [ ] **AWS credentials** configuradas
  ```bash
  aws configure
  # OU usar AWS SSO:
  aws sso login --profile nfe-prod
  ```

- [ ] **Verificar identidade**
  ```bash
  aws sts get-caller-identity
  # Anotar: Account ID, Region, User/Role ARN
  ```

- [ ] **Verificar região padrão**
  ```bash
  aws configure get region  # deve retornar us-east-1
  ```

### Permissões IAM Necessárias

- [ ] **AdministratorAccess** (recomendado para setup inicial)
  - OU políticas granulares:
    - `AWSCloudFormationFullAccess`
    - `IAMFullAccess`
    - `AmazonEC2FullAccess`
    - `AmazonECSFullAccess`
    - `AmazonRDSFullAccess`
    - `AmazonMQFullAccess`
    - `AmazonS3FullAccess`
    - `CloudFrontFullAccess`
    - `AWSSecretsManagerFullAccess`
    - `CloudWatchFullAccess`

- [ ] **Service Quotas** verificadas
  ```bash
  # VPCs (limit: 5 default)
  aws service-quotas get-service-quota \
    --service-code vpc \
    --quota-code L-F678F1CE

  # NAT Gateways (limit: 5/AZ default)
  aws ec2 describe-nat-gateways --region us-east-1 | jq '.NatGateways | length'

  # Elastic IPs (limit: 5 default)
  aws ec2 describe-addresses --region us-east-1 | jq '.Addresses | length'
  ```

---

## 🏗️ Infraestrutura Base

### CDK Bootstrap

- [ ] **Bootstrap CDK** na região us-east-1
  ```bash
  cdk bootstrap aws://ACCOUNT-ID/us-east-1
  ```

- [ ] **Verificar stack CDKToolkit**
  ```bash
  aws cloudformation describe-stacks \
    --stack-name CDKToolkit \
    --region us-east-1
  ```

### Validação do Código

- [ ] **Build TypeScript sem erros**
  ```bash
  cd infra/cdk
  npm install
  npm run build
  ```

- [ ] **CDK Synth dev funcionando**
  ```bash
  npm run synth:dev
  ls -la cdk.out/  # verificar templates gerados
  ```

- [ ] **CDK Synth prod funcionando**
  ```bash
  npm run synth:prod
  ```

---

## 🐳 Docker Images

### Validação Local

- [ ] **Build Faturamento (Go)** sem erros
  ```bash
  cd servico-faturamento
  docker build --platform linux/arm64 -t nfe-faturamento:test .
  docker run --rm -p 8080:8080 nfe-faturamento:test
  curl http://localhost:8080/health
  ```

- [ ] **Build Estoque (.NET)** sem erros
  ```bash
  cd servico-estoque
  docker build --platform linux/arm64 -t nfe-estoque:test .
  docker run --rm -p 5000:5000 nfe-estoque:test
  curl http://localhost:5000/health
  ```

- [ ] **Build Frontend (Angular)** sem erros
  ```bash
  cd web-app
  npm install
  npm run build
  ls -la dist/web-app/  # verificar arquivos gerados
  ```

---

## 💰 Budget e Custos

### Configuração de Alertas

- [ ] **Budget configurado** (Dev: $200, Prod: $600)
  ```bash
  aws budgets create-budget \
    --account-id ACCOUNT-ID \
    --budget file://budget-dev.json

  aws budgets create-budget \
    --account-id ACCOUNT-ID \
    --budget file://budget-prod.json
  ```

- [ ] **Billing Alerts** habilitados no console
  - CloudWatch > Billing > Preferences > Receive Billing Alerts: ON

- [ ] **Cost Explorer** habilitado
  - AWS Console > Billing > Cost Explorer > Enable

### Estimativa Revisada

- [ ] **Revisar estimativas** em `infra/COST_ESTIMATE.md`
- [ ] **Aprovação financeira** obtida (se prod)
- [ ] **Plano de otimização** definido (Savings Plans após 3 meses)

---

## 🔐 Segurança

### Secrets e Variáveis

- [ ] **Secrets Manager** preparado
  - Após deploy, criar:
    - `nfe/mq/url-{env}`
    - `nfe/mq/host-{env}`
    - `nfe/db/connstring-estoque-{env}`

- [ ] **Variáveis de ambiente** revisadas
  - Ver: `AWS_DEPLOY_ENV_VARS.md`
  - Confirmar schema isolation (faturamento/estoque)

### Compliance

- [ ] **Encryption at rest** habilitado (default nos stacks)
  - RDS: ✅
  - S3: ✅
  - Secrets Manager: ✅

- [ ] **TLS/SSL** configurado
  - RDS: `sslmode=require` ✅
  - RabbitMQ: AMQPS porta 5671 ✅
  - ALB: HTTPS (certificado ACM opcional)

- [ ] **Security Groups** revisados
  - Least privilege ✅
  - No inbound 0.0.0.0/0 nas subnets privadas ✅

---

## 🗄️ Database

### Pós-Deploy Manual

- [ ] **SQL script** preparado: `infra/scripts/create-schemas.sql`
- [ ] **Plano de execução** definido:
  - Opção A: psql via bastion/Lambda
  - Opção B: RDS Query Editor
  - Opção C: AWS Systems Manager Session Manager

- [ ] **Migration strategy** definida
  - EF Core migrations (.NET) configuradas
  - GORM migrations (Go) configuradas

---

## 🌐 Networking

### Validações

- [ ] **VPC CIDR** não conflita com VPNs/redes existentes
  - Dev: 10.0.0.0/16
  - Prod: 10.1.0.0/16

- [ ] **NAT Gateway costs** revisados
  - Dev: 1 NAT = $35/mês
  - Prod: 2 NATs = $75/mês

- [ ] **VPC Flow Logs** habilitados (prod apenas)

---

## 📊 Monitoramento

### CloudWatch

- [ ] **Log retention** configurado
  - Dev: 1 semana
  - Prod: 1 mês (ou mais)

- [ ] **Alarms** revisados (prod)
  - ALB 5xx errors
  - ALB latency
  - Unhealthy targets
  - (Opcional: CPU/Memory ECS)

### Observability

- [ ] **Plano de logging** definido
  - Structured JSON logs ✅
  - Correlation IDs (implementar se necessário)

- [ ] **Metrics collection** confirmado
  - ECS Container Insights (prod)
  - RDS Performance Insights (prod)

---

## 🚀 CI/CD

### GitHub Actions

- [ ] **Secrets configurados** no GitHub:
  - `AWS_ROLE_ARN_DEV` (OIDC role para deploy dev)
  - `AWS_ROLE_ARN_PROD` (OIDC role para deploy prod)

- [ ] **OIDC Provider** configurado na AWS
  ```bash
  # Ver: docs/github-actions-oidc-setup.md
  ```

- [ ] **Workflows testados** (CI apenas):
  ```bash
  git checkout -b test-ci
  git commit --allow-empty -m "test: CI validation"
  git push origin test-ci
  # Criar PR e verificar CI passing
  ```

---

## 📋 Rollback Plan

### Preparação

- [ ] **Backup strategy** definida
  - RDS: automated backups habilitados ✅
  - Retention: 3 dias (dev), 7 dias (prod) ✅

- [ ] **Rollback commands** documentados
  ```bash
  # Rollback ECS task definition
  aws ecs update-service \
    --cluster nfe-cluster-prod \
    --service nfe-faturamento-prod \
    --task-definition nfe-faturamento-prod:PREVIOUS_REVISION

  # Destroy stack específica
  cdk destroy NfeComputeStack-prod
  ```

- [ ] **Downtime window** agendado (se prod)
  - Comunicação com stakeholders
  - Maintenance page (opcional)

---

## 🧪 Testing Plan

### Pós-Deploy Imediato

- [ ] **Health checks** automatizados
  ```bash
  # Ver: scripts/health-check.sh
  curl http://ALB_DNS/api/faturamento/health
  curl http://ALB_DNS/api/estoque/health
  ```

- [ ] **Smoke tests** definidos
  - Criar pedido via API
  - Verificar evento RabbitMQ
  - Confirmar atualização estoque

### Load Testing (Opcional - Prod)

- [ ] **Ferramentas** preparadas:
  - Apache Bench / wrk / Locust
  - Script: `tests/load-test.sh`

- [ ] **Baselines** definidos:
  - Target: < 100ms P95 latency
  - Target: 100 req/s sustained

---

## 📞 Comunicação

### Stakeholders

- [ ] **Plano de comunicação** preparado
  - Email: início do deploy
  - Slack/Teams: status updates
  - Email: conclusão + URLs

- [ ] **Documentação** atualizada
  - README.md
  - API docs (Swagger/OpenAPI)
  - Runbook operacional

### Suporte

- [ ] **On-call** definido (se prod)
- [ ] **Escalation path** documentado
- [ ] **Troubleshooting guide** revisado

---

## ✅ Go/No-Go Decision

### Dev Deploy

**Pré-requisitos mínimos**:
- [x] AWS credentials configuradas
- [x] CDK bootstrap completo
- [x] Docker images buildando
- [x] Budget configurado ($200)

**Go for Dev Deploy?** □ YES □ NO

### Prod Deploy

**Pré-requisitos mínimos**:
- [x] Todos pré-requisitos Dev ✅
- [x] Deploy Dev testado e estável
- [x] Aprovação financeira ($600/mês)
- [x] Certificado ACM configurado (opcional)
- [x] Plano de rollback documentado
- [x] Stakeholders comunicados

**Go for Prod Deploy?** □ YES □ NO

---

## 📝 Notas Finais

### Comandos de Emergência

```bash
# Pausar serviço ECS (sem deletar)
aws ecs update-service \
  --cluster nfe-cluster-prod \
  --service nfe-faturamento-prod \
  --desired-count 0

# Reativar
aws ecs update-service \
  --cluster nfe-cluster-prod \
  --service nfe-faturamento-prod \
  --desired-count 2

# Destruir tudo (DANGER)
cd infra/scripts
./destroy.sh
```

### Contatos

- **AWS Support**: https://console.aws.amazon.com/support/
- **DevOps Lead**: [email]
- **Tech Lead**: [email]
- **Escalation**: [Slack channel]

---

**Checklist completo?** □ YES □ NO

**Deploy aprovado por**: ___________________________

**Data/Hora**: ___________________________

**Assinatura**: ___________________________
