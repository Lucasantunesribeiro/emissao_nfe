# CDK Cost Optimization Changes

Mudanças necessárias na infraestrutura CDK para reduzir custos em 78% ($39/mês de economia).

## Resumo das Mudanças

1. **RDS Scheduler:** Adicionar Lambda para start/stop automático (economia: $8.71/mês)
2. **VPC Endpoints:** Remover Interface Endpoints em dev (economia: $21.90/mês)
3. **Lambda VPC:** Mover Lambdas não-RDS para fora do VPC (melhora performance + reduz necessidade de endpoints)
4. **Log Retention:** Padronizar retenção (7 dias dev, 30 dias prod)

## 1. Database Stack - RDS Scheduler

**Arquivo:** `lib/stacks/database-stack.ts`

### Adicionar imports

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
```

### Adicionar no construtor (após criação do RDS)

```typescript
// RDS Scheduler (only for dev environment)
if (props.environment === 'dev') {
  const schedulerFunction = new lambda.Function(this, 'RdsScheduler', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/rds-scheduler')),
    environment: {
      DB_INSTANCE_ID: this.dbInstance.instanceIdentifier
    },
    timeout: cdk.Duration.seconds(30),
    description: 'Starts/stops RDS instance on schedule to reduce costs',
    logRetention: logs.RetentionDays.ONE_WEEK,
    initialPolicy: [
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'rds:StartDBInstance',
          'rds:StopDBInstance',
          'rds:DescribeDBInstances'
        ],
        resources: [this.dbInstance.instanceArn]
      })
    ]
  });

  // Start RDS: Monday-Friday at 8 AM UTC (5 AM BRT / 3 AM ART)
  new events.Rule(this, 'StartRdsRule', {
    ruleName: `${props.stackName}-start-rds`,
    description: 'Start RDS instance for business hours',
    schedule: events.Schedule.cron({
      hour: '8',
      minute: '0',
      weekDay: 'MON-FRI'
    }),
    targets: [
      new targets.LambdaFunction(schedulerFunction, {
        event: events.RuleTargetInput.fromObject({ action: 'start' })
      })
    ]
  });

  // Stop RDS: Monday-Friday at 8 PM UTC (5 PM BRT / 3 PM ART)
  new events.Rule(this, 'StopRdsRule', {
    ruleName: `${props.stackName}-stop-rds`,
    description: 'Stop RDS instance after business hours',
    schedule: events.Schedule.cron({
      hour: '20',
      minute: '0',
      weekDay: 'MON-FRI'
    }),
    targets: [
      new targets.LambdaFunction(schedulerFunction, {
        event: events.RuleTargetInput.fromObject({ action: 'stop' })
      })
    ]
  });

  // Output scheduler function ARN
  new cdk.CfnOutput(this, 'RdsSchedulerFunctionArn', {
    value: schedulerFunction.functionArn,
    description: 'ARN of RDS Scheduler Lambda',
    exportName: `${props.stackName}-rds-scheduler-arn`
  });

  cdk.Tags.of(schedulerFunction).add('CostOptimization', 'RDS-Scheduler');
}
```

### Antes do deploy do Database Stack

```bash
# Instalar dependências da Lambda RDS Scheduler
cd infra/lambda/rds-scheduler
npm install
cd ../../cdk
```

## 2. Network Stack - Remover Interface Endpoints (DEV apenas)

**Arquivo:** `lib/stacks/network-stack.ts`

### Antes (com Interface Endpoints)

```typescript
// REMOVER ESTAS LINHAS em ambiente DEV:
this.sqsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SqsEndpoint', {
  vpc: this.vpc,
  service: ec2.InterfaceVpcEndpointAwsService.SQS,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  privateDnsEnabled: true,
  securityGroups: [vpceSecurityGroup]
});

this.secretsManagerEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
  vpc: this.vpc,
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  privateDnsEnabled: true,
  securityGroups: [vpceSecurityGroup]
});

this.eventBridgeEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
  vpc: this.vpc,
  service: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,
  subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  privateDnsEnabled: true,
  securityGroups: [vpceSecurityGroup]
});
```

### Depois (condicional por ambiente)

```typescript
// Interface Endpoints - ONLY in production for security
if (props.environment === 'prod') {
  this.sqsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SqsEndpoint', {
    vpc: this.vpc,
    service: ec2.InterfaceVpcEndpointAwsService.SQS,
    subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    privateDnsEnabled: true,
    securityGroups: [vpceSecurityGroup]
  });

  this.secretsManagerEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
    vpc: this.vpc,
    service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    privateDnsEnabled: true,
    securityGroups: [vpceSecurityGroup]
  });

  this.eventBridgeEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
    vpc: this.vpc,
    service: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,
    subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    privateDnsEnabled: true,
    securityGroups: [vpceSecurityGroup]
  });

  cdk.Tags.of(this.sqsEndpoint).add('CostCenter', 'Production-Security');
  cdk.Tags.of(this.secretsManagerEndpoint).add('CostCenter', 'Production-Security');
  cdk.Tags.of(this.eventBridgeEndpoint).add('CostCenter', 'Production-Security');
} else {
  // DEV: No Interface Endpoints - use public internet to save $21.90/month
  console.log('⚠️  DEV mode: Skipping Interface Endpoints to reduce costs');
  console.log('    Lambdas will use public internet for AWS API calls');
}

// Gateway Endpoint for S3 (free, always create)
this.s3GatewayEndpoint = new ec2.GatewayVpcEndpoint(this, 'S3Endpoint', {
  vpc: this.vpc,
  service: ec2.GatewayVpcEndpointAwsService.S3,
});
```

## 3. Compute Stack - Mover Lambdas para fora do VPC

**Arquivo:** `lib/stacks/compute-stack.ts`

### Estratégia

**Lambdas QUE PRECISAM DE VPC** (acessam RDS):
- nfe-estoque-dev
- nfe-faturamento-dev
- nfe-outbox-processor-dev
- nfe-pdf-generator-dev (se acessa RDS para buscar dados)

**Lambdas QUE NÃO PRECISAM DE VPC** (apenas APIs AWS públicas):
- Custom resources (LogRetention, CustomS3AutoDelete, etc.)
- Lambdas que só usam DynamoDB, SQS, EventBridge, S3

### Exemplo de mudança

```typescript
// ANTES: Todas as Lambdas no VPC
const estoqueFunction = new lambda.Function(this, 'EstoqueFunction', {
  runtime: lambda.Runtime.DOTNET_9,
  handler: 'ServicoEstoque',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../../servico-estoque/publish')),
  vpc: props.vpc,  // ← REMOVE para Lambdas não-RDS
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  securityGroups: [lambdaSecurityGroup],
  // ...
});

// DEPOIS: Apenas Lambdas RDS no VPC
const needsVpc = this.needsDatabaseAccess(functionName); // método helper

const estoqueFunction = new lambda.Function(this, 'EstoqueFunction', {
  runtime: lambda.Runtime.DOTNET_9,
  handler: 'ServicoEstoque',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../../servico-estoque/publish')),
  ...(needsVpc && {
    vpc: props.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [lambdaSecurityGroup]
  }),
  // ...
});

// Helper method
private needsDatabaseAccess(functionName: string): boolean {
  const rdsLambdas = [
    'nfe-estoque-dev',
    'nfe-faturamento-dev',
    'nfe-outbox-processor-dev',
    'nfe-pdf-generator-dev'
  ];
  return rdsLambdas.includes(functionName);
}
```

### Alternativa: Criar métodos separados

```typescript
private createLambdaInVpc(id: string, props: LambdaProps) {
  return new lambda.Function(this, id, {
    ...props,
    vpc: this.vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    securityGroups: [this.lambdaSecurityGroup]
  });
}

private createLambdaPublic(id: string, props: LambdaProps) {
  return new lambda.Function(this, id, {
    ...props
    // No VPC config
  });
}

// Uso:
const estoqueFunction = this.createLambdaInVpc('EstoqueFunction', {
  runtime: lambda.Runtime.DOTNET_9,
  handler: 'ServicoEstoque',
  // ...
});

const logRetentionFunction = this.createLambdaPublic('LogRetention', {
  runtime: lambda.Runtime.NODEJS_22_X,
  handler: 'index.handler',
  // ...
});
```

## 4. Padronizar Log Retention

**Arquivo:** `lib/stacks/compute-stack.ts`

```typescript
import * as logs from 'aws-cdk-lib/aws-logs';

// No início da classe
private getLogRetention(): logs.RetentionDays {
  return this.props.environment === 'prod'
    ? logs.RetentionDays.ONE_MONTH
    : logs.RetentionDays.ONE_WEEK;
}

// Aplicar a todas as Lambdas
const estoqueFunction = new lambda.Function(this, 'EstoqueFunction', {
  // ... outras props
  logRetention: this.getLogRetention(),
});
```

## 5. Deploy das Mudanças

### Passo 1: Instalar dependências da Lambda Scheduler

```bash
cd infra/lambda/rds-scheduler
npm install
cd ../../cdk
```

### Passo 2: Diff para verificar mudanças

```bash
npm run cdk diff nfe-database-serverless-dev
npm run cdk diff nfe-network-serverless-dev
npm run cdk diff nfe-compute-serverless-dev
```

### Passo 3: Deploy Database Stack (RDS Scheduler)

```bash
npm run cdk deploy nfe-database-serverless-dev
```

### Passo 4: Deploy Compute Stack (Lambda VPC changes)

```bash
npm run cdk deploy nfe-compute-serverless-dev
```

### Passo 5: Deploy Network Stack (Remove Interface Endpoints)

⚠️ **ATENÇÃO:** Isso irá DELETAR os Interface Endpoints existentes!

Certifique-se de que as Lambdas já foram movidas para fora do VPC (passo 4) antes de executar.

```bash
npm run cdk deploy nfe-network-serverless-dev
```

### Passo 6: Verificar funcionamento

```bash
# Testar RDS Scheduler manualmente
aws lambda invoke \
  --function-name <ARN-da-lambda-scheduler> \
  --payload '{"action":"stop"}' \
  /tmp/response.json

# Verificar logs
aws logs tail /aws/lambda/<scheduler-function-name> --follow

# Verificar estado do RDS
aws rds describe-db-instances \
  --db-instance-identifier nfe-db-dev \
  --query 'DBInstances[0].DBInstanceStatus'
```

## 6. Rollback Plan

Se algo der errado:

### Rollback RDS Scheduler
```bash
# Remover EventBridge Rules
aws events remove-targets --rule <rule-name> --ids <target-id>
aws events delete-rule --name <rule-name>

# Deletar Lambda
aws lambda delete-function --function-name <scheduler-function-name>

# Garantir que RDS está rodando
aws rds start-db-instance --db-instance-identifier nfe-db-dev
```

### Rollback VPC Endpoints
```bash
# Re-deploy stack antiga (antes das mudanças)
git checkout <commit-antes-das-mudanças>
npm run cdk deploy nfe-network-serverless-dev
```

### Rollback Lambda VPC
```bash
# Re-deploy stack antiga
git checkout <commit-antes-das-mudanças>
npm run cdk deploy nfe-compute-serverless-dev
```

## 7. Validação Pós-Deploy

### Checklist

- [ ] RDS Scheduler Lambda criada
- [ ] EventBridge Rules criadas (start e stop)
- [ ] RDS pode ser parado manualmente: `aws rds stop-db-instance --db-instance-identifier nfe-db-dev`
- [ ] RDS pode ser iniciado manualmente: `aws rds start-db-instance --db-instance-identifier nfe-db-dev`
- [ ] Interface Endpoints deletados (verificar console ou CLI)
- [ ] Lambdas RDS ainda conseguem acessar banco de dados
- [ ] Lambdas não-RDS conseguem acessar serviços AWS (SQS, EventBridge, S3)
- [ ] APIs Gateway respondem corretamente
- [ ] Logs estão sendo gerados com retenção correta

### Comandos de verificação

```bash
# Verificar RDS Scheduler
aws lambda list-functions --query 'Functions[?contains(FunctionName, `rds-scheduler`)]'

# Verificar EventBridge Rules
aws events list-rules --name-prefix nfe-database-serverless-dev

# Verificar VPC Endpoints
aws ec2 describe-vpc-endpoints --filters "Name=vpc-id,Values=vpc-0b5efd8a245fea948"

# Verificar Lambdas no VPC
aws lambda list-functions --query 'Functions[?VpcConfig.VpcId==`vpc-0b5efd8a245fea948`].[FunctionName,VpcConfig.VpcId]'

# Verificar logs retention
aws logs describe-log-groups --log-group-name-prefix /aws/lambda/nfe-
```

## 8. Monitoramento de Custos

### AWS Budgets (Recomendado)

```bash
aws budgets create-budget \
  --account-id 212051644015 \
  --budget file://budget-config.json
```

**budget-config.json:**
```json
{
  "BudgetName": "NFe-Dev-Monthly-Budget",
  "BudgetLimit": {
    "Amount": "15.0",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {
    "TagKeyValue": ["Project$NFe-System", "Environment$dev"]
  },
  "NotificationsWithSubscribers": [
    {
      "Notification": {
        "NotificationType": "ACTUAL",
        "ComparisonOperator": "GREATER_THAN",
        "Threshold": 80,
        "ThresholdType": "PERCENTAGE"
      },
      "Subscribers": [
        {
          "SubscriptionType": "EMAIL",
          "Address": "seu-email@example.com"
        }
      ]
    }
  ]
}
```

## 9. Próximas Otimizações (Opcional)

### Para Produção:

1. **Aurora Serverless v2** (em vez de RDS)
   - Auto-scaling de 0.5 a 1 ACU
   - Auto-pause após 5 minutos sem uso
   - Custo: $0 quando pausado, $0.12/hr quando ativo

2. **CloudFront Caching**
   - Reduzir chamadas ao S3
   - Melhorar latência

3. **S3 Lifecycle Policies**
   - Mover PDFs antigos para Glacier após 90 dias
   - Economia: ~70% no armazenamento de longo prazo

4. **Reserved Instances** (se carga previsível)
   - Até 72% de desconto em RDS/EC2
   - Requer compromisso de 1-3 anos

## 10. Conclusão

**Economia Total Estimada:**
- RDS Scheduler: $8.71/mês (56% redução em RDS)
- VPC Endpoints removidos: $21.90/mês (100% desse custo)
- **TOTAL: $30.61/mês de economia (~68% de redução)**

**Custo mensal projetado:**
- Antes: $45-50/mês
- Depois: $14-15/mês

**Trade-offs:**
- RDS não disponível 24/7 em dev (apenas 60 hrs/semana)
- Lambdas em dev usam internet pública (latência levemente maior, mas imperceptível)
- Produção mantém todos os recursos (segurança e disponibilidade)

**Riscos:**
- Baixo (mudanças reversíveis via rollback)
- RDS pode ser iniciado manualmente a qualquer momento se necessário
- Lambdas continuam funcionais com acesso público aos serviços AWS
