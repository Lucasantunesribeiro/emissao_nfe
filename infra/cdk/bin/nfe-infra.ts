#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { devConfig } from '../lib/config/dev';
import { prodConfig } from '../lib/config/prod';
import { NetworkStack } from '../lib/stacks/network-stack';
import { SecretsStack } from '../lib/stacks/secrets-stack';
import { DatabaseStack } from '../lib/stacks/database-stack';
import { MessagingStack } from '../lib/stacks/messaging-stack';
import { ComputeStack } from '../lib/stacks/compute-stack';
import { LoadBalancerStack } from '../lib/stacks/loadbalancer-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Get environment from context (default: dev)
const environment = app.node.tryGetContext('environment') || 'dev';
const config = environment === 'prod' ? prodConfig : devConfig;

console.log(`\n🚀 Deploying NFe Infrastructure - Environment: ${environment.toUpperCase()}`);
console.log(`   Region: ${config.region}`);
console.log(`   Account: ${process.env.CDK_DEFAULT_ACCOUNT || 'default'}`);
console.log(`   Multi-AZ: ${config.database.multiAz ? 'Yes' : 'No'}`);
console.log(`   Auto Scaling: ${config.autoScaling.enabled ? 'Enabled' : 'Disabled'}\n`);

// Stack properties
const stackProps: cdk.StackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: config.region,
  },
  description: `NFe System Infrastructure - ${environment}`,
};

// 1. Network Stack (VPC, Security Groups)
const networkStack = new NetworkStack(app, `NfeNetworkStack-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-network-${environment}`,
});

// 2. Secrets Stack (Secrets Manager)
const secretsStack = new SecretsStack(app, `NfeSecretsStack-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-secrets-${environment}`,
});

// 3. Database Stack (RDS PostgreSQL)
const databaseStack = new DatabaseStack(app, `NfeDatabaseStack-${environment}`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  securityGroup: networkStack.rdsSecurityGroup,
  dbSecretArn: secretsStack.dbSecret.secretArn,
  stackName: `nfe-database-${environment}`,
});
databaseStack.addDependency(networkStack);

// 4. Messaging Stack (Amazon MQ RabbitMQ)
const messagingStack = new MessagingStack(app, `NfeMessagingStack-${environment}`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  securityGroup: networkStack.mqSecurityGroup,
  mqSecret: secretsStack.mqSecret,
  stackName: `nfe-messaging-${environment}`,
});
messagingStack.addDependency(networkStack);
messagingStack.addDependency(secretsStack);

// 5. Compute Stack (ECS Fargate, ECR)
const computeStack = new ComputeStack(app, `NfeComputeStack-${environment}`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  securityGroup: networkStack.ecsSecurityGroup,
  dbSecret: secretsStack.dbSecret,
  mqSecret: secretsStack.mqSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  mqEndpoint: messagingStack.mqEndpoint,
  stackName: `nfe-compute-${environment}`,
});
computeStack.addDependency(networkStack);
computeStack.addDependency(secretsStack);
computeStack.addDependency(databaseStack);
computeStack.addDependency(messagingStack);

// 6. Load Balancer Stack (ALB)
const loadBalancerStack = new LoadBalancerStack(app, `NfeLoadBalancerStack-${environment}`, {
  ...stackProps,
  config,
  vpc: networkStack.vpc,
  albSecurityGroup: networkStack.albSecurityGroup,
  faturamentoService: computeStack.faturamentoService,
  estoqueService: computeStack.estoqueService,
  stackName: `nfe-loadbalancer-${environment}`,
});


// 7. Frontend Stack (S3 + CloudFront)
const frontendStack = new FrontendStack(app, `NfeFrontendStack-${environment}`, {
  ...stackProps,
  config,
  stackName: `nfe-frontend-${environment}`,
});

app.synth();
