import * as cdk from 'aws-cdk-lib';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface SecretsStackProps extends cdk.StackProps {
  config: InfraConfig;
}

export class SecretsStack extends cdk.Stack {
  public readonly dbSecret: secretsmanager.Secret;
  public readonly mqSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const { config } = props;

    // Secret para credenciais RDS PostgreSQL
    this.dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `nfe/db/credentials-${config.environment}`,
      description: 'RDS PostgreSQL master credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'nfeadmin',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
        requireEachIncludedType: true,
      },
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Secret para credenciais Amazon MQ (RabbitMQ)
    this.mqSecret = new secretsmanager.Secret(this, 'MqSecret', {
      secretName: `nfe/mq/credentials-${config.environment}`,
      description: 'Amazon MQ RabbitMQ credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'nfemqadmin',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
        requireEachIncludedType: true,
      },
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // Outputs
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.dbSecret.secretArn,
      description: 'Database credentials secret ARN',
      exportName: `NfeDbSecretArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'MqSecretArn', {
      value: this.mqSecret.secretArn,
      description: 'Amazon MQ credentials secret ARN',
      exportName: `NfeMqSecretArn-${config.environment}`,
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
