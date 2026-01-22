import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface ComputeStackProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
  dbSecret: secretsmanager.Secret;
  mqSecret: secretsmanager.Secret;
  dbEndpoint: string;
  mqEndpoint: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly faturamentoService: ecs.FargateService;
  public readonly estoqueService: ecs.FargateService;
  public readonly faturamentoRepository: ecr.Repository;
  public readonly estoqueRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { config, vpc, securityGroup, dbSecret, mqSecret, dbEndpoint, mqEndpoint } = props;

    // ECR Repositories
    this.faturamentoRepository = new ecr.Repository(this, 'FaturamentoRepo', {
      repositoryName: `nfe-faturamento-${config.environment}`,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep last 10 images',
        },
      ],
    });

    this.estoqueRepository = new ecr.Repository(this, 'EstoqueRepo', {
      repositoryName: `nfe-estoque-${config.environment}`,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE,
      lifecycleRules: [
        {
          maxImageCount: 10,
          description: 'Keep last 10 images',
        },
      ],
    });

    // ECS Cluster
    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName: `nfe-cluster-${config.environment}`,
      vpc,
      containerInsights: config.environment === 'prod',
      enableFargateCapacityProviders: true,
    });

    // CloudWatch Log Groups
    const faturamentoLogGroup = new logs.LogGroup(this, 'FaturamentoLogGroup', {
      logGroupName: `/ecs/nfe-faturamento-${config.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const estoqueLogGroup = new logs.LogGroup(this, 'EstoqueLogGroup', {
      logGroupName: `/ecs/nfe-estoque-${config.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Task Execution Role (para pull ECR, read secrets, write logs)
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Grant read secrets
    dbSecret.grantRead(taskExecutionRole);
    mqSecret.grantRead(taskExecutionRole);

    // Task Definitions: Faturamento (GO)
    const faturamentoTaskDef = new ecs.FargateTaskDefinition(this, 'FaturamentoTaskDef', {
      family: `nfe-faturamento-${config.environment}`,
      cpu: config.ecs.faturamento.cpu,
      memoryLimitMiB: config.ecs.faturamento.memory,
      executionRole: taskExecutionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const faturamentoContainer = faturamentoTaskDef.addContainer('faturamento', {
      image: ecs.ContainerImage.fromEcrRepository(this.faturamentoRepository, 'latest'),
      containerName: 'faturamento',
      logging: ecs.LogDriver.awsLogs({
        logGroup: faturamentoLogGroup,
        streamPrefix: 'ecs',
      }),
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        DB_HOST: dbEndpoint,
        DB_PORT: '5432',
        DB_NAME: 'nfe_db',
        DB_SCHEMA: 'faturamento',
        DB_SSLMODE: 'require',
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        // NOTA: Criar manualmente secret "nfe/mq/url-<env>" com formato:
        // amqps://username:password@broker-endpoint:5671/
        RABBITMQ_URL: ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretNameV2(this, 'RabbitMqUrl', `nfe/mq/url-${config.environment}`)
        ),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    faturamentoContainer.addPortMappings({
      containerPort: config.ecs.faturamento.containerPort,
      protocol: ecs.Protocol.TCP,
    });

    // Task Definitions: Estoque (.NET)
    const estoqueTaskDef = new ecs.FargateTaskDefinition(this, 'EstoqueTaskDef', {
      family: `nfe-estoque-${config.environment}`,
      cpu: config.ecs.estoque.cpu,
      memoryLimitMiB: config.ecs.estoque.memory,
      executionRole: taskExecutionRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const estoqueContainer = estoqueTaskDef.addContainer('estoque', {
      image: ecs.ContainerImage.fromEcrRepository(this.estoqueRepository, 'latest'),
      containerName: 'estoque',
      logging: ecs.LogDriver.awsLogs({
        logGroup: estoqueLogGroup,
        streamPrefix: 'ecs',
      }),
      environment: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        ASPNETCORE_URLS: 'http://+:5000',
        Logging__LogLevel__Default: 'Information',
        DB_SCHEMA: 'estoque',
        RabbitMQ__Port: '5671',
        RabbitMQ__UseSsl: 'true',
      },
      secrets: {
        // NOTA: Criar manualmente secret "nfe/db/connstring-estoque-<env>" com formato:
        // Host=xxx;Port=5432;Database=nfe_db;Username=xxx;Password=xxx;SSL Mode=Require;Search Path=estoque
        ConnectionStrings__DefaultConnection: ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretNameV2(this, 'DbConnStringEstoque', `nfe/db/connstring-estoque-${config.environment}`)
        ),
        RabbitMQ__Username: ecs.Secret.fromSecretsManager(mqSecret, 'username'),
        RabbitMQ__Password: ecs.Secret.fromSecretsManager(mqSecret, 'password'),
        // NOTA: Criar manualmente secret "nfe/mq/host-<env>" com endpoint do broker
        RabbitMQ__Host: ecs.Secret.fromSecretsManager(
          secretsmanager.Secret.fromSecretNameV2(this, 'RabbitMqHost', `nfe/mq/host-${config.environment}`)
        ),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:5000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    estoqueContainer.addPortMappings({
      containerPort: config.ecs.estoque.containerPort,
      protocol: ecs.Protocol.TCP,
    });

    // Fargate Services (target groups will be created in LoadBalancerStack)
    this.faturamentoService = new ecs.FargateService(this, 'FaturamentoService', {
      serviceName: `nfe-faturamento-${config.environment}`,
      cluster: this.cluster,
      taskDefinition: faturamentoTaskDef,
      desiredCount: config.ecs.faturamento.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableExecuteCommand: config.environment === 'dev',
      circuitBreaker: {
        rollback: true,
      },
    });

    this.estoqueService = new ecs.FargateService(this, 'EstoqueService', {
      serviceName: `nfe-estoque-${config.environment}`,
      cluster: this.cluster,
      taskDefinition: estoqueTaskDef,
      desiredCount: config.ecs.estoque.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      securityGroups: [securityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      enableExecuteCommand: config.environment === 'dev',
      circuitBreaker: {
        rollback: true,
      },
    });

    // Services will be attached to target groups in LoadBalancerStack to avoid circular dependency

    // Auto Scaling (opcional)
    if (config.autoScaling.enabled) {
      const faturamentoScaling = this.faturamentoService.autoScaleTaskCount({
        minCapacity: config.ecs.faturamento.minCapacity,
        maxCapacity: config.ecs.faturamento.maxCapacity,
      });

      faturamentoScaling.scaleOnCpuUtilization('FaturamentoCpuScaling', {
        targetUtilizationPercent: config.autoScaling.targetCpuUtilization,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });

      const estoqueScaling = this.estoqueService.autoScaleTaskCount({
        minCapacity: config.ecs.estoque.minCapacity,
        maxCapacity: config.ecs.estoque.maxCapacity,
      });

      estoqueScaling.scaleOnCpuUtilization('EstoqueCpuScaling', {
        targetUtilizationPercent: config.autoScaling.targetCpuUtilization,
        scaleInCooldown: cdk.Duration.seconds(60),
        scaleOutCooldown: cdk.Duration.seconds(60),
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster name',
      exportName: `NfeClusterName-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'FaturamentoRepoUri', {
      value: this.faturamentoRepository.repositoryUri,
      description: 'Faturamento ECR repository URI',
    });

    new cdk.CfnOutput(this, 'EstoqueRepoUri', {
      value: this.estoqueRepository.repositoryUri,
      description: 'Estoque ECR repository URI',
    });

    new cdk.CfnOutput(this, 'FaturamentoServiceName', {
      value: this.faturamentoService.serviceName,
      description: 'Faturamento ECS service name',
    });

    new cdk.CfnOutput(this, 'EstoqueServiceName', {
      value: this.estoqueService.serviceName,
      description: 'Estoque ECS service name',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
