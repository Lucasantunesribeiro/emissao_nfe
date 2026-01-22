import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface NetworkStackProps extends cdk.StackProps {
  config: InfraConfig;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly ecsSecurityGroup: ec2.SecurityGroup;
  public readonly rdsSecurityGroup: ec2.SecurityGroup;
  public readonly mqSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { config } = props;

    // VPC com 2 AZs, subnets públicas e privadas
    this.vpc = new ec2.Vpc(this, 'NfeVpc', {
      vpcName: `nfe-vpc-${config.environment}`,
      ipAddresses: ec2.IpAddresses.cidr(config.vpc.cidr),
      maxAzs: config.vpc.maxAzs,
      natGateways: config.vpc.natGateways,
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private-App',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Private-Data',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // VPC Flow Logs (opcional para prod)
    if (config.vpc.enableFlowLogs) {
      const logGroup = new cdk.aws_logs.LogGroup(this, 'VpcFlowLogsGroup', {
        logGroupName: `/aws/vpc/nfe-${config.environment}`,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      new ec2.FlowLog(this, 'VpcFlowLog', {
        resourceType: ec2.FlowLogResourceType.fromVpc(this.vpc),
        destination: ec2.FlowLogDestination.toCloudWatchLogs(logGroup),
        trafficType: ec2.FlowLogTrafficType.ALL,
      });
    }

    // Security Group: Application Load Balancer
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `nfe-alb-sg-${config.environment}`,
      description: 'Security group for Application Load Balancer',
      allowAllOutbound: true,
    });

    // ALB: Allow HTTP/HTTPS from internet
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from internet'
    );
    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from internet'
    );

    // Security Group: ECS Services
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `nfe-ecs-sg-${config.environment}`,
      description: 'Security group for ECS Fargate tasks',
      allowAllOutbound: true,
    });

    // ECS: Allow traffic from ALB only
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(config.ecs.faturamento.containerPort),
      'Allow traffic from ALB to Faturamento service'
    );
    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(config.ecs.estoque.containerPort),
      'Allow traffic from ALB to Estoque service'
    );

    // Security Group: RDS PostgreSQL
    this.rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `nfe-rds-sg-${config.environment}`,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });

    // RDS: Allow PostgreSQL from ECS only
    this.rdsSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS tasks'
    );

    // Security Group: Amazon MQ (RabbitMQ)
    this.mqSecurityGroup = new ec2.SecurityGroup(this, 'MqSecurityGroup', {
      vpc: this.vpc,
      securityGroupName: `nfe-mq-sg-${config.environment}`,
      description: 'Security group for Amazon MQ RabbitMQ',
      allowAllOutbound: false,
    });

    // MQ: Allow AMQPS (5671) from ECS only
    this.mqSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5671),
      'Allow AMQPS from ECS tasks'
    );

    // MQ: Allow Management Console (15671) from ECS (opcional)
    this.mqSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(15671),
      'Allow RabbitMQ Management from ECS tasks'
    );

    // ============================================
    // VPC Endpoints (Serverless Mode)
    // ============================================
    // Quando natGateways = 0 (serverless), Lambda precisa de VPC Endpoints
    // para acessar serviços AWS (EventBridge, SQS, etc) sem internet
    if (config.vpc.natGateways === 0) {
      // Security Group para VPC Endpoints
      const vpcEndpointSecurityGroup = new ec2.SecurityGroup(this, 'VpcEndpointSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `nfe-vpce-sg-${config.environment}`,
        description: 'Security group for VPC Endpoints',
        allowAllOutbound: false,
      });

      // Allow HTTPS from Lambda/ECS Security Group
      vpcEndpointSecurityGroup.addIngressRule(
        this.ecsSecurityGroup,
        ec2.Port.tcp(443),
        'Allow HTTPS from Lambda/ECS to VPC Endpoints'
      );

      // VPC Endpoint: EventBridge
      const eventBridgeEndpoint = new ec2.InterfaceVpcEndpoint(this, 'EventBridgeEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE,
        subnets: {
          subnetType: ec2.SubnetType.PUBLIC, // Lambda está em public subnet
        },
        securityGroups: [vpcEndpointSecurityGroup],
        privateDnsEnabled: true,
      });

      // VPC Endpoint: SQS
      const sqsEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SqsEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.SQS,
        subnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        securityGroups: [vpcEndpointSecurityGroup],
        privateDnsEnabled: true,
      });

      // VPC Endpoint: Secrets Manager (opcional, mas útil)
      const secretsManagerEndpoint = new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        subnets: {
          subnetType: ec2.SubnetType.PUBLIC,
        },
        securityGroups: [vpcEndpointSecurityGroup],
        privateDnsEnabled: true,
      });

      // VPC Gateway Endpoint: S3 (FREE - sem custo adicional)
      const s3Endpoint = this.vpc.addGatewayEndpoint('S3Endpoint', {
        service: ec2.GatewayVpcEndpointAwsService.S3,
        subnets: [
          { subnetType: ec2.SubnetType.PUBLIC },
          { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
          { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        ],
      });

      // Output: VPC Endpoints
      new cdk.CfnOutput(this, 'VpcEndpoints', {
        value: JSON.stringify({
          eventBridge: eventBridgeEndpoint.vpcEndpointId,
          sqs: sqsEndpoint.vpcEndpointId,
          secretsManager: secretsManagerEndpoint.vpcEndpointId,
          s3: s3Endpoint.vpcEndpointId,
        }),
        description: 'VPC Endpoint IDs for Serverless Mode (NAT Gateway = 0)',
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'VpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: `NfeVpcId-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'VpcCidr', {
      value: this.vpc.vpcCidrBlock,
      description: 'VPC CIDR Block',
    });

    new cdk.CfnOutput(this, 'PublicSubnets', {
      value: this.vpc.publicSubnets.map((s) => s.subnetId).join(','),
      description: 'Public Subnet IDs',
    });

    new cdk.CfnOutput(this, 'PrivateSubnets', {
      value: this.vpc.privateSubnets.map((s) => s.subnetId).join(','),
      description: 'Private Subnet IDs',
    });

    new cdk.CfnOutput(this, 'IsolatedSubnets', {
      value: this.vpc.isolatedSubnets.map((s) => s.subnetId).join(','),
      description: 'Isolated Subnet IDs',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
