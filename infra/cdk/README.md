# NFe Infrastructure - AWS CDK

Infraestrutura serverless para o sistema NFe usando AWS CDK (TypeScript).

## 🚀 Quick Deploy

```bash
# Instalar dependências
npm install

# Bootstrap CDK (primeira vez apenas)
cdk bootstrap

# Deploy todas as stacks (dev)
cdk deploy --all --require-approval never

# Deploy stack individual
cdk deploy nfe-compute-serverless-dev
```

## 📦 Stacks

| Stack | Recursos | Custo (dev) |
|-------|----------|-------------|
| **database-dynamodb-dev** | DynamoDB Main Table + Events Table | $0 (Free Tier) |
| **messaging-serverless-dev** | EventBridge + SQS + DLQ | $0 (Free Tier) |
| **compute-serverless-dev** | Lambda Functions (Go + .NET) | $0 (Free Tier) |
| **frontend-serverless-dev** | S3 + CloudFront | $0 (Free Tier) |

**Total: ~$0-5/mês** (dependendo do uso do RDS se habilitado)

## 🛠️ Comandos Úteis

```bash
# Synth (gerar CloudFormation templates)
npm run cdk synth

# Diff (ver mudanças antes do deploy)
npm run cdk diff

# Destroy (remover toda infraestrutura)
cdk destroy --all

# Listar stacks
cdk list
```

## 🏗️ Arquitetura Serverless

```
Frontend (Angular)
    S3 + CloudFront
         ↓
    API Gateway
    ├── Faturamento API (Lambda Go)
    └── Estoque API (Lambda .NET)
         ↓
    EventBridge + SQS
         ↓
    DynamoDB + RDS (optional)
```

## 🔧 Configuração

### Environment Variables

O CDK lê configurações de:
- `lib/config/dev-config.ts` (desenvolvimento)
- `lib/config/prod-config.ts` (produção)

### Cost Guardrails

CDK Aspects impedem recursos caros:
- ❌ NAT Gateway
- ❌ ECS/Fargate
- ❌ RDS Multi-AZ em dev

### Multi-ambiente

```bash
# Deploy dev
cdk deploy --all --context env=dev

# Deploy prod
cdk deploy --all --context env=prod
```

## 📊 Outputs

Após o deploy, o CDK exibe:
- **ApiFaturamentoUrl**: URL da API de faturamento
- **ApiEstoqueUrl**: URL da API de estoque
- **CloudFrontUrl**: URL do frontend
- **MainTableName**: Nome da tabela DynamoDB

## 🧪 Testes

```bash
# Testes unitários CDK
npm test

# Snapshot tests
npm run test -- -u
```

## 📝 Estrutura

```
cdk/
├── bin/                    # Entry points
│   └── nfe-infra-serverless.ts
├── lib/
│   ├── aspects/           # Cost guardrails
│   ├── config/            # Environment configs
│   └── stacks/            # CloudFormation stacks
│       ├── database-dynamodb-stack.ts
│       ├── compute-stack-serverless.ts
│       ├── messaging-stack-serverless.ts
│       └── frontend-stack-serverless.ts
├── cdk.json              # CDK configuration
└── package.json          # Dependencies
```

## 🔒 Segurança

- ✅ **Secrets Manager**: Credenciais criptografadas
- ✅ **IAM Least Privilege**: Roles específicas por função
- ✅ **VPC Security Groups**: Isolamento de rede (quando aplicável)
- ✅ **API Gateway Throttling**: Rate limiting
- ✅ **CloudFront SSL**: HTTPS obrigatório

## 💰 FinOps

### Cost Optimization Features

1. **On-Demand Pricing**: Lambda e DynamoDB escaláveis
2. **No NAT Gateway**: Lambda fora da VPC
3. **Short Log Retention**: 1 dia em dev
4. **RDS Scheduler**: Database apenas horário comercial
5. **Free Tier Maximizado**: 100% dos serviços elegíveis

### Monitoramento de Custos

```bash
# Ver custo atual
aws ce get-cost-and-usage \
  --time-period Start=$(date -d '1 month ago' +%Y-%m-%d),End=$(date +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost

# Kill switch (emergência)
../../scripts/aws-cost-kill-switch.sh --execute
```

## 📖 Documentação Adicional

- [Arquitetura Completa](/infra/ARCHITECTURE_DIAGRAM.md)
- [Comparação ECS vs Lambda](/infra/COMPARISON_ECS_VS_LAMBDA.md)
- [Checklist Pre-Deploy](/infra/PRE_DEPLOY_CHECKLIST.md)

## 🤝 Contribuindo

1. Testar mudanças: `npm run cdk diff`
2. Validar cost impact antes do merge
3. Manter cost guardrails ativos
4. Documentar outputs de novas stacks

---

**Stack desenvolvida com AWS CDK + TypeScript + FinOps best practices**
