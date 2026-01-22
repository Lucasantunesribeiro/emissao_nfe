# Classificação de Recursos - Migração AWS

**Data:** 2026-01-19
**Conta Origem:** aws-old (212051644015)
**Conta Destino:** aws-new (a configurar)
**Região:** us-east-1

---

## 📊 RESUMO DA CLASSIFICAÇÃO

| Categoria | Quantidade | Ação |
|-----------|------------|------|
| **MIGRAR** | 37 recursos | Recriar/copiar para aws-new |
| **PAUSAR** | 0 recursos | - |
| **DECOMISSIONAR** | 31 recursos | Deletar após migração bem-sucedida |
| **MANTER** | 1 recurso | EC2 EmailTriageAI (não migrar) |

---

## ✅ MIGRAR (Essenciais para o Sistema NFe)

### 🗄️ Database (1 recurso)

| Recurso | ID/Nome | Método de Migração | Downtime | Validação |
|---------|---------|-------------------|----------|-----------|
| RDS PostgreSQL | `nfe-db-dev` | Snapshot → Compartilhar → Restaurar | ~30-60 min | Row counts, checksums, test queries |

**Passos:**
1. Criar snapshot final do RDS
2. Compartilhar snapshot com conta aws-new
3. Copiar snapshot na aws-new (se necessário mudar região)
4. Restaurar RDS na aws-new
5. Validar dados (schemas faturamento + estoque)

**Criticidade:** 🔴 CRÍTICO - contém todos os dados do sistema

---

### 🖥️ Compute - Lambda Functions (3 recursos)

| Recurso | Nome | Tamanho | Método | Configurações a Atualizar |
|---------|------|---------|--------|---------------------------|
| Lambda | `nfe-estoque-dev` | 53.5 MB | Redeploy via CDK | DB endpoint, SQS URLs, EventBridge name |
| Lambda | `nfe-faturamento-dev` | 5 MB | Redeploy via CDK | DB endpoint, SQS URLs, EventBridge name, CORS origin |
| Lambda | `nfe-outbox-processor-dev` | 4.5 MB | Redeploy via CDK | DB endpoint, EventBridge name |

**Método:**
- Usar CDK para deploy na aws-new
- Código fonte já está local em `/mnt/d/Programacao/Emissao_NFE/`
- Ajustar variáveis de ambiente com novos endpoints

**Criticidade:** 🔴 CRÍTICO - core business logic

---

### 🌐 API Gateway (2 recursos)

| Recurso | ID Atual | Endpoints | Método |
|---------|----------|-----------|--------|
| ApiEstoque | `q99vlf2ppd` | /api/v1/produtos, /health | Redeploy via CDK |
| ApiFaturamento | `r9d99rnsz6` | /api/v1/notas, /health, /impressao | Redeploy via CDK |

**Método:**
- Recriar via CDK na aws-new
- Novos IDs serão gerados
- Atualizar URLs no frontend (se hardcoded)

**Criticidade:** 🔴 CRÍTICO - entrada principal do sistema

---

### 📨 Messaging - EventBridge (1 recurso + 5 rules)

| Recurso | Nome | Método |
|---------|------|--------|
| Event Bus | `nfe-events-dev` | Recriar via CDK |
| Archive | `nfe-archive-dev` | Recriar vazio (histórico não migrado) |
| Rules | 5 rules (nota-criada, reserva-confirmada, etc.) | Recriar via CDK |

**Método:**
- Recriar via CDK
- Archive pode ser criado vazio (eventos antigos ficam no archive da aws-old)

**Criticidade:** 🟡 IMPORTANTE - perder histórico não afeta funcionalidade

---

### 📨 Messaging - SQS (3 recursos)

| Recurso | Nome | Consumer | Método |
|---------|------|----------|--------|
| Queue | `nfe-estoque-reserva-dev` | Lambda Estoque | Recriar via CDK |
| Queue | `nfe-faturamento-confirmacao-dev` | Lambda Faturamento | Recriar via CDK |
| DLQ | `nfe-dlq-dev` | - | Recriar via CDK |

**Método:**
- Recriar via CDK
- **Antes do cutover:** drenar filas (processar todas mensagens pendentes)

**Criticidade:** 🟡 IMPORTANTE - mensagens in-flight serão perdidas se não drenar

---

### 🌍 Frontend - S3 + CloudFront (2 recursos)

| Recurso | Nome/ID | Conteúdo | Método |
|---------|---------|----------|--------|
| S3 Bucket | `nfe-frontend-dev-212051644015` | Angular app build | Recriar via CDK + sync objetos |
| CloudFront | `E2WP4QF7I5V84W` | Distribution | Recriar via CDK (novo domain) |

**Método:**
1. Recriar bucket e distribution via CDK na aws-new
2. Copiar objetos: `aws s3 sync s3://old-bucket s3://new-bucket`
3. Invalidar cache do novo CloudFront
4. Atualizar código frontend com novas URLs de API (se necessário)

**Domain atual:** `d3065hze06690c.cloudfront.net`
**Domain novo:** `<novo-id>.cloudfront.net` (será gerado após deploy)

**Criticidade:** 🟡 IMPORTANTE - afeta usuários finais diretamente

---

### 🔒 Security & IAM (4 recursos)

| Recurso | Nome/Tipo | Método |
|---------|-----------|--------|
| IAM Role | LambdaExecutionRole | Recriar via CDK |
| IAM Role | ApiEstoqueCloudWatchRole | Recriar via CDK |
| IAM Role | ApiFaturamentoCloudWatchRole | Recriar via CDK |
| IAM Policy | LambdaExecutionRoleDefaultPolicy | Recriar via CDK |

**Método:**
- CDK recria automaticamente todas as roles e policies

**Criticidade:** 🔴 CRÍTICO - sem roles, Lambda não funciona

---

### 🌐 Network (3 recursos principais)

| Recurso | ID Atual | CIDR/Config | Método |
|---------|----------|-------------|--------|
| VPC | `vpc-0b5efd8a245fea948` | 10.0.0.0/16, 2 AZs | Recriar via CDK |
| Subnets | 2 public subnets | us-east-1a, us-east-1b | Recriar via CDK |
| Security Groups | 2 SGs | Lambda + RDS | Recriar via CDK |

**Método:**
- CDK recria VPC completa com mesma configuração
- Novos IDs serão gerados

**Criticidade:** 🔴 CRÍTICO - Lambda e RDS dependem da VPC

---

### 🔐 Secrets (1 recurso)

| Recurso | Tipo | Conteúdo | Método |
|---------|------|----------|--------|
| Secrets Manager | Secret | DB credentials | Recriar via CDK com novos valores |

**Método:**
1. CDK cria novo secret na aws-new
2. Atualizar com credenciais do novo RDS

**Criticidade:** 🔴 CRÍTICO - Lambda precisa das credenciais

---

### 📊 Observability (4 recursos)

| Recurso | Nome | Método |
|---------|------|--------|
| CloudWatch Log Group | `/aws/lambda/nfe-estoque-dev` | Recriar via CDK (vazio) |
| CloudWatch Log Group | `/aws/lambda/nfe-faturamento-dev` | Recriar via CDK (vazio) |
| CloudWatch Log Group | `/aws/lambda/nfe-outbox-processor-dev` | Recriar via CDK (vazio) |
| CloudWatch Log Group | `/aws/events/nfe-dev` | Recriar via CDK (vazio) |

**Método:**
- CDK recria automaticamente
- Logs antigos ficam na aws-old (exportar se necessário)

**Criticidade:** 🟢 BAIXO - logs históricos não são críticos

---

## 🗑️ DECOMISSIONAR (Deletar após migração bem-sucedida)

### CloudFormation Stacks (7 stacks)

| Stack | Ação | Quando |
|-------|------|--------|
| `nfe-compute-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `nfe-database-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `nfe-frontend-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `nfe-messaging-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `nfe-network-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `nfe-secrets-serverless-dev` | ❌ Deletar | Após 30 dias de estabilidade |
| `CDKToolkit` | ⚠️ Manter temporariamente | Pode ser útil para rollback |

**Método:**
```bash
aws cloudformation delete-stack --stack-name <stack-name> --region us-east-1
```

**Ordem de deleção (inversa da criação):**
1. nfe-frontend-serverless-dev
2. nfe-compute-serverless-dev
3. nfe-database-serverless-dev (⚠️ cuidado: RDS)
4. nfe-messaging-serverless-dev
5. nfe-network-serverless-dev
6. nfe-secrets-serverless-dev

---

### S3 Buckets (2 buckets)

| Bucket | Tamanho Estimado | Ação | Quando |
|--------|------------------|------|--------|
| `nfe-frontend-dev-212051644015` | <100 MB | ❌ Esvaziar e deletar | Após 30 dias |
| `cdk-hnb659fds-assets-212051644015-us-east-1` | <500 MB | ⚠️ Avaliar | Pode ter assets úteis |

**Método:**
```bash
aws s3 rb s3://nfe-frontend-dev-212051644015 --force
```

---

### Lambda Functions (7 functions totais)

Todas as 7 functions serão automaticamente deletadas ao deletar as stacks CloudFormation.

**Ação:** Nenhuma ação manual necessária (deletadas com a stack)

---

### RDS Database (1 instância)

| Recurso | Nome | Ação | Quando | Backup |
|---------|------|------|--------|--------|
| RDS | `nfe-db-dev` | ❌ Deletar | Após 30 dias de estabilidade | ✅ Manter snapshot final |

**Método:**
```bash
# 1. Criar snapshot final
aws rds create-db-snapshot \
  --db-instance-identifier nfe-db-dev \
  --db-snapshot-identifier nfe-db-dev-final-snapshot-before-delete

# 2. Deletar RDS (após confirmação de que aws-new está OK)
aws rds delete-db-instance \
  --db-instance-identifier nfe-db-dev \
  --final-db-snapshot-identifier nfe-db-dev-final-20260119 \
  --skip-final-snapshot  # OU manter final snapshot
```

**⚠️ ATENÇÃO:**
- Manter snapshot final por pelo menos 30 dias
- Custo do snapshot: ~$0.10/GB/mês × 20GB = ~$2/mês

---

### API Gateway (2 APIs)

| API | ID | Ação |
|-----|-----|------|
| ApiEstoque | `q99vlf2ppd` | ❌ Deletar via stack |
| ApiFaturamento | `r9d99rnsz6` | ❌ Deletar via stack |

**Ação:** Deletadas automaticamente ao deletar stack `nfe-compute-serverless-dev`

---

### SQS Queues (3 queues)

Todas deletadas automaticamente ao deletar stack `nfe-compute-serverless-dev`.

---

### EventBridge (1 bus + 5 rules + 1 archive)

Todos deletados automaticamente ao deletar stack `nfe-messaging-serverless-dev`.

---

### CloudFront Distribution (1 distribution)

| Distribution | ID | Ação | Quando |
|--------------|-----|------|--------|
| CloudFront | `E2WP4QF7I5V84W` | ❌ Desabilitar → Deletar | Após 30 dias |

**Método:**
1. Desabilitar distribution (aguardar propagação ~15 min)
2. Deletar distribution

**Ação:** Deletada automaticamente ao deletar stack `nfe-frontend-serverless-dev`

---

### IAM Roles e Policies (7+ recursos)

Todos deletados automaticamente ao deletar as stacks CloudFormation.

---

### VPC e Network (1 VPC + 2 subnets + 2 SGs + 1 route table + 1 IGW)

Todos deletados automaticamente ao deletar stack `nfe-network-serverless-dev`.

---

### Secrets Manager (1+ secrets)

Deletados automaticamente ao deletar stack `nfe-secrets-serverless-dev`.

⚠️ Secrets Manager tem "recovery window" padrão de 30 dias (não deleta imediatamente).

---

### CloudWatch Log Groups (8+ log groups)

| Log Group | Ação | Quando |
|-----------|------|--------|
| Logs das Lambdas (4) | ❌ Deletar | Após 30 dias |
| Logs de eventos | ❌ Deletar | Após 30 dias |
| Logs de custom resources | ❌ Deletar | Após 30 dias |

**Método:**
- Deletados automaticamente ao deletar stacks
- Ou manter por período maior se logs forem úteis para auditoria

---

## ⏸️ PAUSAR (Temporariamente desligar)

**Nenhum recurso identificado nesta categoria.**

Durante a migração, não vamos pausar recursos, vamos fazer cutover direto.

---

## 🔒 MANTER (Não migrar)

### EC2 Instance - EmailTriageAI

| Recurso | ID | Tipo | Estado | Ação |
|---------|-----|------|--------|------|
| EC2 | `i-01052b975ba194c38` | t3.micro | Running | ✅ **MANTER** na aws-old |

**Justificativa:**
- Não faz parte do sistema NFe
- Workload separado (EmailTriageAI)
- Não tem dependências com o sistema NFe

**Ação:** Nenhuma. Deixar rodando na conta aws-old.

**Custo:** ~$7-8/mês (t3.micro)

---

## 📊 IMPACTO NO CUSTO

### Antes da Migração (aws-old):

| Categoria | Custo Mensal |
|-----------|--------------|
| Sistema NFe | ~$24-29 |
| EmailTriageAI EC2 | ~$7-8 |
| **TOTAL** | **~$31-37** |

### Após Migração:

| Conta | Recursos | Custo Mensal |
|-------|----------|--------------|
| **aws-new** | Sistema NFe completo | ~$24-29 |
| **aws-old** | EmailTriageAI EC2 | ~$7-8 |
| **TOTAL** | | **~$31-37** |

### Após Decomissionamento (30 dias depois):

| Conta | Recursos | Custo Mensal |
|-------|----------|--------------|
| **aws-new** | Sistema NFe completo | ~$24-29 |
| **aws-old** | EmailTriageAI EC2 + Snapshots | ~$9-10 |
| **TOTAL** | | **~$33-39** |

**💡 Para ZERAR custo na aws-old:**
- Parar/terminar EC2 EmailTriageAI: -$7-8/mês
- Deletar snapshots após 30 dias: -$2/mês
- **Resultado:** aws-old = $0/mês

---

## 🎯 PRÓXIMA FASE: Plano de Migração Detalhado

Agora que temos a classificação completa, vamos criar o **PLANO DE MIGRAÇÃO** (FASE 2) com:

1. ✅ Etapas numeradas com comandos exatos
2. ✅ Riscos e rollback para cada etapa
3. ✅ Validações obrigatórias
4. ✅ Janela de downtime estimada
5. ✅ Critérios de sucesso
