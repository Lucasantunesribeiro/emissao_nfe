# Guia de Migração: ECS → Serverless

## Visão Geral

Este guia detalha a migração do sistema NFe de ECS Fargate + RabbitMQ para Lambda + EventBridge, com foco em zero downtime e rollback seguro.

## Estratégia: Blue-Green Deployment

```
┌─────────────────────────────────────────────────────┐
│ FASE 1: Setup Paralelo (Semana 1)                  │
├─────────────────────────────────────────────────────┤
│ • Deploy infraestrutura serverless                  │
│ • Manter ECS rodando (blue)                         │
│ • Configurar Lambda (green) sem tráfego             │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ FASE 2: Validação Green (Semana 2)                 │
├─────────────────────────────────────────────────────┤
│ • Testes automatizados no stack serverless          │
│ • Load testing (100 RPS)                            │
│ • Validar saga completo                             │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ FASE 3: Cutover Gradual (Semana 3)                 │
├─────────────────────────────────────────────────────┤
│ • Route 10% tráfego para Lambda via Route53         │
│ • Monitorar 48h: erros, latência, custos            │
│ • Incrementar 25% → 50% → 100%                      │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│ FASE 4: Deprecação Blue (Semana 4)                 │
├─────────────────────────────────────────────────────┤
│ • 100% tráfego em Lambda                            │
│ • Manter ECS standby por 1 semana (rollback)       │
│ • Destroy ECS stack após validação final           │
└─────────────────────────────────────────────────────┘
```

## Fase 1: Setup Infraestrutura Paralela

### 1.1 Deploy Database Stack Serverless

**Objetivo**: Criar RDS Proxy sem impactar RDS existente.

```bash
# 1. Backup RDS atual
aws rds create-db-snapshot \
  --db-instance-identifier nfe-db-dev \
  --db-snapshot-identifier nfe-db-backup-pre-migration-$(date +%Y%m%d)

# 2. Verificar backup completo
aws rds describe-db-snapshots \
  --db-snapshot-identifier nfe-db-backup-pre-migration-*

# 3. Deploy DatabaseStackServerless (cria RDS Proxy)
cd infra/cdk
cdk deploy DatabaseStackServerless --require-approval never

# Output esperado:
# - RdsProxyEndpoint: xxx.proxy-xxxxx.us-east-1.rds.amazonaws.com
```

**Validação**:
```bash
# Testar conexão via RDS Proxy
psql -h $(aws cloudformation describe-stacks \
  --stack-name DatabaseStackServerless \
  --query 'Stacks[0].Outputs[?OutputKey==`RdsProxyEndpoint`].OutputValue' \
  --output text) \
  -U postgres -d nfe_db -c "SELECT 1;"
```

### 1.2 Deploy Messaging Stack Serverless

**Objetivo**: Criar EventBus paralelo ao RabbitMQ.

```bash
# Deploy EventBridge + Archive
cdk deploy MessagingStackServerless --require-approval never

# Output esperado:
# - EventBusName: nfe-events-dev
# - EventBusArn: arn:aws:events:us-east-1:xxx:event-bus/nfe-events-dev
```

### 1.3 Build Lambdas

**Lambda Faturamento (Go)**:
```bash
cd servico-faturamento

# Criar handler Lambda separado do main API
cat > cmd/lambda/main.go <<'EOF'
package main

import (
    "context"
    "encoding/json"

    "github.com/aws/aws-lambda-go/events"
    "github.com/aws/aws-lambda-go/lambda"
)

type Response events.APIGatewayProxyResponse

func HandleRequest(ctx context.Context, request events.APIGatewayProxyRequest) (Response, error) {
    // Reutilizar handlers HTTP existentes
    // TODO: Implementar router para /api/v1/notas
    return Response{
        StatusCode: 200,
        Body:       `{"status":"ok"}`,
    }, nil
}

func main() {
    lambda.Start(HandleRequest)
}
EOF

# Build ARM64
GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o build/bootstrap cmd/lambda/main.go

# Verificar build
file build/bootstrap
# Output: build/bootstrap: ELF 64-bit LSB executable, ARM aarch64
```

**Lambda Estoque (.NET)**:
```bash
cd servico-estoque

# Adicionar pacote Lambda
dotnet add package Amazon.Lambda.AspNetCoreServer.Hosting --version 1.7.1

# Modificar Program.cs
cat > Api/Program.cs <<'EOF'
using Microsoft.AspNetCore.Hosting;
using Amazon.Lambda.AspNetCoreServer.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Lambda runtime check
if (builder.Environment.EnvironmentName == "Production" &&
    !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AWS_LAMBDA_FUNCTION_NAME")))
{
    builder.Services.AddAWSLambdaHosting(LambdaEventSource.HttpApi);
}

// ... resto do código existente ...

var app = builder.Build();
app.Run();
EOF

# Publish Native AOT
dotnet publish -c Release -r linux-arm64 --self-contained -o publish

# Verificar binário
ls -lh publish/ServicoEstoque
# Output: -rwxr-xr-x 1 user user 45M ServicoEstoque
```

### 1.4 Deploy Compute Stack Serverless

```bash
# Deploy Lambdas + API Gateway + SQS
cdk deploy ComputeStackServerless --require-approval never

# Outputs esperados:
# - ApiFaturamentoUrl: https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
# - ApiEstoqueUrl: https://yyyyy.execute-api.us-east-1.amazonaws.com/dev
```

**Validação**:
```bash
# Test health checks
FATURAMENTO_URL=$(aws cloudformation describe-stacks \
  --stack-name ComputeStackServerless \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiFaturamentoUrl`].OutputValue' \
  --output text)

curl "$FATURAMENTO_URL/health"
# Output: {"status":"healthy","timestamp":"..."}
```

## Fase 2: Validação Green Environment

### 2.1 Testes Funcionais

```bash
# Suite de testes end-to-end
cd web-app
npm run test:e2e:serverless

# Testes específicos:
# 1. Criar produto via Lambda Estoque
# 2. Criar nota fiscal via Lambda Faturamento
# 3. Validar saga completo (reserva + confirmação)
# 4. Simular falha (estoque insuficiente) → compensação
```

### 2.2 Load Testing

**Ferramenta**: k6 (https://k6.io)

```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp-up
    { duration: '5m', target: 100 },  // Sustained load
    { duration: '2m', target: 0 },    // Ramp-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% < 500ms
    http_req_failed: ['rate<0.01'],   // < 1% errors
  },
};

export default function () {
  const baseUrl = __ENV.API_URL;

  // Test 1: Create produto
  let resProduto = http.post(`${baseUrl}/api/v1/produtos`, JSON.stringify({
    codigo: `PROD-${Date.now()}`,
    descricao: 'Produto teste k6',
    quantidade: 100,
    preco: 50.00,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(resProduto, {
    'produto created': (r) => r.status === 201,
  });

  // Test 2: Create nota fiscal
  const produtoId = JSON.parse(resProduto.body).id;

  let resNota = http.post(`${baseUrl}/api/v1/notas`, JSON.stringify({
    items: [{ produtoId, quantidade: 5 }],
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(resNota, {
    'nota created': (r) => r.status === 201,
  });
}
```

**Executar**:
```bash
API_URL="https://xxxxx.execute-api.us-east-1.amazonaws.com/dev" k6 run load-test.js

# Validar resultados:
# - http_req_duration: p(95) < 500ms ✓
# - http_req_failed: < 1% ✓
# - Lambda throttles: 0 ✓
# - API Gateway 5xx: < 0.1% ✓
```

### 2.3 Testes Saga Completo

```bash
# Script validação saga
cat > test-saga.sh <<'EOF'
#!/bin/bash
set -e

API_URL="${API_URL:-https://xxxxx.execute-api.us-east-1.amazonaws.com/dev}"

echo "1. Criar produto..."
PRODUTO_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/produtos" \
  -H "Content-Type: application/json" \
  -d '{"codigo":"SAGA-TEST","descricao":"Produto teste saga","quantidade":10,"preco":100.00}')
PRODUTO_ID=$(echo "$PRODUTO_RESPONSE" | jq -r '.id')
echo "   Produto ID: $PRODUTO_ID"

echo "2. Criar nota fiscal..."
NOTA_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/notas" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"produtoId\":\"$PRODUTO_ID\",\"quantidade\":5}]}")
NOTA_ID=$(echo "$NOTA_RESPONSE" | jq -r '.id')
echo "   Nota ID: $NOTA_ID"

echo "3. Aguardar saga (outbox processor roda a cada 1min)..."
sleep 65

echo "4. Validar reserva criada..."
RESERVA=$(aws dynamodb get-item --table-name estoque-reservas-dev --key "{\"notaFiscalId\":{\"S\":\"$NOTA_ID\"}}" || echo "")
if [ -n "$RESERVA" ]; then
  echo "   ✓ Reserva criada"
else
  echo "   ✗ Reserva NÃO criada (FALHA)"
  exit 1
fi

echo "5. Validar nota confirmada..."
NOTA_STATUS=$(curl -s "$API_URL/api/v1/notas/$NOTA_ID" | jq -r '.status')
if [ "$NOTA_STATUS" = "CONFIRMADA" ]; then
  echo "   ✓ Nota confirmada"
else
  echo "   ✗ Nota status: $NOTA_STATUS (esperado: CONFIRMADA)"
  exit 1
fi

echo "✓ Saga completo validado com sucesso!"
EOF

chmod +x test-saga.sh
./test-saga.sh
```

### 2.4 Custos Reais (1 Semana)

```bash
# Comparar custos ECS vs Lambda
aws ce get-cost-and-usage \
  --time-period Start=2025-01-05,End=2025-01-12 \
  --granularity DAILY \
  --metrics "UnblendedCost" \
  --group-by Type=SERVICE \
  --filter file://cost-filter.json

# cost-filter.json
{
  "Or": [
    {"Dimensions": {"Key": "SERVICE", "Values": ["AWS Lambda"]}},
    {"Dimensions": {"Key": "SERVICE", "Values": ["Amazon API Gateway"]}},
    {"Dimensions": {"Key": "SERVICE", "Values": ["Amazon EventBridge"]}},
    {"Dimensions": {"Key": "SERVICE", "Values": ["Amazon Simple Queue Service"]}}
  ]
}

# Resultado esperado (1 semana):
# - Lambda: $1.80 (projeção $7.70/mês) ✓
# - API Gateway: $0.80 (projeção $3.40/mês) ✓
# - EventBridge: $0.20 (projeção $0.85/mês) ✓
# - SQS: $0.10 (projeção $0.40/mês) ✓
```

## Fase 3: Cutover Gradual

### 3.1 Route53 Weighted Routing

**Setup inicial**: 90% ECS (blue) / 10% Lambda (green)

```typescript
// route53-weighted.ts
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';

const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
  domainName: 'meudominio.com',
});

// Blue: ECS + ALB (90%)
new route53.ARecord(this, 'ApiBlue', {
  zone: hostedZone,
  recordName: 'api',
  target: route53.RecordTarget.fromAlias(
    new targets.LoadBalancerTarget(alb),
  ),
  weight: 90,
});

// Green: Lambda + API Gateway (10%)
new route53.ARecord(this, 'ApiGreen', {
  zone: hostedZone,
  recordName: 'api',
  target: route53.RecordTarget.fromAlias(
    new targets.ApiGateway(apiFaturamento),
  ),
  weight: 10,
});
```

**Deploy**:
```bash
cdk deploy Route53Stack --require-approval never
```

### 3.2 Monitoramento Intensivo (48h)

**CloudWatch Dashboard**:
```bash
aws cloudwatch put-dashboard \
  --dashboard-name nfe-migration-green \
  --dashboard-body file://dashboard.json

# dashboard.json
{
  "widgets": [
    {
      "type": "metric",
      "properties": {
        "title": "Lambda Errors (Green)",
        "metrics": [
          ["AWS/Lambda", "Errors", {"stat": "Sum", "period": 60}]
        ],
        "yAxis": {"left": {"min": 0}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "API Gateway Latency (Green)",
        "metrics": [
          ["AWS/ApiGateway", "Latency", {"stat": "Average", "period": 60}]
        ],
        "yAxis": {"left": {"label": "ms"}}
      }
    },
    {
      "type": "metric",
      "properties": {
        "title": "SQS Messages (Green)",
        "metrics": [
          ["AWS/SQS", "NumberOfMessagesSent"],
          [".", "ApproximateAgeOfOldestMessage"]
        ]
      }
    }
  ]
}
```

**Alarmes críticos**:
```bash
# Lambda error rate > 5%
aws cloudwatch put-metric-alarm \
  --alarm-name nfe-lambda-errors-high \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 50 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:xxx:nfe-alerts

# API Gateway 5xx > 1%
aws cloudwatch put-metric-alarm \
  --alarm-name nfe-apigateway-5xx-high \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Average \
  --period 300 \
  --evaluation-periods 2 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:xxx:nfe-alerts
```

### 3.3 Incremento Gradual

**Checklist validação antes de incrementar**:
- [ ] Lambda error rate < 1% (últimas 48h)
- [ ] API Gateway P95 latency < 500ms
- [ ] SQS DLQ vazio (zero mensagens)
- [ ] CloudWatch Logs sem erros críticos
- [ ] Custos dentro do esperado ($10/semana)

**Sequência de incremento**:
```bash
# Dia 1-2: 10% tráfego
# Validar: ✓ OK

# Dia 3: Aumentar para 25%
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://change-25pct.json

# Dia 5: Aumentar para 50%
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://change-50pct.json

# Dia 7: Aumentar para 100%
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://change-100pct.json
```

## Fase 4: Deprecação Blue Environment

### 4.1 Standby Period (1 semana)

**Manter ECS rodando mas sem tráfego**:
```bash
# Reduzir desired count para 1 (mínimo)
aws ecs update-service \
  --cluster nfe-cluster-dev \
  --service nfe-faturamento-dev \
  --desired-count 1

aws ecs update-service \
  --cluster nfe-cluster-dev \
  --service nfe-estoque-dev \
  --desired-count 1

# Economia: $12/mês (redução de 2 tasks para 1)
```

### 4.2 Validação Final

**Checklist antes de destruir ECS**:
- [ ] 100% tráfego em Lambda por 7 dias consecutivos
- [ ] Zero alarmes críticos disparados
- [ ] Custos confirmados < $50/mês
- [ ] Backup RDS atualizado (< 24h)
- [ ] Documentação atualizada
- [ ] Stakeholders aprovaram

### 4.3 Destroy Blue Stack

```bash
# Backup final
aws rds create-db-snapshot \
  --db-instance-identifier nfe-db-dev \
  --db-snapshot-identifier nfe-db-final-$(date +%Y%m%d)

# Destroy ECS stack
cdk destroy ComputeStack --force
cdk destroy LoadBalancerStack --force
cdk destroy MessagingStack --force  # Amazon MQ

# Validar recursos removidos
aws ecs list-clusters  # Cluster removido
aws elbv2 describe-load-balancers  # ALB removido
aws mq list-brokers  # RabbitMQ removido

# Economia ativada: $136/mês ✓
```

## Rollback Plan

### Cenário 1: Falha na Fase 1-2 (Pré-Cutover)

**Ação**: Nenhuma necessária (ECS ainda está 100% tráfego).

```bash
# Apenas destruir stack serverless
cdk destroy ComputeStackServerless --force
cdk destroy MessagingStackServerless --force
cdk destroy DatabaseStackServerless --force  # Mantém RDS, remove apenas Proxy
```

### Cenário 2: Falha na Fase 3 (Durante Cutover)

**Sintoma**: Lambda error rate > 5% ou API Gateway 5xx > 1%.

**Ação Imediata** (< 5 minutos):
```bash
# 1. Revert Route53 para 100% ECS
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://rollback-100pct-ecs.json

# rollback-100pct-ecs.json
{
  "Changes": [{
    "Action": "UPSERT",
    "ResourceRecordSet": {
      "Name": "api.meudominio.com",
      "Type": "A",
      "SetIdentifier": "Blue-ECS",
      "Weight": 100,
      "AliasTarget": {
        "HostedZoneId": "Z123456",
        "DNSName": "alb-xxx.us-east-1.elb.amazonaws.com",
        "EvaluateTargetHealth": true
      }
    }
  }]
}

# 2. Aumentar ECS desired count
aws ecs update-service \
  --cluster nfe-cluster-dev \
  --service nfe-faturamento-dev \
  --desired-count 2

# 3. Validar rollback
curl https://api.meudominio.com/health
# Output: ECS health (confirmar via header X-Powered-By: ECS)
```

**Post-Mortem**:
- [ ] Analisar CloudWatch Logs (Lambda errors)
- [ ] Revisar X-Ray traces (latência)
- [ ] Ajustar código/config
- [ ] Repetir Fase 2 (validação)

### Cenário 3: Falha na Fase 4 (Pós-Cutover)

**Sintoma**: Problema crítico descoberto após 7 dias (improvável).

**Ação** (< 30 minutos):
```bash
# 1. Restore ECS stack
cdk deploy ComputeStack
cdk deploy LoadBalancerStack

# 2. Aguardar ECS tasks healthy (~5min)
aws ecs wait services-stable \
  --cluster nfe-cluster-dev \
  --services nfe-faturamento-dev nfe-estoque-dev

# 3. Route53 100% ECS
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://rollback-100pct-ecs.json

# 4. Destroy serverless (opcional, pode manter standby)
cdk destroy ComputeStackServerless --force
```

## Custos da Migração

### Custo Durante Migração (4 semanas)

| Semana | ECS | Lambda | RabbitMQ | EventBridge | Total |
|--------|-----|--------|----------|-------------|-------|
| 1 | $45 (100%) | $10 (testes) | $7 | $0.25 | $62.25 |
| 2 | $45 (100%) | $10 (load test) | $7 | $0.25 | $62.25 |
| 3 | $22 (50% avg) | $22 (50% avg) | $7 | $1 | $52 |
| 4 | $5 (standby) | $44 (100%) | $0 | $1 | $50 |
| **Total Migração** | | | | | **$226.50** |

**Custo adicional**: $46.50 (1 mês blue-green paralelo)

### ROI

- **Investimento total**: 80h engenharia + $46.50 infra = **~$5.000**
- **Economia anual**: $136/mês * 12 = **$1.632**
- **Payback**: 4 meses

## Checklist Pré-Migração

### Requisitos Técnicos
- [ ] Go 1.22+ instalado (build Lambda)
- [ ] .NET 8 SDK instalado (build Lambda)
- [ ] AWS CLI v2 instalado
- [ ] CDK v2.160+ instalado
- [ ] k6 instalado (load testing)
- [ ] psql cliente instalado (validação RDS)

### Requisitos AWS
- [ ] IAM permissions: Lambda, API Gateway, EventBridge, RDS, Route53
- [ ] Backup RDS recente (< 24h)
- [ ] Secrets Manager configurado
- [ ] SNS topic para alarmes criado
- [ ] Budget alert configurado ($60/mês threshold)

### Requisitos Organizacionais
- [ ] Stakeholders cientes do plano (4 semanas)
- [ ] Change request aprovado
- [ ] Janela de manutenção agendada (cutover)
- [ ] Runbook de rollback validado
- [ ] Post-mortem template preparado

## Conclusão

**Timeline**: 4 semanas (conservador, pode ser 2 semanas para times experientes)

**Risco**: **BAIXO** (blue-green com rollback imediato)

**Impacto**: Zero downtime se seguir plano rigorosamente.

**Próximo Passo**: Executar Fase 1 em ambiente dev para validar processo.
