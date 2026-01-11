import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as mq from 'aws-cdk-lib/aws-amazonmq';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface MessagingStackProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
  mqSecret: secretsmanager.Secret;
}

export class MessagingStack extends cdk.Stack {
  public readonly mqBroker: mq.CfnBroker;
  public readonly mqEndpoint: string;

  constructor(scope: Construct, id: string, props: MessagingStackProps) {
    super(scope, id, props);

    const { config, vpc, securityGroup, mqSecret } = props;

    // Obter credenciais do secret
    const username = mqSecret.secretValueFromJson('username').unsafeUnwrap();
    const password = mqSecret.secretValueFromJson('password').unsafeUnwrap();

    // Selecionar subnets privadas (1 ou 2 dependendo do deployment mode)
    const privateSubnets = vpc.selectSubnets({
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    }).subnetIds;

    const subnetIds = config.messaging.deploymentMode === 'SINGLE_INSTANCE'
      ? [privateSubnets[0]]
      : [privateSubnets[0], privateSubnets[1]];

    // Amazon MQ RabbitMQ Broker
    this.mqBroker = new mq.CfnBroker(this, 'MqBroker', {
      brokerName: `nfe-rabbitmq-${config.environment}`,
      engineType: config.messaging.engine,
      engineVersion: config.messaging.engineVersion,
      hostInstanceType: config.messaging.instanceType,
      deploymentMode: config.messaging.deploymentMode,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: config.messaging.autoMinorVersionUpgrade,
      subnetIds,
      securityGroups: [securityGroup.securityGroupId],
      users: [
        {
          username,
          password,
          consoleAccess: true,
        },
      ],
      logs: {
        general: true,
      },
      encryptionOptions: {
        useAwsOwnedKey: true,
      },
    });

    // NOTA: Endpoint AMQPS será disponível após deploy
    // Formato: b-xxxxx.mq.region.amazonaws.com:5671
    this.mqEndpoint = cdk.Fn.select(
      0,
      this.mqBroker.attrAmqpEndpoints
    );

    // Outputs
    new cdk.CfnOutput(this, 'MqBrokerId', {
      value: this.mqBroker.ref,
      description: 'Amazon MQ Broker ID',
      exportName: `NfeMqBrokerId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'MqAmqpsEndpoint', {
      value: this.mqEndpoint,
      description: 'Amazon MQ AMQPS endpoint (port 5671)',
    });

    new cdk.CfnOutput(this, 'MqConsoleUrl', {
      value: `https://console.aws.amazon.com/amazon-mq/home?region=${config.region}#/brokers/${this.mqBroker.ref}`,
      description: 'Amazon MQ Management Console URL',
    });

    new cdk.CfnOutput(this, 'MqSecretArn', {
      value: mqSecret.secretArn,
      description: 'Amazon MQ credentials secret ARN',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
