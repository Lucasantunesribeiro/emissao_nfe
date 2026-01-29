import * as cdk from 'aws-cdk-lib';
import { IConstruct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';

export class CostGuardrailsAspect implements cdk.IAspect {
  constructor(private readonly environment: string) {}

  visit(node: IConstruct): void {
    // Bloquear NAT Gateway em DEV
    if (node instanceof ec2.CfnNatGateway && this.environment === 'dev') {
      throw new Error(
        '🚫 COST GUARDRAIL VIOLATION: NAT Gateway is PROHIBITED in DEV environment.\n' +
        '   Estimated cost: $32.40/month.\n' +
        '   Reason: Lambdas should be outside VPC or use VPC Endpoints.\n' +
        '   Fix: Set natGateways=0 in network-stack.ts'
      );
    }

    // Bloquear ECS/Fargate em DEV
    if (node instanceof ecs.FargateService && this.environment === 'dev') {
      if (process.env.EXPLICITLY_ALLOW_ECS !== 'true') {
        throw new Error(
          '🚫 COST GUARDRAIL VIOLATION: ECS Fargate is PROHIBITED in DEV environment.\n' +
          '   Estimated cost: $50+/month.\n' +
          '   Reason: Serverless deployment mode is enforced.\n' +
          '   Fix: Use Lambda instead (already configured).\n' +
          '   Override: Set EXPLICITLY_ALLOW_ECS=true if absolutely necessary.'
        );
      }
    }

    // Bloquear ALB/NLB em DEV
    if (node instanceof elbv2.ApplicationLoadBalancer && this.environment === 'dev') {
      throw new Error(
        '🚫 COST GUARDRAIL VIOLATION: Application Load Balancer is PROHIBITED in DEV.\n' +
        '   Estimated cost: $16.20/month.\n' +
        '   Reason: API Gateway is configured and sufficient.\n' +
        '   Fix: Use API Gateway for HTTP APIs.'
      );
    }

    if (node instanceof elbv2.NetworkLoadBalancer && this.environment === 'dev') {
      throw new Error(
        '🚫 COST GUARDRAIL VIOLATION: Network Load Balancer is PROHIBITED in DEV.\n' +
        '   Estimated cost: $16.20/month.\n' +
        '   Fix: Use API Gateway or Lambda Function URLs.'
      );
    }

    // Alertar sobre VPC Endpoints Interface (permitir, mas avisar)
    if (node instanceof ec2.InterfaceVpcEndpoint && this.environment === 'dev') {
      console.warn(
        '⚠️  COST WARNING: VPC Interface Endpoint detected.\n' +
        `   Endpoint: ${node.node.id}\n` +
        '   Cost: $7.30/month per endpoint.\n' +
        '   Recommendation: If Lambdas are outside VPC, remove this endpoint.'
      );
    }

    // Bloquear RDS Multi-AZ em DEV
    if (node instanceof rds.CfnDBInstance) {
      const props = (node as any)._cfnProperties;
      if (props?.MultiAZ === true && this.environment === 'dev') {
        throw new Error(
          '🚫 COST GUARDRAIL VIOLATION: RDS Multi-AZ is PROHIBITED in DEV.\n' +
          '   Estimated cost: 2x instance cost.\n' +
          '   Fix: Set multiAz: false in database-stack.ts'
        );
      }
    }
  }
}
