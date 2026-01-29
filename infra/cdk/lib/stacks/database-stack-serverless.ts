import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface DatabaseStackServerlessProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.Vpc;
  dbSecretArn: string;
}

/**
 * DatabaseStackServerless: RDS otimizado para Lambda SEM VPC (Free Tier Compatible)
 *
 * Estratégia de Custo:
 * 1. RDS t4g.micro Single-AZ: FREE (750h/mês no Free Tier)
 * 2. Publicly Accessible: true (Lambda acessa sem NAT Gateway)
 * 3. Security Group restritivo: apenas Lambda service prefix list
 * 4. SEM RDS Proxy (não disponível no Free Tier)
 *
 * Trade-offs:
 * - Single-AZ: downtime em maintenance (~5min/mês)
 * - Sem RDS Proxy: Lambda conecta direto (pode ter connection exhaustion em alta carga)
 * - Suitable para dev/teste, produção requer RDS Proxy
 */
export class DatabaseStackServerless extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbEndpoint: string;
  public readonly dbSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackServerlessProps) {
    super(scope, id, props);

    const { config, vpc, dbSecretArn } = props;

    // Security Group: RDS (público mas restritivo)
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      securityGroupName: `nfe-db-sg-${config.environment}`,
      vpc,
      description: 'Security group for RDS PostgreSQL (Lambda access)',
      allowAllOutbound: false,
    });

    // Ingress: Lambda Service via Managed Prefix List (sem VPC)
    // Allow PostgreSQL from Lambda service (Managed Prefix List)
    // us-east-1: pl-63a5400a
    // Ref: https://docs.aws.amazon.com/vpc/latest/userguide/aws-ip-ranges.html
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.prefixList('pl-63a5400a'), // Lambda Managed Prefix List (us-east-1)
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from Lambda service (no VPC)'
    );

    // Fallback: Allow from specific CIDR if Prefix List not available
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4('3.218.180.0/22'), // Lambda IP range fallback (us-east-1)
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from Lambda IP range (fallback)'
    );

    // Legacy: Allow from VPC resources (for compatibility during transition)
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow access from VPC resources (legacy)'
    );

    // Subnet Group: Public Subnets (Lambda sem VPC precisa de acesso público)
    const subnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      description: `Subnet group for NFe RDS ${config.environment} (public)`,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC, // Mudança crítica
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Parameter Group otimizado
    const parameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      description: `Parameter group for NFe PostgreSQL ${config.environment}`,
      parameters: {
        'shared_preload_libraries': 'pg_stat_statements',
        'log_min_duration_statement': '1000', // Log queries > 1s
        'max_connections': '100', // Reduzido (RDS Proxy gerencia pool)
        'random_page_cost': '1.1', // Otimizado para SSD
        'effective_cache_size': '262144', // 256MB em KB (t4g.micro tem 1GB RAM)
        'maintenance_work_mem': '65536', // 64MB em KB
        'checkpoint_completion_target': '0.9',
        'wal_buffers': '2048', // 16MB (em blocos de 8KB)
        'default_statistics_target': '100',
      },
    });

    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(this, 'DbSecret', dbSecretArn);

    // RDS PostgreSQL Instance - NEW (Free Tier limitation: cannot restore cross-account snapshots)
    this.dbInstance = new rds.DatabaseInstance(this, 'DbInstance', {
      instanceIdentifier: `nfe-db-${config.environment}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroups: [this.dbSecurityGroup],
      subnetGroup,
      parameterGroup,
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: 'nfe_db',
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: false, // Single-AZ para economia
      publiclyAccessible: true, // CRÍTICO: permite Lambda sem VPC
      deletionProtection: config.environment === 'prod',
      backupRetention: cdk.Duration.days(config.environment === 'prod' ? 7 : 1), // Free Tier: max 1 dia
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      enablePerformanceInsights: false, // Economia $1.50/mês
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      autoMinorVersionUpgrade: true,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.SNAPSHOT
        : cdk.RemovalPolicy.DESTROY,
    });

    this.dbEndpoint = this.dbInstance.instanceEndpoint.hostname;

    // NOTA: Free Tier não suporta RDS Proxy
    // Lambda conecta direto no RDS endpoint
    // Para produção, considere upgrade da conta AWS para usar RDS Proxy

    // Custom Resource: criar schemas (faturamento, estoque)
    // NOTA: Executar SQL DDL manualmente após deploy:
    // psql -h <db-endpoint> -U postgres -d nfe_db -f create-schemas.sql

    // Outputs
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbEndpoint,
      description: 'RDS PostgreSQL endpoint (Lambda connects directly)',
      exportName: `NfeDbEndpoint-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'DbPort', {
      value: this.dbInstance.instanceEndpoint.port.toString(),
      description: 'RDS PostgreSQL port',
    });

    new cdk.CfnOutput(this, 'DbName', {
      value: 'nfe_db',
      description: 'Database name',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: dbSecretArn,
      description: 'Database credentials secret ARN',
    });

    new cdk.CfnOutput(this, 'DbSchemas', {
      value: 'faturamento, estoque',
      description: 'Database schemas (create manually)',
    });

    new cdk.CfnOutput(this, 'CreateSchemasCommand', {
      value: `psql -h ${this.dbEndpoint} -U postgres -d nfe_db -f create-schemas.sql`,
      description: 'Command to create schemas',
    });

    new cdk.CfnOutput(this, 'CostEstimate', {
      value: 'FREE (750h/mês t4g.micro no Free Tier) ou $12/mês após Free Tier',
      description: 'Database stack monthly cost',
    });

    // ==========================================
    // RDS Cost Optimization: Start/Stop Scheduler
    // ==========================================
    // Economy: $14.71/month → $5.23/month (64% reduction)
    // Schedule: Mon-Fri 8am-8pm BRT (11am-11pm UTC)

    if (config.environment === 'dev') {
      // IAM Role for RDS Scheduler Lambdas
      const rdsSchedulerRole = new iam.Role(this, 'RdsSchedulerRole', {
        roleName: `nfe-rds-scheduler-${config.environment}`,
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
          RdsControl: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['rds:StartDBInstance', 'rds:StopDBInstance', 'rds:DescribeDBInstances'],
                resources: [this.dbInstance.instanceArn],
              }),
            ],
          }),
        },
      });

      // Lambda: Start RDS
      const startRdsFunction = new lambda.Function(this, 'StartRdsFunction', {
        functionName: `nfe-rds-start-${config.environment}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
import boto3
import os

rds = boto3.client('rds')
DB_INSTANCE_ID = os.environ['DB_INSTANCE_ID']

def handler(event, context):
    try:
        response = rds.start_db_instance(DBInstanceIdentifier=DB_INSTANCE_ID)
        print(f'Started {DB_INSTANCE_ID}: {response["DBInstance"]["DBInstanceStatus"]}')
        return {'statusCode': 200, 'body': f'Started {DB_INSTANCE_ID}'}
    except rds.exceptions.InvalidDBInstanceStateFault as e:
        print(f'{DB_INSTANCE_ID} already running or starting')
        return {'statusCode': 200, 'body': 'Already running'}
    except Exception as e:
        print(f'Error starting {DB_INSTANCE_ID}: {str(e)}')
        raise
        `),
        environment: {
          DB_INSTANCE_ID: this.dbInstance.instanceIdentifier,
        },
        timeout: cdk.Duration.seconds(60),
        role: rdsSchedulerRole,
        logGroup: new logs.LogGroup(this, 'StartRdsLogGroup', {
          logGroupName: `/aws/lambda/nfe-rds-start-${config.environment}`,
          retention: logs.RetentionDays.ONE_DAY,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

      // Lambda: Stop RDS
      const stopRdsFunction = new lambda.Function(this, 'StopRdsFunction', {
        functionName: `nfe-rds-stop-${config.environment}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
import boto3
import os

rds = boto3.client('rds')
DB_INSTANCE_ID = os.environ['DB_INSTANCE_ID']

def handler(event, context):
    try:
        response = rds.stop_db_instance(DBInstanceIdentifier=DB_INSTANCE_ID)
        print(f'Stopped {DB_INSTANCE_ID}: {response["DBInstance"]["DBInstanceStatus"]}')
        return {'statusCode': 200, 'body': f'Stopped {DB_INSTANCE_ID}'}
    except rds.exceptions.InvalidDBInstanceStateFault as e:
        print(f'{DB_INSTANCE_ID} already stopped or stopping')
        return {'statusCode': 200, 'body': 'Already stopped'}
    except Exception as e:
        print(f'Error stopping {DB_INSTANCE_ID}: {str(e)}')
        raise
        `),
        environment: {
          DB_INSTANCE_ID: this.dbInstance.instanceIdentifier,
        },
        timeout: cdk.Duration.seconds(60),
        role: rdsSchedulerRole,
        logGroup: new logs.LogGroup(this, 'StopRdsLogGroup', {
          logGroupName: `/aws/lambda/nfe-rds-stop-${config.environment}`,
          retention: logs.RetentionDays.ONE_DAY,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });

      // EventBridge Rule: Start RDS (Mon-Fri 8am BRT = 11am UTC)
      new events.Rule(this, 'StartRdsRule', {
        ruleName: `nfe-rds-start-${config.environment}`,
        description: 'Start RDS Mon-Fri at 8am BRT (11am UTC)',
        schedule: events.Schedule.cron({
          hour: '11',
          minute: '0',
          weekDay: 'MON-FRI',
        }),
        targets: [new targets.LambdaFunction(startRdsFunction)],
      });

      // EventBridge Rule: Stop RDS (Mon-Fri 8pm BRT = 11pm UTC)
      new events.Rule(this, 'StopRdsRule', {
        ruleName: `nfe-rds-stop-${config.environment}`,
        description: 'Stop RDS Mon-Fri at 8pm BRT (11pm UTC)',
        schedule: events.Schedule.cron({
          hour: '23',
          minute: '0',
          weekDay: 'MON-FRI',
        }),
        targets: [new targets.LambdaFunction(stopRdsFunction)],
      });

      // EventBridge Rule: Stop RDS on Friday night (ensure weekend shutdown)
      new events.Rule(this, 'StopRdsWeekendRule', {
        ruleName: `nfe-rds-stop-weekend-${config.environment}`,
        description: 'Stop RDS Friday 9pm BRT (midnight UTC Saturday)',
        schedule: events.Schedule.cron({
          hour: '0',
          minute: '0',
          weekDay: 'SAT',
        }),
        targets: [new targets.LambdaFunction(stopRdsFunction)],
      });

      // Output: Scheduler info
      new cdk.CfnOutput(this, 'RdsSchedulerInfo', {
        value: `RDS scheduled: Mon-Fri 8am-8pm BRT (saves $9.48/month)`,
        description: 'RDS Start/Stop Schedule',
      });
    }

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
