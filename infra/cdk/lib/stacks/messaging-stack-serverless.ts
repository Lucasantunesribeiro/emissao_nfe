import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface MessagingStackServerlessProps extends cdk.StackProps {
  config: InfraConfig;
}

/**
 * MessagingStackServerless: EventBridge como barramento central
 *
 * Substituição do Amazon MQ RabbitMQ ($28/mês) por EventBridge + SQS ($1.40/mês)
 *
 * Vantagens EventBridge:
 * - Serverless nativo (sem infraestrutura)
 * - Content-based routing (event patterns)
 * - Archive/Replay built-in
 * - Schema registry integrado
 * - Custo: $1/milhão eventos
 *
 * Pattern: Event-Driven Saga Coreografado
 * 1. Lambda Faturamento → publica evento no EventBridge
 * 2. EventBridge rule → roteia para SQS queue específica
 * 3. Lambda Estoque → consome SQS + publica resposta no EventBridge
 * 4. Loop continua até saga completar
 */
export class MessagingStackServerless extends cdk.Stack {
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: MessagingStackServerlessProps) {
    super(scope, id, props);

    const { config } = props;

    // EventBus customizado para NFe
    this.eventBus = new events.EventBus(this, 'NfeEventBus', {
      eventBusName: `nfe-events-${config.environment}`,
    });

    // Archive: guarda eventos por 90 dias (replay em caso de falha)
    new events.Archive(this, 'NfeEventArchive', {
      archiveName: `nfe-archive-${config.environment}`,
      sourceEventBus: this.eventBus,
      eventPattern: {
        account: [this.account],
      },
      retention: cdk.Duration.days(90),
    });

    // CloudWatch Logs: captura todos eventos para auditoria
    const eventLogGroup = new logs.LogGroup(this, 'EventLogGroup', {
      logGroupName: `/aws/events/nfe-${config.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Rule: captura todos eventos e envia para CloudWatch Logs
    new events.Rule(this, 'LogAllEventsRule', {
      ruleName: `nfe-log-all-events-${config.environment}`,
      eventBus: this.eventBus,
      eventPattern: {
        account: [this.account],
      },
      targets: [
        new targets.CloudWatchLogGroup(eventLogGroup),
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'EventBridge custom event bus name',
      exportName: `NfeEventBusName-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'EventBusArn', {
      value: this.eventBus.eventBusArn,
      description: 'EventBridge event bus ARN',
      exportName: `NfeEventBusArn-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'CostEstimate', {
      value: '$1/milhão eventos (~$1/mês para 1M eventos)',
      description: 'EventBridge monthly cost estimate',
    });

    new cdk.CfnOutput(this, 'ComparisonRabbitMq', {
      value: 'Economia: $27/mês vs Amazon MQ ($28/mês)',
      description: 'Cost saving vs RabbitMQ',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
