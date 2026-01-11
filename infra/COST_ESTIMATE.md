# AWS Cost Estimate - NFe Infrastructure

Estimativa de custos mensais para ambientes dev e prod.

## 💰 Resumo Executivo

| Ambiente | Custo Mensal Estimado | Custo Anual |
|----------|----------------------|-------------|
| **Dev**  | $150 - $200          | $1,800 - $2,400 |
| **Prod** | $400 - $500          | $4,800 - $6,000 |

> **Notas**:
> - Preços baseados em região us-east-1 (Jan/2026)
> - Não inclui data transfer OUT (variável conforme tráfego)
> - Não inclui custos de suporte AWS

---

## 📊 Detalhamento: Ambiente DEV

### Compute (ECS Fargate)
- **2 services** (Faturamento + Estoque)
- **1 task/service**, 0.25 vCPU / 0.5 GB RAM
- **Total**: 0.5 vCPU + 1 GB RAM (24/7)

**Cálculo**:
- vCPU: 0.5 × $0.04048/hour × 730h = **$14.78/mês**
- RAM: 1 GB × $0.004445/GB/hour × 730h = **$3.24/mês**
- **Subtotal ECS**: ~$18/mês

### Database (RDS PostgreSQL)
- **Instance**: db.t4g.micro (Single-AZ)
- **Storage**: 20 GB GP3
- **Backup**: 3 dias retenção

**Cálculo**:
- Instance: $0.016/hour × 730h = **$11.68/mês**
- Storage: 20 GB × $0.115/GB = **$2.30/mês**
- Backup: ~10 GB × $0.095/GB = **$0.95/mês**
- **Subtotal RDS**: ~$15/mês

### Messaging (Amazon MQ RabbitMQ)
- **Instance**: mq.t3.micro (Single instance)
- **Storage**: 20 GB EBS

**Cálculo**:
- Instance: $0.036/hour × 730h = **$26.28/mês**
- Storage: 20 GB × $0.10/GB = **$2.00/mês**
- **Subtotal MQ**: ~$28/mês

### Networking
- **VPC**: Grátis
- **NAT Gateway**: 1 gateway (economia)
- **Data Transfer**: ~50 GB/mês (estimado)

**Cálculo**:
- NAT Gateway: $0.045/hour × 730h = **$32.85/mês**
- NAT Processed: 50 GB × $0.045/GB = **$2.25/mês**
- **Subtotal NAT**: ~$35/mês

### Load Balancing (ALB)
- **ALB Hours**: 730h
- **LCU Hours**: ~10 LCUs médio

**Cálculo**:
- ALB: $0.0225/hour × 730h = **$16.43/mês**
- LCU: 10 LCU × $0.008/LCU/hour × 730h = **$58.40/mês**
- **Subtotal ALB**: ~$75/mês (estimativa conservadora)

### Storage & CDN
- **S3**: 5 GB (frontend)
- **CloudFront**: 50 GB data transfer + 100k requests

**Cálculo**:
- S3: 5 GB × $0.023/GB + requests = **$0.15/mês**
- CloudFront: 50 GB × $0.085/GB = **$4.25/mês**
- **Subtotal S3+CDN**: ~$5/mês

### Container Registry (ECR)
- **Storage**: 2 GB (2 imagens)

**Cálculo**:
- Storage: 2 GB × $0.10/GB = **$0.20/mês**

### Secrets Manager
- **Secrets**: 5 secrets

**Cálculo**:
- Secrets: 5 × $0.40/secret = **$2.00/mês**

### CloudWatch
- **Logs**: 5 GB ingestion + 1 GB storage
- **Metrics**: Custom metrics (opcional)

**Cálculo**:
- Logs ingestion: 5 GB × $0.50/GB = **$2.50/mês**
- Logs storage: 1 GB × $0.03/GB = **$0.03/mês**
- **Subtotal CloudWatch**: ~$3/mês

### **TOTAL DEV**: ~$180/mês

---

## 📊 Detalhamento: Ambiente PROD

### Compute (ECS Fargate)
- **2 services** (Faturamento + Estoque)
- **2 tasks/service**, 0.5 vCPU / 1 GB RAM cada
- **Total**: 2 vCPU + 4 GB RAM (24/7)
- **Auto-scaling**: até 10 tasks (não incluído no baseline)

**Cálculo**:
- vCPU: 2 × $0.04048/hour × 730h = **$59.10/mês**
- RAM: 4 GB × $0.004445/GB/hour × 730h = **$12.98/mês**
- **Subtotal ECS**: ~$72/mês

### Database (RDS PostgreSQL)
- **Instance**: db.t4g.small (Multi-AZ)
- **Storage**: 50 GB GP3
- **Backup**: 7 dias retenção
- **Performance Insights**: Habilitado

**Cálculo**:
- Instance: $0.064/hour × 730h × 2 (Multi-AZ) = **$93.44/mês**
- Storage: 50 GB × $0.115/GB × 2 = **$11.50/mês**
- Backup: ~50 GB × $0.095/GB = **$4.75/mês**
- Performance Insights: $0.014/vCPU/hour × 2 vCPU × 730h = **$20.44/mês**
- **Subtotal RDS**: ~$130/mês

### Messaging (Amazon MQ RabbitMQ)
- **Instance**: mq.t3.micro (Active/Standby Multi-AZ)
- **Storage**: 20 GB EBS × 2

**Cálculo**:
- Instance: $0.036/hour × 730h × 2 = **$52.56/mês**
- Storage: 20 GB × $0.10/GB × 2 = **$4.00/mês**
- **Subtotal MQ**: ~$57/mês

### Networking
- **VPC**: Grátis
- **NAT Gateway**: 2 gateways (1/AZ para HA)
- **Data Transfer**: ~200 GB/mês

**Cálculo**:
- NAT Gateway: $0.045/hour × 730h × 2 = **$65.70/mês**
- NAT Processed: 200 GB × $0.045/GB = **$9.00/mês**
- **Subtotal NAT**: ~$75/mês

### Load Balancing (ALB)
- **ALB Hours**: 730h
- **LCU Hours**: ~20 LCUs médio (prod tráfego)

**Cálculo**:
- ALB: $0.0225/hour × 730h = **$16.43/mês**
- LCU: 20 LCU × $0.008/LCU/hour × 730h = **$116.80/mês**
- **Subtotal ALB**: ~$133/mês

### Storage & CDN
- **S3**: 10 GB (frontend + logs)
- **CloudFront**: 200 GB data transfer + 500k requests
- **S3 Logs**: 5 GB

**Cálculo**:
- S3: 15 GB × $0.023/GB + requests = **$0.50/mês**
- CloudFront: 200 GB × $0.085/GB = **$17.00/mês**
- S3 Logs: 5 GB × $0.023/GB = **$0.12/mês**
- **Subtotal S3+CDN**: ~$18/mês

### Container Registry (ECR)
- **Storage**: 5 GB (múltiplas tags)

**Cálculo**:
- Storage: 5 GB × $0.10/GB = **$0.50/mês**

### Secrets Manager
- **Secrets**: 7 secrets

**Cálculo**:
- Secrets: 7 × $0.40/secret = **$2.80/mês**

### CloudWatch
- **Logs**: 20 GB ingestion + 10 GB storage
- **Metrics**: Custom metrics
- **Alarms**: 10 alarms

**Cálculo**:
- Logs ingestion: 20 GB × $0.50/GB = **$10.00/mês**
- Logs storage: 10 GB × $0.03/GB = **$0.30/mês**
- Alarms: 10 × $0.10/alarm = **$1.00/mês**
- **Subtotal CloudWatch**: ~$12/mês

### **TOTAL PROD**: ~$500/mês

---

## 🔍 Custos Variáveis (Não Incluídos)

### Data Transfer OUT
- **Preço**: $0.09/GB (primeiros 10 TB)
- **Estimativa**: 100-500 GB/mês (depende de uso)
- **Custo**: $9-45/mês adicional

### Auto-Scaling (PROD)
- **Baseline**: 2 tasks/service (incluído)
- **Pico**: até 10 tasks/service
- **Custo adicional**: até $180/mês (se escalar 100% do tempo)
- **Realidade**: picos temporários = $20-50/mês médio

### Backups RDS Adicionais
- **Incluído**: 7 dias (prod), 3 dias (dev)
- **Adicional**: $0.095/GB/mês para snapshots > retenção

### Support Plans
- **Developer**: $29/mês ou 3% (mín $29)
- **Business**: $100/mês ou 10%/7%/5%/3%

---

## 💡 Otimizações de Custo

### Dev - Economia Máxima

1. **Desligar fora do horário comercial** (CloudWatch Events + Lambda)
   - Economia: ~40% ($72/mês)
   - Script: `scripts/schedule-dev-shutdown.sh`

2. **RDS Snapshot antes de stop** (evita custos de instance parada)
   - Economia: $11/mês quando parado

3. **NAT Gateway → NAT Instance** (t4g.nano)
   - Economia: ~$30/mês
   - Trade-off: Menos HA, mais gerenciamento

4. **CloudFront → S3 Direct** (somente dev)
   - Economia: $4/mês
   - Trade-off: Sem CDN

**Total economia potencial DEV**: até $100/mês (custo final ~$80/mês)

### Prod - Otimizações sem Impacto HA

1. **Savings Plans** (1 ano, no upfront)
   - ECS Fargate: 20% desconto = **$14/mês**
   - RDS: 35% desconto = **$45/mês**

2. **Reserved Instances** (Amazon MQ - 1 ano)
   - Desconto: 30% = **$17/mês**

3. **CloudFront Price Class 100** (NA + EU apenas)
   - Economia: $5/mês

4. **S3 Lifecycle Policies** (logs antigos → Glacier)
   - Economia: $2/mês

**Total economia potencial PROD**: ~$80/mês (custo final ~$420/mês)

---

## 📈 Projeção de Custos - Crescimento

### 6 Meses

| Ambiente | Baseline | Com Crescimento (2x tráfego) |
|----------|----------|------------------------------|
| Dev      | $180/mês | $180/mês (sem escala)        |
| Prod     | $500/mês | $650/mês (+30% auto-scale)   |

### 12 Meses

| Ambiente | Baseline | Com Crescimento (5x tráfego) |
|----------|----------|------------------------------|
| Dev      | $180/mês | $180/mês                     |
| Prod     | $500/mês | $800/mês (+60% scale + RDS upgrade) |

---

## 🛡️ Recomendações

### Dev
- ✅ Manter configuração atual
- ✅ Implementar shutdown automático (horário comercial apenas)
- ✅ Budget Alert: $200/mês

### Prod
- ✅ Adquirir Savings Plans após 3 meses (quando padrão de uso estável)
- ✅ Revisar LCU usage mensalmente (otimizar ALB)
- ✅ Budget Alert: $600/mês
- ✅ Implementar Cost Explorer tags (Project: NFe, Environment: prod)

### Monitoramento de Custos
```bash
# AWS Cost Explorer via CLI
aws ce get-cost-and-usage \
  --time-period Start=2026-01-01,End=2026-01-31 \
  --granularity MONTHLY \
  --metrics "BlendedCost" \
  --group-by Type=TAG,Key=Environment

# Budget Alerts
aws budgets create-budget \
  --account-id ACCOUNT_ID \
  --budget file://budget-dev.json
```

---

**Última atualização**: 2026-01-11
**Região de referência**: us-east-1
**Disclaimer**: Estimativas baseadas em preços AWS públicos. Custos reais podem variar.
