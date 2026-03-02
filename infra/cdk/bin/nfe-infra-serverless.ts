#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { devConfig } from '../lib/config/dev';
import { prodConfig } from '../lib/config/prod';
import { NetworkStack } from '../lib/stacks/network-stack';
// import { SecretsStack } from '../lib/stacks/secrets-stack'; // Removido: não usado no serverless
import { AuthStack } from '../lib/stacks/auth-stack';
import { DatabaseDynamoDBStack } from '../lib/stacks/database-dynamodb-stack';
import { MessagingStackServerless } from '../lib/stacks/messaging-stack-serverless';
import { ComputeStackServerless } from '../lib/stacks/compute-stack-serverless';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import { CostGuardrailsAspect } from '../lib/aspects/cost-guardrails';

const app = new cdk.App();

// Get environment from context (default: dev)
const environment = app.node.tryGetContext('env') || 'dev';
const config = environment === 'prod' ? prodConfig : devConfig;

console.log(`\n🚀 Deploying NFe SERVERLESS Infrastructure - Environment: ${environment.toUpperCase()}`);
console.log(`   Region: ${config.region}`);
console.log(`   Account: ${process.env.CDK_DEFAULT_ACCOUNT || 'default'}`);
console.log(`   Architecture: Lambda + API Gateway + EventBridge (FREE TIER)`);
console.log(`   Cost Estimate: ~$3/mês no Free Tier, ~$33/mês após (83% economia vs ECS)`);
console.log(`   NAT Gateway: ELIMINADO (Lambda em VPC pública, sem necessidade de NAT)`);
console.log(`   RabbitMQ: ELIMINADO (EventBridge + SQS)`);
console.log(`   RDS Proxy: ELIMINADO (Lambda conecta direto - Free Tier)\n`);

// Stack properties
const stackProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  description: `NFe System Serverless Infrastructure - ${environment}`,
};

// 1. Network Stack (VPC simples - só para RDS)
const networkStack = new NetworkStack(app, `NfeNetworkServerless-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-network-serverless-${environment}`,
});

// 2. Secrets Stack removido - não é usado na arquitetura serverless (DynamoDB + EventBridge)
// Economia: $0.80/mês (2 secrets × $0.40/secret)

// 3. Auth Stack (Cognito User Pool) - TODO: Desabilitado temporariamente
// const authStack = new AuthStack(app, `NfeAuthServerless-${environment}`, {
//   ...stackProps,
//   config,
//   stackName: `nfe-auth-serverless-${environment}`,
// });

// 4. Database Stack DynamoDB (100% Free Tier)
const databaseStack = new DatabaseDynamoDBStack(app, `NfeDatabaseDynamoDB-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-database-dynamodb-${environment}`,
});

// 4. Messaging Stack Serverless (EventBridge)
const messagingStack = new MessagingStackServerless(app, `NfeMessagingServerless-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-messaging-serverless-${environment}`,
});

// 5. Frontend Stack (S3 + CloudFront) - criado antes para fornecer bucket name
const frontendStack = new FrontendStack(app, `NfeFrontendServerless-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-frontend-serverless-${environment}`,
});

// 6. Compute Stack Serverless (Lambda + API Gateway + DynamoDB)
// TODO: Autenticação desabilitada temporariamente - habilitar quando AuthStack estiver funcionando
const computeStack = new ComputeStackServerless(app, `NfeComputeServerless-${environment}`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  mainTable: databaseStack.mainTable,
  eventsTable: databaseStack.eventsTable,
  eventBus: messagingStack.eventBus,
  frontendBucketName: frontendStack.bucket.bucketName,
  cloudFrontDomain: frontendStack.distribution.distributionDomainName,
  // userPoolId: authStack.userPool.userPoolId, // Desabilitado
  // userPoolClientId: authStack.userPoolClient.userPoolClientId, // Desabilitado
  stackName: `nfe-compute-serverless-${environment}`,
});
computeStack.addDependency(databaseStack);
computeStack.addDependency(messagingStack);
computeStack.addDependency(frontendStack); // Dependência do frontend para obter bucket name
// computeStack.addDependency(authStack); // Desabilitado

// Cost Summary Output (Free Tier Optimized - DynamoDB)
new cdk.CfnOutput(computeStack, 'CostBreakdown', {
  value: JSON.stringify({
    lambda: 'FREE (1M req/mês)',
    apiGateway: 'FREE (1M req/mês)',
    dynamodb: 'FREE (25 GB + 25 WCU/RCU permanente)',
    eventBridge: 'FREE (até 100k eventos)',
    s3CloudFront: '~$1-2/mês (storage)',
    totalFreeTier: '~$0-2/mês',
    savings: '100% database cost (RDS eliminated)',
  }, null, 2),
  description: 'Monthly cost breakdown (DynamoDB Free Tier)',
});

// ==========================================
// Cost Guardrails (DEV only)
// ==========================================
if (environment === 'dev') {
  cdk.Aspects.of(app).add(new CostGuardrailsAspect(environment));
  console.log('✅ Cost Guardrails ENABLED for DEV environment');
}

// ==========================================
// Cost Allocation Tags (Global)
// ==========================================
cdk.Tags.of(app).add('Project', 'NFe-System');
cdk.Tags.of(app).add('Environment', environment);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('CostCenter', environment === 'prod' ? 'Production' : 'Development');
cdk.Tags.of(app).add('Owner', 'lucas.ferreira');
cdk.Tags.of(app).add('DeploymentMode', 'serverless');

app.synth();
