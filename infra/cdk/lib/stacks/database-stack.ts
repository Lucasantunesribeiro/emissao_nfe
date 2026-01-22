import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface DatabaseStackProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.Vpc;
  securityGroup: ec2.SecurityGroup;
  dbSecretArn: string;
}

export class DatabaseStack extends cdk.Stack {
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { config, vpc, securityGroup, dbSecretArn } = props;

    // Subnet Group para RDS (subnets isoladas)
    const subnetGroup = new rds.SubnetGroup(this, 'DbSubnetGroup', {
      description: `Subnet group for NFe RDS ${config.environment}`,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Parameter Group customizado
    const parameterGroup = new rds.ParameterGroup(this, 'DbParameterGroup', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      description: `Parameter group for NFe PostgreSQL ${config.environment}`,
      parameters: {
        'shared_preload_libraries': 'pg_stat_statements',
        'log_statement': 'all',
        'log_min_duration_statement': '1000', // Log queries > 1s
        'max_connections': '200',
      },
    });

    // RDS PostgreSQL Instance
    this.dbInstance = new rds.DatabaseInstance(this, 'DbInstance', {
      instanceIdentifier: `nfe-db-${config.environment}`,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        config.database.instanceType === 'db.t4g.micro'
          ? ec2.InstanceSize.MICRO
          : ec2.InstanceSize.SMALL
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroup],
      subnetGroup,
      parameterGroup,
      credentials: rds.Credentials.fromSecret(secretsmanager.Secret.fromSecretNameV2(this, 'DbSecret', dbSecretArn)),
      databaseName: 'nfe_db',
      allocatedStorage: config.database.allocatedStorage,
      maxAllocatedStorage: config.database.maxAllocatedStorage,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      multiAz: config.database.multiAz,
      publiclyAccessible: false,
      deletionProtection: config.database.deletionProtection,
      backupRetention: cdk.Duration.days(config.database.backupRetention),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      enablePerformanceInsights: config.database.enablePerformanceInsights,
      performanceInsightRetention: config.database.enablePerformanceInsights
        ? rds.PerformanceInsightRetention.DEFAULT
        : undefined,
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
      autoMinorVersionUpgrade: true,
      removalPolicy: config.environment === 'prod'
        ? cdk.RemovalPolicy.SNAPSHOT
        : cdk.RemovalPolicy.DESTROY,
    });

    this.dbEndpoint = this.dbInstance.instanceEndpoint.hostname;

    // Custom Resource para criar schemas (faturamento e estoque)
    // NOTA: Executar SQL DDL manualmente ou via migration script
    // Ver: /infra/scripts/create-schemas.sql

    // Outputs
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbEndpoint,
      description: 'RDS PostgreSQL endpoint',
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
      value: config.database.schemas.join(', '),
      description: 'Database schemas (create manually)',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
