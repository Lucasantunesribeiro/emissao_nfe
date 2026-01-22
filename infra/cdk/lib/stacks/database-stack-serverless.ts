import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    // Ingress: Qualquer recurso dentro da VPC
    this.dbSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(5432),
      'Allow access from VPC resources (Lambda, etc)',
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
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
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

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
