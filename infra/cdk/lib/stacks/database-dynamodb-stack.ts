import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface DatabaseDynamoDBStackProps extends cdk.StackProps {
  config: InfraConfig;
}

/**
 * DatabaseDynamoDBStack: DynamoDB tables for NFe system (100% Free Tier)
 *
 * Architecture:
 * - Main Table: Stores Notas Fiscais, Produtos, Reservas (Single-Table Design)
 * - Events Table: Outbox pattern + Idempotency with TTL (7 days auto-cleanup)
 *
 * Cost Optimization:
 * - PAY_PER_REQUEST billing mode (Free Tier: 25 GB + 25 WCU/RCU permanently)
 * - No provisioned capacity charges
 * - TTL for automatic event cleanup (no manual cleanup Lambda needed)
 *
 * Free Tier: $0/month (25 GB storage + 25 WCU/RCU)
 * After Free Tier: ~$0.28/month for typical dev workload
 */
export class DatabaseDynamoDBStack extends cdk.Stack {
  public readonly mainTable: dynamodb.Table;
  public readonly eventsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatabaseDynamoDBStackProps) {
    super(scope, id, props);

    const { config } = props;
    const env = config.environment;

    // ==========================================
    // Main Table: Notas, Produtos, Reservas
    // ==========================================
    this.mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: `nfe-main-table-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: env === 'prod',
      removalPolicy: env === 'dev' ? cdk.RemovalPolicy.DESTROY : cdk.RemovalPolicy.RETAIN,
      deletionProtection: env === 'prod',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // For CDC/auditing if needed
    });

    // GSI1: Lookup by Numero (Invoice) or SKU (Product)
    // Pattern: Query by unique business identifiers
    // Example: Find nota by numero, find produto by SKU
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1_PK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2: Filter by Status + Time Range
    // Pattern: List items by status, optionally filtered by date
    // Example: Find all ABERTA notas, find all ATIVO produtos
    this.mainTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2_PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2_SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ==========================================
    // Events Table: Outbox + Idempotency
    // ==========================================
    this.eventsTable = new dynamodb.Table(this, 'EventsTable', {
      tableName: `nfe-events-${env}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      timeToLiveAttribute: 'TTL', // Auto-delete old events after 7 days
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Always safe to recreate events table
      stream: dynamodb.StreamViewType.NEW_IMAGE, // For EventBridge integration
    });

    // ==========================================
    // Outputs
    // ==========================================
    new cdk.CfnOutput(this, 'MainTableName', {
      value: this.mainTable.tableName,
      description: 'DynamoDB main table name',
      exportName: `NfeMainTable-${env}`,
    });

    new cdk.CfnOutput(this, 'MainTableArn', {
      value: this.mainTable.tableArn,
      description: 'DynamoDB main table ARN',
    });

    new cdk.CfnOutput(this, 'EventsTableName', {
      value: this.eventsTable.tableName,
      description: 'DynamoDB events table name',
      exportName: `NfeEventsTable-${env}`,
    });

    new cdk.CfnOutput(this, 'EventsTableArn', {
      value: this.eventsTable.tableArn,
      description: 'DynamoDB events table ARN',
    });

    new cdk.CfnOutput(this, 'GSI1IndexName', {
      value: 'GSI1',
      description: 'GSI1 index name (lookup by numero/sku)',
    });

    new cdk.CfnOutput(this, 'GSI2IndexName', {
      value: 'GSI2',
      description: 'GSI2 index name (filter by status)',
    });

    new cdk.CfnOutput(this, 'CostEstimate', {
      value: 'FREE (DynamoDB Free Tier: 25 GB + 25 WCU/RCU permanently)',
      description: 'Monthly cost estimate',
    });

    new cdk.CfnOutput(this, 'DataModel', {
      value: JSON.stringify({
        mainTable: {
          'NOTA#{uuid}#METADATA': 'Nota Fiscal metadata',
          'NOTA#{uuid}#ITEM#{uuid}': 'Item da nota',
          'NOTA#{uuid}#PRINT#{uuid}': 'Solicitação de impressão',
          'PRODUTO#{uuid}#METADATA': 'Produto metadata',
          'RESERVA#{uuid}#METADATA': 'Reserva de estoque',
        },
        eventsTable: {
          'OUTBOX#{timestamp}#{id}': 'Outbox event (TTL 7 days)',
          'IDEM#{id_mensagem}#METADATA': 'Idempotency check (TTL 7 days)',
        },
      }, null, 2),
      description: 'DynamoDB data model keys',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });

    cdk.Tags.of(this.mainTable).add('CostAllocation', 'Database-Main');
    cdk.Tags.of(this.eventsTable).add('CostAllocation', 'Database-Events');
  }
}
