# Plano de Migração - Sistema NFe
## aws-old (212051644015) → aws-new (194722406583)

**Data:** 2026-01-19
**Região:** us-east-1
**Downtime Estimado:** 45-90 minutos
**Estratégia:** Blue/Green com cutover via frontend

---

## 🎯 RESUMO EXECUTIVO

**Objetivo:** Migrar o Sistema NFe Serverless da conta antiga para a nova com downtime mínimo e rollback garantido.

**Riscos Principais:**
- 🔴 Perda de dados (mitigado com snapshots)
- 🟡 Downtime maior que o esperado (mitigado com rollback rápido)
- 🟡 Mensagens SQS in-flight perdidas (mitigado drenando filas)

**Critérios de Sucesso:**
- ✅ RDS restaurado com todos os dados (checksums validados)
- ✅ Lambdas funcionando e respondendo a requests
- ✅ Frontend acessível via novo CloudFront
- ✅ API Gateway respondendo com latência < 500ms
- ✅ Zero erros em 100 chamadas de teste

---

## 📋 PRÉ-REQUISITOS

### Validações Obrigatórias:

```bash
# 1. Confirmar credenciais das duas contas
aws sts get-caller-identity --profile aws-old
# Esperado: Account 212051644015

aws sts get-caller-identity --profile aws-new
# Esperado: Account 194722406583

# 2. Confirmar CDK instalado e bootstrapped
cd /mnt/d/Programacao/Emissao_NFE/infra/cdk
npm install
npx cdk --version
# Esperado: >= 2.x

# 3. Confirmar código compilado
cd /mnt/d/Programacao/Emissao_NFE
# Verificar zips das Lambdas existem:
ls -lh servico-estoque/lambda-estoque.zip
ls -lh servico-faturamento/lambda-faturamento.zip
ls -lh servico-faturamento/lambda-outbox.zip
```

### Ferramentas Necessárias:

- ✅ AWS CLI v2
- ✅ Node.js 22+
- ✅ AWS CDK v2
- ✅ jq (para parsing JSON)

---

## 🔄 ESTRATÉGIA DE ROLLBACK

**Rollback Rápido (se algo der errado):**

1. Se falhar **ANTES** do cutover:
   - ❌ Cancelar migração
   - ✅ Sistema continua rodando na aws-old
   - ✅ Deletar recursos na aws-new
   - ✅ **Tempo de rollback: 0 minutos** (nada mudou para o usuário)

2. Se falhar **DEPOIS** do cutover:
   - ❌ Reverter DNS/CloudFront para aws-old
   - ✅ Frontend volta a apontar para APIs antigas
   - ✅ **Tempo de rollback: 5-10 minutos** (invalidação CloudFront)

3. Se perder dados:
   - ✅ Restaurar RDS a partir do snapshot da aws-old
   - ✅ **Tempo de recuperação: 30-60 minutos**

---

## 📊 FASES DA MIGRAÇÃO

```
FASE PRÉ-MIGRAÇÃO (15 min)
  └─> Backups + Snapshots
        └─> FASE PREPARAÇÃO (30 min)
              └─> Bootstrap aws-new + Deploy infra base
                    └─> FASE MIGRAÇÃO DB (45 min)
                          └─> Snapshot → Compartilhar → Restaurar
                                └─> FASE DEPLOY SERVIÇOS (20 min)
                                      └─> CDK deploy Lambdas + APIs
                                            └─> FASE CUTOVER (10 min) ⚠️ DOWNTIME
                                                  └─> Atualizar frontend URLs
                                                        └─> FASE VALIDAÇÃO (15 min)
                                                              └─> Smoke tests + Monitoramento
                                                                    └─> FASE PÓS-MIGRAÇÃO (30 dias)
                                                                          └─> Decomissionamento gradual
```

**TOTAL:** ~2h 15min (downtime efetivo: 10-15 min durante cutover)

---

# 🚀 EXECUÇÃO PASSO A PASSO

---

## FASE 1: PRÉ-MIGRAÇÃO (Backups e Snapshots)

**Objetivo:** Garantir que temos backups completos antes de qualquer mudança.

**Downtime:** ❌ Não (sistema continua rodando)

### 1.1 - Criar Snapshot do RDS

**Comando:**
```bash
aws rds create-db-snapshot \
  --db-instance-identifier nfe-db-dev \
  --db-snapshot-identifier nfe-db-dev-migration-$(date +%Y%m%d-%H%M%S) \
  --profile aws-old \
  --region us-east-1
```

**Validação:**
```bash
# Aguardar snapshot ficar "available" (5-10 min)
aws rds describe-db-snapshots \
  --db-snapshot-identifier nfe-db-dev-migration-* \
  --profile aws-old \
  --region us-east-1 \
  --query 'DBSnapshots[0].[Status,SnapshotCreateTime,AllocatedStorage]'
# Esperado: ["available", "2026-01-19T...", 20]
```

**Rollback:** N/A (apenas criamos backup)

**Risco:** 🟢 Baixo - operação não destrutiva

---

### 1.2 - Exportar Configurações Críticas

**Comando:**
```bash
# Exportar variáveis de ambiente das Lambdas
aws lambda get-function-configuration \
  --function-name nfe-estoque-dev \
  --profile aws-old \
  --region us-east-1 > /tmp/lambda-estoque-config.json

aws lambda get-function-configuration \
  --function-name nfe-faturamento-dev \
  --profile aws-old \
  --region us-east-1 > /tmp/lambda-faturamento-config.json

aws lambda get-function-configuration \
  --function-name nfe-outbox-processor-dev \
  --profile aws-old \
  --region us-east-1 > /tmp/lambda-outbox-config.json

# Exportar endpoint do CloudFront atual
aws cloudformation describe-stacks \
  --stack-name nfe-frontend-serverless-dev \
  --profile aws-old \
  --region us-east-1 \
  --query 'Stacks[0].Outputs' > /tmp/cloudfront-outputs.json
```

**Validação:**
```bash
ls -lh /tmp/lambda-*.json /tmp/cloudfront-*.json
# Esperado: 4 arquivos JSON criados
```

**Rollback:** N/A

**Risco:** 🟢 Baixo

---

### 1.3 - Drenar Filas SQS (Evitar Perda de Mensagens)

**Comando:**
```bash
# 1. Verificar quantas mensagens há nas filas
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/212051644015/nfe-estoque-reserva-dev \
  --attribute-names ApproximateNumberOfMessages \
  --profile aws-old \
  --region us-east-1

aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/212051644015/nfe-faturamento-confirmacao-dev \
  --attribute-names ApproximateNumberOfMessages \
  --profile aws-old \
  --region us-east-1

# 2. Se houver mensagens, aguardar Lambdas processarem
# OU pausar envio de novas mensagens temporariamente
```

**Validação:**
```bash
# Confirmar filas vazias
# ApproximateNumberOfMessages deve ser "0"
```

**Rollback:** N/A

**Risco:** 🟡 Médio - mensagens in-flight serão perdidas se não drenar

---

### 1.4 - Backup do Código Frontend (S3)

**Comando:**
```bash
# Fazer backup local do frontend atual
mkdir -p /tmp/frontend-backup
aws s3 sync s3://nfe-frontend-dev-212051644015 /tmp/frontend-backup/ \
  --profile aws-old \
  --region us-east-1
```

**Validação:**
```bash
ls -lh /tmp/frontend-backup/
# Esperado: arquivos do Angular (index.html, *.js, *.css, etc.)
```

**Rollback:** N/A

**Risco:** 🟢 Baixo

---

**✅ CHECKPOINT 1: PRÉ-MIGRAÇÃO COMPLETA**

Confirmações necessárias:
- ✅ Snapshot RDS criado e "available"
- ✅ Configurações exportadas
- ✅ Filas SQS drenadas
- ✅ Frontend backup local criado

**Digite "CONTINUE" para prosseguir ou "ROLLBACK" para cancelar.**

---

## FASE 2: PREPARAÇÃO (Bootstrap e Infraestrutura Base)

**Objetivo:** Preparar a conta aws-new com CDK e infraestrutura base.

**Downtime:** ❌ Não (aws-old continua rodando)

### 2.1 - Bootstrap CDK na aws-new

**Comando:**
```bash
cd /mnt/d/Programacao/Emissao_NFE/infra/cdk

# Bootstrap CDK na nova conta
npx cdk bootstrap aws://194722406583/us-east-1 \
  --profile aws-new \
  --region us-east-1
```

**Validação:**
```bash
# Verificar stack CDKToolkit criada
aws cloudformation describe-stacks \
  --stack-name CDKToolkit \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
# Esperado: "CREATE_COMPLETE"
```

**Rollback:**
```bash
# Deletar stack CDKToolkit se necessário
aws cloudformation delete-stack \
  --stack-name CDKToolkit \
  --profile aws-new \
  --region us-east-1
```

**Risco:** 🟢 Baixo

---

### 2.2 - Deploy Stack de Secrets

**Comando:**
```bash
cd /mnt/d/Programacao/Emissao_NFE/infra/cdk

npx cdk deploy nfe-secrets-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
aws cloudformation describe-stacks \
  --stack-name nfe-secrets-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].StackStatus'
# Esperado: "CREATE_COMPLETE"
```

**Rollback:**
```bash
npx cdk destroy nfe-secrets-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🟢 Baixo

---

### 2.3 - Deploy Stack de Network

**Comando:**
```bash
npx cdk deploy nfe-network-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
# Verificar VPC criada
aws ec2 describe-vpcs \
  --filters "Name=tag:Environment,Values=dev" \
  --profile aws-new \
  --region us-east-1 \
  --query 'Vpcs[0].[VpcId,CidrBlock,State]'
# Esperado: ["vpc-xxxxx", "10.0.0.0/16", "available"]
```

**Rollback:**
```bash
npx cdk destroy nfe-network-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🟢 Baixo

---

### 2.4 - Deploy Stack de Messaging

**Comando:**
```bash
npx cdk deploy nfe-messaging-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
# Verificar EventBridge Bus criado
aws events list-event-buses \
  --profile aws-new \
  --region us-east-1 \
  --query 'EventBuses[?Name==`nfe-events-dev`].[Name,Arn]'
# Esperado: [["nfe-events-dev", "arn:aws:events:..."]
```

**Rollback:**
```bash
npx cdk destroy nfe-messaging-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🟢 Baixo

---

**✅ CHECKPOINT 2: PREPARAÇÃO COMPLETA**

Confirmações necessárias:
- ✅ CDK bootstrapped na aws-new
- ✅ Stack Secrets criada
- ✅ Stack Network criada (VPC + Subnets + SGs)
- ✅ Stack Messaging criada (EventBridge + SQS)

**Digite "CONTINUE" para prosseguir ou "ROLLBACK" para cancelar.**

---

## FASE 3: MIGRAÇÃO DO BANCO DE DADOS (⚠️ OPERAÇÃO CRÍTICA)

**Objetivo:** Migrar RDS PostgreSQL via snapshot compartilhado.

**Downtime:** ❌ Ainda não (RDS antigo continua rodando)

### 3.1 - Compartilhar Snapshot com aws-new

**Comando:**
```bash
# Obter o nome do snapshot criado anteriormente
SNAPSHOT_ID=$(aws rds describe-db-snapshots \
  --db-instance-identifier nfe-db-dev \
  --profile aws-old \
  --region us-east-1 \
  --query 'DBSnapshots[0].DBSnapshotIdentifier' \
  --output text)

echo "Snapshot ID: $SNAPSHOT_ID"

# Compartilhar snapshot com a conta nova
aws rds modify-db-snapshot-attribute \
  --db-snapshot-identifier $SNAPSHOT_ID \
  --attribute-name restore \
  --values-to-add 194722406583 \
  --profile aws-old \
  --region us-east-1
```

**Validação:**
```bash
# Verificar permissões do snapshot
aws rds describe-db-snapshot-attributes \
  --db-snapshot-identifier $SNAPSHOT_ID \
  --profile aws-old \
  --region us-east-1 \
  --query 'DBSnapshotAttributesResult.DBSnapshotAttributes[?AttributeName==`restore`].AttributeValues'
# Esperado: [["194722406583"]]
```

**Rollback:**
```bash
# Remover permissão de compartilhamento
aws rds modify-db-snapshot-attribute \
  --db-snapshot-identifier $SNAPSHOT_ID \
  --attribute-name restore \
  --values-to-remove 194722406583 \
  --profile aws-old \
  --region us-east-1
```

**Risco:** 🟢 Baixo - operação reversível

---

### 3.2 - Deploy Stack Database (com Snapshot)

**ATENÇÃO:** Este passo requer edição temporária do código CDK.

**Preparação:**
```bash
cd /mnt/d/Programacao/Emissao_NFE/infra/cdk/lib/stacks
```

**Editar `database-stack-serverless.ts`:**

Procurar pela criação do RDS e adicionar parâmetro de snapshot:

```typescript
const dbInstance = new rds.DatabaseInstance(this, 'DbInstance', {
  // ... outras configs ...

  // ADICIONAR esta linha:
  snapshotIdentifier: 'arn:aws:rds:us-east-1:212051644015:snapshot:nfe-db-dev-migration-XXXXXX',

  // ... resto das configs ...
});
```

**Comando:**
```bash
# Compilar TypeScript
npm run build

# Deploy com snapshot
npx cdk deploy nfe-database-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
# Aguardar RDS ficar "available" (30-45 min) ⏱️
aws rds describe-db-instances \
  --db-instance-identifier nfe-db-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'DBInstances[0].[DBInstanceStatus,Endpoint.Address]'
# Esperado: ["available", "nfe-db-dev.xxxx.us-east-1.rds.amazonaws.com"]

# Validar dados (conectar ao banco e verificar row counts)
# IMPORTANTE: Anotar o NOVO endpoint do RDS
```

**Script de Validação de Dados:**
```bash
# Obter novo endpoint
NEW_DB_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier nfe-db-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "Novo RDS Endpoint: $NEW_DB_ENDPOINT"

# Conectar e validar (requer psql instalado)
PGPASSWORD='***REMOVIDO***' psql \
  -h $NEW_DB_ENDPOINT \
  -U nfeadmin \
  -d nfe_db \
  -c "SELECT
        (SELECT COUNT(*) FROM estoque.produtos) as produtos_count,
        (SELECT COUNT(*) FROM faturamento.notas_fiscais) as notas_count,
        (SELECT COUNT(*) FROM faturamento.outbox) as outbox_count;"
# Comparar com os counts do banco antigo
```

**Rollback:**
```bash
# ⚠️ DESTRUTIVO: Deletar RDS novo
npx cdk destroy nfe-database-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🔴 ALTO - restaurar RDS leva 30-45 min, validação é crítica

---

**✅ CHECKPOINT 3: MIGRAÇÃO DB COMPLETA**

Confirmações necessárias:
- ✅ RDS novo está "available"
- ✅ Dados validados (row counts batem)
- ✅ Endpoint anotado para atualizar Lambdas

**Endpoint novo:** `____________________________________`

**Digite "CONTINUE" para prosseguir ou "ROLLBACK" para cancelar.**

---

## FASE 4: DEPLOY DOS SERVIÇOS (Lambdas + API Gateway)

**Objetivo:** Deployar compute stack com Lambdas e APIs.

**Downtime:** ❌ Ainda não (usuários ainda usam aws-old)

### 4.1 - Atualizar Variáveis de Ambiente no Código CDK

**Arquivo:** `/mnt/d/Programacao/Emissao_NFE/infra/cdk/lib/stacks/compute-stack-serverless.ts`

**Atualizar:**
```typescript
// Substituir endpoint do RDS
const dbEndpoint = '<NOVO_ENDPOINT_ANOTADO_NO_CHECKPOINT_3>';

// Account ID novo (para SQS URLs)
const accountId = '194722406583';
```

**Comando:**
```bash
cd /mnt/d/Programacao/Emissao_NFE/infra/cdk
npm run build
```

---

### 4.2 - Deploy Stack Compute

**Comando:**
```bash
npx cdk deploy nfe-compute-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
# Verificar Lambdas criadas
aws lambda list-functions \
  --profile aws-new \
  --region us-east-1 \
  --query 'Functions[?starts_with(FunctionName, `nfe-`)].FunctionName'
# Esperado: ["nfe-estoque-dev", "nfe-faturamento-dev", "nfe-outbox-processor-dev"]

# Testar health check de cada Lambda
aws lambda invoke \
  --function-name nfe-estoque-dev \
  --payload '{"httpMethod":"GET","path":"/health"}' \
  --profile aws-new \
  --region us-east-1 \
  /tmp/estoque-health.json

cat /tmp/estoque-health.json | jq .
# Esperado: statusCode 200

# Obter URLs dos API Gateways
aws cloudformation describe-stacks \
  --stack-name nfe-compute-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].Outputs'
# Anotar as URLs das APIs
```

**Rollback:**
```bash
npx cdk destroy nfe-compute-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🟡 Médio

---

**✅ CHECKPOINT 4: SERVIÇOS DEPLOYADOS**

Confirmações necessárias:
- ✅ 3 Lambdas criadas e respondendo a health checks
- ✅ 2 API Gateways criados
- ✅ SQS Queues criadas
- ✅ URLs das APIs anotadas

**API Estoque URL:** `____________________________________`
**API Faturamento URL:** `____________________________________`

**Digite "CONTINUE" para prosseguir ou "ROLLBACK" para cancelar.**

---

## FASE 5: DEPLOY DO FRONTEND (CloudFront + S3)

**Objetivo:** Criar CloudFront e S3 bucket na aws-new.

**Downtime:** ❌ Ainda não

### 5.1 - Deploy Stack Frontend

**Comando:**
```bash
npx cdk deploy nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --require-approval never
```

**Validação:**
```bash
# Obter URL do CloudFront novo
aws cloudformation describe-stacks \
  --stack-name nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontURL`].OutputValue' \
  --output text
# Anotar o novo CloudFront domain
```

**Rollback:**
```bash
npx cdk destroy nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --force
```

**Risco:** 🟢 Baixo

---

### 5.2 - Atualizar Frontend com Novas URLs de API

**Arquivo:** `/mnt/d/Programacao/Emissao_NFE/web-app/src/environments/environment.prod.ts`

**Editar:**
```typescript
export const environment = {
  production: true,
  apiEstoqueUrl: '<API_ESTOQUE_URL_DO_CHECKPOINT_4>',
  apiFaturamentoUrl: '<API_FATURAMENTO_URL_DO_CHECKPOINT_4>',
};
```

**Comando:**
```bash
cd /mnt/d/Programacao/Emissao_NFE/web-app

# Build do Angular
npm run build:prod

# Upload para S3 novo
NEW_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`BucketName`].OutputValue' \
  --output text)

aws s3 sync dist/web-app/ s3://$NEW_BUCKET/ \
  --profile aws-new \
  --region us-east-1 \
  --delete
```

**Validação:**
```bash
# Listar objetos no bucket
aws s3 ls s3://$NEW_BUCKET/ --profile aws-new --region us-east-1
# Esperado: index.html, *.js, *.css, etc.

# Invalidar cache do CloudFront
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`DistributionId`].OutputValue' \
  --output text)

aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*" \
  --profile aws-new \
  --region us-east-1
```

**Rollback:**
```bash
# Restaurar frontend antigo do backup
aws s3 sync /tmp/frontend-backup/ s3://$NEW_BUCKET/ \
  --profile aws-new \
  --region us-east-1 \
  --delete
```

**Risco:** 🟡 Médio

---

**✅ CHECKPOINT 5: FRONTEND DEPLOYADO**

Confirmações necessárias:
- ✅ CloudFront distribution criada
- ✅ S3 bucket populado com novo frontend
- ✅ Frontend build com URLs corretas das APIs

**CloudFront URL novo:** `____________________________________`

**Digite "CONTINUE" para prosseguir para o CUTOVER (⚠️ DOWNTIME COMEÇA).**

---

## ⚠️ FASE 6: CUTOVER (INÍCIO DO DOWNTIME)

**Objetivo:** Redirecionar usuários para o novo CloudFront.

**Downtime:** ✅ SIM - **10-15 minutos estimados**

**ATENÇÃO:** A partir daqui, o sistema antigo será desligado temporariamente.

### 6.1 - Pausar Processamento na aws-old

**Comando:**
```bash
# Desabilitar event source mappings (SQS → Lambda)
aws lambda list-event-source-mappings \
  --function-name nfe-estoque-dev \
  --profile aws-old \
  --region us-east-1 \
  --query 'EventSourceMappings[0].UUID' \
  --output text | \
xargs -I {} aws lambda update-event-source-mapping \
  --uuid {} \
  --enabled false \
  --profile aws-old \
  --region us-east-1

aws lambda list-event-source-mappings \
  --function-name nfe-faturamento-dev \
  --profile aws-old \
  --region us-east-1 \
  --query 'EventSourceMappings[0].UUID' \
  --output text | \
xargs -I {} aws lambda update-event-source-mapping \
  --uuid {} \
  --enabled false \
  --profile aws-old \
  --region us-east-1
```

**Validação:**
```bash
# Verificar que event source mappings estão desabilitados
aws lambda list-event-source-mappings \
  --function-name nfe-estoque-dev \
  --profile aws-old \
  --region us-east-1 \
  --query 'EventSourceMappings[0].State'
# Esperado: "Disabled"
```

---

### 6.2 - Comunicar Downtime aos Usuários (Manual)

**Ação Manual:**
1. Exibir banner de manutenção no frontend antigo (se possível)
2. Enviar comunicação por email/slack para usuários
3. **Aguardar 5 minutos** para usuários terminarem operações em andamento

---

### 6.3 - Atualizar CORS nas Lambdas (aws-new)

**Comando:**
```bash
# Obter novo CloudFront domain
NEW_CLOUDFRONT=$(aws cloudformation describe-stacks \
  --stack-name nfe-frontend-serverless-dev \
  --profile aws-new \
  --region us-east-1 \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontURL`].OutputValue' \
  --output text)

echo "Novo CloudFront: $NEW_CLOUDFRONT"

# Atualizar variável CORS_ORIGINS nas Lambdas
aws lambda update-function-configuration \
  --function-name nfe-estoque-dev \
  --environment "Variables={CORS_ORIGINS=$NEW_CLOUDFRONT,...}" \
  --profile aws-new \
  --region us-east-1

# Repetir para as outras Lambdas...
```

---

### 6.4 - Smoke Tests no Ambiente Novo

**Comando:**
```bash
# Testar API Estoque
curl -X GET "$NEW_CLOUDFRONT/api/v1/produtos" \
  -H "Origin: $NEW_CLOUDFRONT"
# Esperado: HTTP 200, lista de produtos

# Testar API Faturamento
curl -X GET "$NEW_CLOUDFRONT/api/v1/notas" \
  -H "Origin: $NEW_CLOUDFRONT"
# Esperado: HTTP 200, lista de notas

# Testar criação de nota (write operation)
curl -X POST "$NEW_CLOUDFRONT/api/v1/notas" \
  -H "Content-Type: application/json" \
  -H "Origin: $NEW_CLOUDFRONT" \
  -d '{
    "numero": 999999,
    "serie": "1",
    "clienteId": 1,
    "valor": 100.00
  }'
# Esperado: HTTP 201, nota criada
```

**Validação:**
```bash
# Verificar logs das Lambdas
aws logs tail /aws/lambda/nfe-faturamento-dev \
  --since 5m \
  --profile aws-new \
  --region us-east-1
# Esperado: sem erros
```

---

**✅ CHECKPOINT 6: CUTOVER EXECUTADO**

Confirmações necessárias:
- ✅ Processamento pausado na aws-old
- ✅ Smoke tests passando na aws-new
- ✅ Logs sem erros
- ✅ Novo CloudFront acessível

**CloudFront novo:** `____________________________________`

**Sistema agora está rodando na aws-new! 🎉**

**Digite "CONTINUE" para validação final ou "ROLLBACK" para reverter.**

---

## FASE 7: VALIDAÇÃO PÓS-CUTOVER

**Objetivo:** Garantir que tudo está funcionando corretamente.

**Downtime:** ❌ Não (sistema já está funcionando)

### 7.1 - Testes Funcionais Completos

**Script de Teste:**
```bash
#!/bin/bash
CLOUDFRONT_URL="<NOVO_CLOUDFRONT_URL>"
API_BASE="$CLOUDFRONT_URL"

# Teste 1: Criar produto
echo "Teste 1: Criar produto..."
PRODUTO_ID=$(curl -s -X POST "$API_BASE/api/v1/produtos" \
  -H "Content-Type: application/json" \
  -d '{"nome":"Produto Teste","preco":50.00,"estoque":10}' | jq -r .id)
echo "Produto criado: $PRODUTO_ID"

# Teste 2: Listar produtos
echo "Teste 2: Listar produtos..."
curl -s "$API_BASE/api/v1/produtos" | jq '. | length'

# Teste 3: Criar nota fiscal
echo "Teste 3: Criar nota fiscal..."
NOTA_ID=$(curl -s -X POST "$API_BASE/api/v1/notas" \
  -H "Content-Type: application/json" \
  -d '{"numero":888888,"serie":"1","clienteId":1,"valor":100.00}' | jq -r .id)
echo "Nota criada: $NOTA_ID"

# Teste 4: Verificar nota criada
echo "Teste 4: Verificar nota..."
curl -s "$API_BASE/api/v1/notas/$NOTA_ID" | jq .

# Teste 5: Verificar eventos no EventBridge
echo "Teste 5: Verificar logs de eventos..."
# (verificar manualmente no CloudWatch)

echo "✅ Testes funcionais completos!"
```

---

### 7.2 - Monitoramento por 24h

**Ações:**
1. Configurar alarmes do CloudWatch (se não configurados)
2. Monitorar métricas:
   - Lambda errors
   - API Gateway 5xx errors
   - RDS connections
   - SQS dead letter queue
3. Validar processamento do Outbox (eventos sendo publicados)

---

**✅ CHECKPOINT 7: VALIDAÇÃO COMPLETA**

Confirmações necessárias:
- ✅ Testes funcionais passando
- ✅ Zero erros em 100 requests
- ✅ Latência < 500ms
- ✅ Eventos sendo processados corretamente

**Sistema validado e operacional na aws-new! 🚀**

---

## FASE 8: PÓS-MIGRAÇÃO (Redução de Custo aws-old)

**Objetivo:** Reduzir custos na aws-old gradualmente.

**Timeline:** 30 dias após cutover bem-sucedido

### 8.1 - Imediato (D+0): Pausar Recursos Não Críticos

```bash
# Nenhuma ação imediata
# Manter aws-old rodando por 7 dias como rollback rápido
```

---

### 8.2 - D+7: Parar Lambdas e API Gateways

```bash
# Desabilitar completamente as APIs (opcional, já estão sem uso)
# As stacks CloudFormation permanecerão, mas sem custo significativo
```

---

### 8.3 - D+30: Decomissionamento Completo

**⚠️ OPERAÇÃO IRREVERSÍVEL - REQUER "APPLY"**

```bash
# 1. Deletar stacks na ordem inversa
npx cdk destroy nfe-frontend-serverless-dev --profile aws-old --force
npx cdk destroy nfe-compute-serverless-dev --profile aws-old --force
npx cdk destroy nfe-database-serverless-dev --profile aws-old --force  # ⚠️ DELETA RDS
npx cdk destroy nfe-messaging-serverless-dev --profile aws-old --force
npx cdk destroy nfe-network-serverless-dev --profile aws-old --force
npx cdk destroy nfe-secrets-serverless-dev --profile aws-old --force

# 2. Deletar snapshots antigos (manter snapshot final por 90 dias)
# (ação manual via console ou CLI)

# 3. Deletar bucket CDK assets (opcional)
aws s3 rb s3://cdk-hnb659fds-assets-212051644015-us-east-1 --force --profile aws-old
```

**Custo após decomissionamento:**
- EmailTriageAI EC2: ~$7-8/mês (se mantiver)
- Snapshot RDS final: ~$2/mês (por 90 dias)
- **Total: ~$9-10/mês**

---

### 8.4 - Para ZERAR Custo aws-old

```bash
# Terminar EC2 EmailTriageAI (se não for mais necessária)
aws ec2 terminate-instances \
  --instance-ids i-01052b975ba194c38 \
  --profile aws-old \
  --region us-east-1

# Deletar snapshot RDS após 90 dias
aws rds delete-db-snapshot \
  --db-snapshot-identifier nfe-db-dev-migration-XXXXXX \
  --profile aws-old \
  --region us-east-1
```

**Resultado final: aws-old = $0/mês** ✅

---

## 📊 RESUMO DE CUSTOS

| Período | aws-old | aws-new | Total |
|---------|---------|---------|-------|
| **Antes Migração** | $31-37 | $0 | $31-37 |
| **Durante Migração (D+0 a D+7)** | $31-37 | $24-29 | $55-66 |
| **Estabilização (D+7 a D+30)** | $31-37 | $24-29 | $55-66 |
| **Após Decomissionamento (D+30)** | $9-10 | $24-29 | $33-39 |
| **Após ZERAR aws-old (D+120)** | $0 | $24-29 | $24-29 |

**Economia Final:** ~$7-13/mês (após zerar aws-old)

---

## 🎯 CRITÉRIOS DE SUCESSO FINAL

- ✅ Sistema NFe 100% funcional na aws-new
- ✅ Zero perda de dados (validado por checksums)
- ✅ Downtime < 30 minutos
- ✅ Zero erros em 1000 requests pós-cutover
- ✅ Latência < 500ms (p95)
- ✅ aws-old com custo reduzido a zero (após 120 dias)
- ✅ Runbook de operação criado
- ✅ Scripts de rollback testados

---

## 🆘 CONTATOS DE EMERGÊNCIA

**Se algo der errado durante a migração:**

1. **Rollback imediato:** Seguir procedimentos de rollback de cada fase
2. **Suporte AWS:** Abrir ticket de suporte (se tiver plano de suporte)
3. **Logs:** Verificar CloudWatch Logs para erros

---

## ✅ PRÓXIMA AÇÃO

**Você está pronto para iniciar a migração?**

Digite:
- **"START MIGRATION"** para iniciar FASE 1 (PRÉ-MIGRAÇÃO)
- **"REVIEW"** para revisar o plano novamente
- **"CANCEL"** para cancelar e não fazer nada agora
