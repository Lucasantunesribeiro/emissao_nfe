import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface LoadBalancerStackProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.Vpc;
  albSecurityGroup: ec2.SecurityGroup;
  faturamentoService: ecs.FargateService;
  estoqueService: ecs.FargateService;
}

export class LoadBalancerStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albDnsName: string;

  constructor(scope: Construct, id: string, props: LoadBalancerStackProps) {
    super(scope, id, props);

    const { config, vpc, albSecurityGroup, faturamentoService, estoqueService } = props;

    // Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: `nfe-alb-${config.environment}`,
      vpc,
      internetFacing: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: albSecurityGroup,
      http2Enabled: config.alb.http2Enabled,
      idleTimeout: cdk.Duration.seconds(config.alb.idleTimeout),
      deletionProtection: config.alb.deletionProtection,
    });

    this.albDnsName = this.alb.loadBalancerDnsName;

    // Target Groups (created here to properly attach services)
    const faturamentoTargetGroup = new elbv2.ApplicationTargetGroup(this, 'FaturamentoTargetGroup', {
      targetGroupName: `nfe-faturamento-tg-${config.environment}`,
      vpc,
      port: config.ecs.faturamento.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [faturamentoService],
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const estoqueTargetGroup = new elbv2.ApplicationTargetGroup(this, 'EstoqueTargetGroup', {
      targetGroupName: `nfe-estoque-tg-${config.environment}`,
      vpc,
      port: config.ecs.estoque.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      targets: [estoqueService],
      healthCheck: {
        enabled: true,
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        healthyHttpCodes: '200',
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    // HTTP Listener (porta 80 - redirect para HTTPS)
    const httpListener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true,
      }),
    });

    // HTTPS Listener (porta 443)
    // NOTA: Para produção, adicionar certificado ACM
    const httpsListener = this.alb.addListener('HttpsListener', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTP, // Mudar para HTTPS quando tiver certificado
      // certificates: [certificate], // Uncomment when ACM certificate is available
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'application/json',
        messageBody: JSON.stringify({ error: 'Not Found', message: 'Invalid route' }),
      }),
    });

    // Path-based routing: /api/faturamento/* -> Faturamento service
    httpsListener.addTargetGroups('FaturamentoRoute', {
      priority: 10,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/api/faturamento/*', '/api/faturamento']),
      ],
      targetGroups: [faturamentoTargetGroup],
    });

    // Path-based routing: /api/estoque/* -> Estoque service
    httpsListener.addTargetGroups('EstoqueRoute', {
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/api/estoque/*', '/api/estoque']),
      ],
      targetGroups: [estoqueTargetGroup],
    });

    // Health check route: /health -> return 200 (ALB-level)
    httpsListener.addTargetGroups('HealthRoute', {
      priority: 5,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(['/health']),
      ],
      targetGroups: [faturamentoTargetGroup], // Usar qualquer target group ativo
    });

    // CloudWatch Alarms
    if (config.alarms.enabled) {
      // Alarm: High 5xx error rate
      new cloudwatch.Alarm(this, 'Alb5xxAlarm', {
        alarmName: `nfe-alb-5xx-${config.environment}`,
        metric: this.alb.metricHttpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
          period: cdk.Duration.minutes(5),
          statistic: 'Sum',
        }),
        threshold: config.alarms.errorRateThreshold,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Alarm: High latency
      new cloudwatch.Alarm(this, 'AlbLatencyAlarm', {
        alarmName: `nfe-alb-latency-${config.environment}`,
        metric: this.alb.metricTargetResponseTime({
          period: cdk.Duration.minutes(5),
          statistic: 'Average',
        }),
        threshold: config.alarms.latencyThreshold,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Alarm: Unhealthy target count (Faturamento)
      new cloudwatch.Alarm(this, 'FaturamentoUnhealthyTargetAlarm', {
        alarmName: `nfe-faturamento-unhealthy-${config.environment}`,
        metric: faturamentoTargetGroup.metricUnhealthyHostCount({
          period: cdk.Duration.minutes(5),
          statistic: 'Average',
        }),
        threshold: 1,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      // Alarm: Unhealthy target count (Estoque)
      new cloudwatch.Alarm(this, 'EstoqueUnhealthyTargetAlarm', {
        alarmName: `nfe-estoque-unhealthy-${config.environment}`,
        metric: estoqueTargetGroup.metricUnhealthyHostCount({
          period: cdk.Duration.minutes(5),
          statistic: 'Average',
        }),
        threshold: 1,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.albDnsName,
      description: 'ALB DNS name',
      exportName: `NfeAlbDnsName-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'AlbUrl', {
      value: `http://${this.albDnsName}`,
      description: 'ALB URL (HTTP)',
    });

    new cdk.CfnOutput(this, 'FaturamentoUrl', {
      value: `http://${this.albDnsName}/api/faturamento/health`,
      description: 'Faturamento service health check URL',
    });

    new cdk.CfnOutput(this, 'EstoqueUrl', {
      value: `http://${this.albDnsName}/api/estoque/health`,
      description: 'Estoque service health check URL',
    });

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
