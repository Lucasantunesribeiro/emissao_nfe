# Infraestrutura CDK

Fonte de verdade da infraestrutura AWS atual do projeto. O entrypoint ativo e `bin/nfe-infra-serverless.ts`.

## Escopo ativo

O app CDK provisiona a arquitetura serverless usada hoje:

- `AuthStack`: Cognito User Pool e app client.
- `DatabaseDynamoDBStack`: main table e events table no DynamoDB.
- `MessagingStackServerless`: EventBridge, filas SQS e DLQ.
- `FrontendStack`: bucket S3 e distribuicao CloudFront.
- `ComputeStackServerless`: APIs, Lambdas Go e .NET, authorizer, tracing, alarmes e dashboard.

Nao ha dependencia operacional de RDS, RabbitMQ, ECS ou ALB na trilha ativa.

## Comandos principais

```bash
npm ci
npm run build
npm run synth:serverless -- --context env=dev
npm run deploy:serverless:dev
npm run deploy:serverless:prod
```

Para destruir:

```bash
npm run destroy:serverless:dev
```

## Variaveis uteis

- `CDK_DEFAULT_ACCOUNT`
- `CDK_DEFAULT_REGION`
- `NFE_FRONTEND_ORIGIN`

`NFE_FRONTEND_ORIGIN` e usado para compor a allowlist de CORS e o dominio esperado do frontend no ambiente.

## Arquitetura provisionada

```text
CloudFront + S3
        |
        v
API Gateway + Lambda Authorizer
   |                     |
   |                     +--> Cognito
   |
   +--> Lambda Faturamento (Go)
   +--> Lambda Estoque (.NET 8)
   +--> Lambda Estoque Consumer (Go)
   +--> Lambda PDF (Go)
   +--> Lambda Outbox Publisher (.NET 8)

DynamoDB main table
DynamoDB events table + Streams
EventBridge
SQS + DLQ
CloudWatch Alarms + Dashboard
X-Ray tracing
```

## Outputs relevantes

O stack expoe outputs usados pelos workflows e pelo frontend:

- `ApiFaturamentoUrl`
- `ApiEstoqueUrl`
- `CloudFrontUrl`
- `BucketName`
- `DistributionId`
- `UserPoolId`
- `UserPoolClientId`
- `ObservabilityDashboardName`

## Observabilidade provisionada

Hoje a infra gera:

- tracing em API Gateway e Lambdas;
- alarmes para erros das Lambdas principais;
- alarmes de latencia p95 das APIs;
- alarme para mensagens na DLQ;
- dashboard `nfe-observability-<env>`.

O proximo passo natural e enriquecer isso com metricas de negocio e tracing distribuido fim a fim com convencoes de span mais fortes.

## Seguranca aplicada

- Lambda Authorizer baseado em Cognito.
- CORS por allowlist explicita.
- exposicao de `X-Correlation-Id` nas respostas da API.
- IAM least privilege por Lambda.
- assets de frontend e APIs desacoplados por stack outputs, sem URLs fixas no codigo.

## Legado

O diretorio `lib/stacks` ainda contem stacks antigas de uma fase com ECS/RDS/RabbitMQ. Elas nao sao referenciadas pelo app `bin/nfe-infra-serverless.ts` e foram mantidas apenas como historico. Para deploy e manutencao, ignore:

- `compute-stack.ts`
- `database-stack.ts`
- `database-stack-serverless.ts`
- `loadbalancer-stack.ts`
- `messaging-stack.ts`
- `secrets-stack.ts`

Priorize sempre:

- `database-dynamodb-stack.ts`
- `messaging-stack-serverless.ts`
- `compute-stack-serverless.ts`
- `frontend-stack.ts`
- `auth-stack.ts`
