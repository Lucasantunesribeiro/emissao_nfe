import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';
import { InfraConfig } from '../config/dev';

export interface ComputeStackServerlessProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.IVpc;
  mainTable: dynamodb.Table;
  eventsTable: dynamodb.Table;
  eventBus: events.EventBus;
  userPoolId?: string; // Cognito User Pool ID (opcional para backward compatibility)
  userPoolClientId?: string; // Cognito User Pool Client ID
  frontendBucketName?: string; // Nome do bucket S3 do frontend (para PDFs)
  cloudFrontDomain?: string; // Domínio CloudFront (para URLs dos PDFs)
}

/**
 * ComputeStackServerless: Arquitetura Lambda + DynamoDB 100% FREE TIER
 *
 * Premissas:
 * - Lambda SEM VPC (acesso direto ao DynamoDB via AWS PrivateLink)
 * - DynamoDB com PAY_PER_REQUEST (Free Tier: 25 GB + 25 WCU/RCU)
 * - API Gateway Regional (não privado)
 * - EventBridge + SQS para saga coreografado
 * - SEM RDS, SEM NAT Gateway, SEM VPC endpoints
 *
 * Custo estimado Free Tier: ~$0-2/mês
 * Custo após Free Tier: ~$15/mês
 */
export class ComputeStackServerless extends cdk.Stack {
  public readonly apiFaturamento: apigateway.RestApi;
  public readonly apiEstoque: apigateway.RestApi;
  public readonly faturamentoFunction: lambda.Function;
  public readonly estoqueFunction: lambda.Function;
  public readonly outboxProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ComputeStackServerlessProps) {
    super(scope, id, props);

    const { config, vpc, mainTable, eventsTable, eventBus, userPoolId, userPoolClientId, frontendBucketName, cloudFrontDomain } = props;

    // ===========================
    // 1. SQS Queues (Mensageria)
    // ===========================

    // Dead Letter Queue global
    const dlq = new sqs.Queue(this, 'DLQ', {
      queueName: `nfe-dlq-${config.environment}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Queue: Reserva de Estoque (trigger para Lambda Estoque)
    const estoqueReservaQueue = new sqs.Queue(this, 'EstoqueReservaQueue', {
      queueName: `nfe-estoque-reserva-${config.environment}`,
      visibilityTimeout: cdk.Duration.seconds(90), // 3x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Queue: Confirmação de Faturamento (trigger para Lambda Faturamento)
    const faturamentoConfirmacaoQueue = new sqs.Queue(this, 'FaturamentoConfirmacaoQueue', {
      queueName: `nfe-faturamento-confirmacao-${config.environment}`,
      visibilityTimeout: cdk.Duration.seconds(90),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 3,
      },
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // ===========================
    // 2. Lambda Execution Role
    // ===========================

    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        // VPCAccessExecutionRole REMOVED: Lambdas no longer run in VPC
      ],
    });

    // Grant DynamoDB read/write permissions
    mainTable.grantReadWriteData(lambdaRole);
    eventsTable.grantReadWriteData(lambdaRole);

    // Grant SQS send/receive
    estoqueReservaQueue.grantSendMessages(lambdaRole);
    faturamentoConfirmacaoQueue.grantSendMessages(lambdaRole);
    estoqueReservaQueue.grantConsumeMessages(lambdaRole);
    faturamentoConfirmacaoQueue.grantConsumeMessages(lambdaRole);

    // Grant EventBridge publish
    eventBus.grantPutEventsTo(lambdaRole);

    // Grant S3 write para PDF uploads (se frontendBucketName fornecido)
    if (frontendBucketName) {
      lambdaRole.addToPolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:PutObjectAcl'],
        resources: [`arn:aws:s3:::${frontendBucketName}/notas/*`],  // Corrigido: código usa "notas/{id}/{sol}.pdf"
      }));
    }

    // Grant S3 write para PDF bucket
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:PutObjectAcl'],
      resources: ['arn:aws:s3:::nfe-pdfs-mock/*'],
    }));

    // Security Group REMOVED: Lambdas no longer run in VPC (cost savings)

    // ===========================
    // 2.5. Lambda Authorizer (JWT Cognito)
    // ===========================

    let authorizer: apigateway.TokenAuthorizer | undefined;
    let estoqueAuthorizer: apigateway.TokenAuthorizer | undefined;

    if (userPoolId && userPoolClientId) {
      // Lambda Authorizer Function
      const authorizerLogGroup = new logs.LogGroup(this, 'AuthorizerLogGroup', {
        logGroupName: `/aws/lambda/nfe-authorizer-${config.environment}`,
        retention: config.environment === 'prod'
          ? logs.RetentionDays.ONE_MONTH
          : logs.RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const authorizerFunction = new lambda.Function(this, 'CognitoAuthorizer', {
        functionName: `nfe-authorizer-${config.environment}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('../../infra/lambda-authorizer', {
          bundling: {
            local: {
              tryBundle(outputDir: string): boolean {
                try {
                  const authorizerDir = path.resolve(__dirname, '../../../../infra/lambda-authorizer');
                  execSync('npm install && npm run build', { cwd: authorizerDir, stdio: 'inherit' });
                  fs.cpSync(path.join(authorizerDir, 'dist'), outputDir, { recursive: true });
                  fs.cpSync(path.join(authorizerDir, 'node_modules'), path.join(outputDir, 'node_modules'), { recursive: true });
                  return true;
                } catch {
                  return false;
                }
              },
            },
            image: lambda.Runtime.NODEJS_20_X.bundlingImage,
            command: [
              'bash', '-c', [
                'npm install',
                'npm run build',
                'cp -r node_modules /asset-output/',
                'cp -r dist/* /asset-output/',
              ].join(' && '),
            ],
          },
        }),
        memorySize: 256,
        timeout: cdk.Duration.seconds(10),
        logGroup: authorizerLogGroup,
        environment: {
          USER_POOL_ID: userPoolId,
          CLIENT_ID: userPoolClientId,
          LOG_LEVEL: 'INFO',
        },
      });

      // Token Authorizer para API Faturamento
      authorizer = new apigateway.TokenAuthorizer(this, 'ApiAuthorizer', {
        authorizerName: `nfe-jwt-authorizer-${config.environment}`,
        handler: authorizerFunction,
        resultsCacheTtl: cdk.Duration.minutes(5),
        identitySource: 'method.request.header.Authorization',
        validationRegex: '^Bearer [-0-9a-zA-Z\\._]*$',
      });

      // Token Authorizer para API Estoque (mesma função, construct separado)
      estoqueAuthorizer = new apigateway.TokenAuthorizer(this, 'EstoqueApiAuthorizer', {
        authorizerName: `nfe-jwt-authorizer-estoque-${config.environment}`,
        handler: authorizerFunction,
        resultsCacheTtl: cdk.Duration.minutes(5),
        identitySource: 'method.request.header.Authorization',
        validationRegex: '^Bearer [-0-9a-zA-Z\\._]*$',
      });

      new cdk.CfnOutput(this, 'AuthorizerFunctionArn', {
        value: authorizerFunction.functionArn,
        description: 'Lambda Authorizer ARN',
        exportName: `NfeAuthorizerArn-${config.environment}`,
      });
    }

    // ===========================
    // 3. Lambda Functions
    // ===========================

    // Lambda: Faturamento (Go ARM64)
    const faturamentoLogGroup = new logs.LogGroup(this, 'FaturamentoLogGroup', {
      logGroupName: `/aws/lambda/nfe-faturamento-${config.environment}`,
      retention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.faturamentoFunction = new lambda.Function(this, 'FaturamentoFunction', {
      functionName: `nfe-faturamento-${config.environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023, // Go custom runtime
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../../servico-faturamento/build', {
        // NOTA: Build com: CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags lambda.norpc -o bootstrap ./cmd/lambda/main.go
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      logGroup: faturamentoLogGroup,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        CODE_VERSION: '2026-02-03-dynamodb', // DynamoDB migration
        DYNAMODB_TABLE_NAME: mainTable.tableName,
        DYNAMODB_EVENTS_TABLE_NAME: eventsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        SQS_ESTOQUE_RESERVA_URL: estoqueReservaQueue.queueUrl,
        CORS_ORIGINS: cloudFrontDomain ? `https://${cloudFrontDomain}` : 'http://localhost:4200',
        PDF_BUCKET_NAME: frontendBucketName || `nfe-frontend-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
        CLOUDFRONT_DOMAIN: cloudFrontDomain || '',
      },
      // VPC REMOVED: Lambda now runs outside VPC (cost savings: $21.90/month)
      // RDS is publicly accessible with restricted Security Group
      reservedConcurrentExecutions: config.environment === 'prod' ? 10 : undefined,
    });

    // Lambda: Estoque (.NET 9 ARM64)
    const estoqueLogGroup = new logs.LogGroup(this, 'EstoqueLogGroup', {
      logGroupName: `/aws/lambda/nfe-estoque-${config.environment}`,
      retention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.estoqueFunction = new lambda.Function(this, 'EstoqueFunction', {
      functionName: `nfe-estoque-${config.environment}`,
      runtime: lambda.Runtime.DOTNET_8, // .NET 8 managed runtime
      handler: 'ServicoEstoque', // Assembly name
      code: lambda.Code.fromAsset('../../servico-estoque/publish-dynamodb', {
        // NOTA: .NET 8 managed runtime DLLs with DynamoDB SDK
        // DynamoDB migration - no EF Core dependencies
      }),
      architecture: lambda.Architecture.X86_64, // DOTNET_8 usa x86_64
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      logGroup: estoqueLogGroup,
      environment: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        DYNAMODB_TABLE_NAME: mainTable.tableName,
        DYNAMODB_EVENTS_TABLE_NAME: eventsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        SQS_FATURAMENTO_CONFIRMACAO_URL: faturamentoConfirmacaoQueue.queueUrl,
        CORS_ORIGINS: cloudFrontDomain ? `https://${cloudFrontDomain}` : 'http://localhost:4200',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', // Otimização .NET
      },
      // VPC REMOVED: Lambda now runs outside VPC (cost savings: $21.90/month)
      reservedConcurrentExecutions: config.environment === 'prod' ? 10 : undefined,
    });

    // SQS Event Source: faturamento-confirmacao → Lambda Faturamento (ReservaConfirmada/ReservaFalhou)
    this.faturamentoFunction.addEventSource(new lambdaEventSources.SqsEventSource(faturamentoConfirmacaoQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Lambda: Estoque Consumer (Go) — processa SQS com eventos de nota fechada
    // O Lambda .NET (estoqueFunction) NÃO é compatível com SQS (usa RestApi hosting),
    // por isso criamos um Lambda Go separado para consumir a fila de reserva.
    const estoqueConsumerLogGroup = new logs.LogGroup(this, 'EstoqueConsumerLogGroup', {
      logGroupName: `/aws/lambda/nfe-estoque-consumer-${config.environment}`,
      retention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const estoqueConsumerFunction = new lambda.Function(this, 'EstoqueConsumerFunction', {
      functionName: `nfe-estoque-consumer-${config.environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../../servico-faturamento/build-estoque-consumer'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      logGroup: estoqueConsumerLogGroup,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        DYNAMODB_TABLE_NAME: mainTable.tableName,
        DYNAMODB_EVENTS_TABLE_NAME: eventsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });

    // SQS Event Source: estoque-reserva → Lambda EstoqueConsumer (Go)
    estoqueConsumerFunction.addEventSource(new lambdaEventSources.SqsEventSource(estoqueReservaQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Lambda: Outbox Processor (scheduled job)
    const outboxLogGroup = new logs.LogGroup(this, 'OutboxLogGroup', {
      logGroupName: `/aws/lambda/nfe-outbox-processor-${config.environment}`,
      retention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.outboxProcessorFunction = new lambda.Function(this, 'OutboxProcessorFunction', {
      functionName: `nfe-outbox-processor-${config.environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../../servico-faturamento/build-outbox'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      role: lambdaRole,
      logGroup: outboxLogGroup,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        DYNAMODB_TABLE_NAME: mainTable.tableName,
        DYNAMODB_EVENTS_TABLE_NAME: eventsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      // VPC REMOVED: Lambda now runs outside VPC
    });

    // EventBridge Rule: Trigger outbox processor a cada 1 minuto
    const outboxRule = new events.Rule(this, 'OutboxProcessorRule', {
      ruleName: `nfe-outbox-processor-${config.environment}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      enabled: true,
    });
    outboxRule.addTarget(new targets.LambdaFunction(this.outboxProcessorFunction));

    // Lambda: PDF Generator (event-driven)
    const pdfLogGroup = new logs.LogGroup(this, 'PdfGeneratorLogGroup', {
      logGroupName: `/aws/lambda/nfe-pdf-generator-${config.environment}`,
      retention: config.environment === 'prod'
        ? logs.RetentionDays.ONE_MONTH
        : logs.RetentionDays.ONE_DAY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pdfGeneratorFunction = new lambda.Function(this, 'PdfGeneratorFunction', {
      functionName: `nfe-pdf-generator-${config.environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023,
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../../servico-faturamento/build-pdf'),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      role: lambdaRole,
      logGroup: pdfLogGroup,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        DYNAMODB_TABLE_NAME: mainTable.tableName,
        DYNAMODB_EVENTS_TABLE_NAME: eventsTable.tableName,
        PDF_BUCKET_NAME: frontendBucketName || `nfe-frontend-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
        CLOUDFRONT_DOMAIN: cloudFrontDomain || config.cloudFrontDomain || '',
      },
      // VPC REMOVED: Lambda now runs outside VPC
    });

    // EventBridge Rule: Trigger PDF Generator quando impressão é solicitada
    const pdfGeneratorRule = new events.Rule(this, 'PdfGeneratorRule', {
      ruleName: `nfe-pdf-generator-${config.environment}`,
      eventBus: eventBus,
      eventPattern: {
        source: ['nfe.faturamento'],
        detailType: ['Faturamento.ImpressaoSolicitada'],
      },
    });
    pdfGeneratorRule.addTarget(new targets.LambdaFunction(pdfGeneratorFunction));

    // ===========================
    // 4. API Gateway REST APIs
    // ===========================

    // API Gateway: Faturamento
    this.apiFaturamento = new apigateway.RestApi(this, 'ApiFaturamento', {
      restApiName: `nfe-faturamento-api-${config.environment}`,
      description: `API Faturamento - ${config.environment}`,
      deployOptions: {
        stageName: config.environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.environment === 'dev',
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        // SECURITY: CORS restrito ao domínio específico do frontend
        allowOrigins: config.environment === 'prod'
          ? ['https://nfe.meudominio.com']  // Produção: domínio customizado
          : [config.cloudFrontDomain, 'http://localhost:4200'],  // Dev: CloudFront do config (atualizar em dev.ts ao trocar conta)
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Request-Id', 'Idempotency-Key'],
        maxAge: cdk.Duration.hours(1),
        allowCredentials: false,  // Não permite cookies (stateless API)
      },
      cloudWatchRole: true,
    });

    // Lambda Integration
    const faturamentoIntegration = new apigateway.LambdaIntegration(this.faturamentoFunction, {
      proxy: true,
      timeout: cdk.Duration.seconds(29),
    });

    // Options comuns para métodos protegidos
    const protectedMethodOptions = authorizer ? {
      authorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    } : undefined;

    // Routes: /api/v1/notas
    const apiV1 = this.apiFaturamento.root.addResource('api').addResource('v1');
    const notasResource = apiV1.addResource('notas');
    notasResource.addMethod('GET', faturamentoIntegration, protectedMethodOptions);
    notasResource.addMethod('POST', faturamentoIntegration, protectedMethodOptions);

    const notaIdResource = notasResource.addResource('{id}');
    notaIdResource.addMethod('GET', faturamentoIntegration, protectedMethodOptions);
    notaIdResource.addMethod('PUT', faturamentoIntegration, protectedMethodOptions);

    // Route: POST /api/v1/notas/{id}/itens (adicionar item)
    const itensResource = notaIdResource.addResource('itens');
    itensResource.addMethod('POST', faturamentoIntegration, protectedMethodOptions);

    // Route: POST /api/v1/notas/{id}/imprimir (dispara saga)
    const imprimirResource = notaIdResource.addResource('imprimir');
    imprimirResource.addMethod('POST', faturamentoIntegration, protectedMethodOptions);

    // Route: PUT /api/v1/notas/{id}/fechar (fechar nota)
    const fecharResource = notaIdResource.addResource('fechar');
    fecharResource.addMethod('PUT', faturamentoIntegration, protectedMethodOptions);

    // Route: GET /api/v1/solicitacoes-impressao/{id} (consultar status)
    const solicitacoesResource = apiV1.addResource('solicitacoes-impressao');
    const solicitacaoIdResource = solicitacoesResource.addResource('{id}');
    solicitacaoIdResource.addMethod('GET', faturamentoIntegration, protectedMethodOptions);

    // Health check (SEM autenticação - usado por ALB/monitoring)
    const healthResource = this.apiFaturamento.root.addResource('health');
    healthResource.addMethod('GET', faturamentoIntegration);

    // Security + CORS Headers em respostas de erro (API Faturamento)
    // CORS é necessário para que o browser mostre o erro real ao invés de "CORS blocked"
    const corsOriginHeader = cloudFrontDomain
      ? `'https://${cloudFrontDomain}'`
      : "'http://localhost:4200'";

    this.apiFaturamento.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Idempotency-Key'",
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    this.apiFaturamento.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Idempotency-Key'",
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    // API Gateway: Estoque
    this.apiEstoque = new apigateway.RestApi(this, 'ApiEstoque', {
      restApiName: `nfe-estoque-api-${config.environment}`,
      description: `API Estoque - ${config.environment}`,
      deployOptions: {
        stageName: config.environment,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: config.environment === 'dev',
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        // SECURITY: CORS restrito ao domínio específico do frontend
        allowOrigins: config.environment === 'prod'
          ? ['https://nfe.meudominio.com']  // Produção: domínio customizado
          : [config.cloudFrontDomain, 'http://localhost:4200'],  // Dev: CloudFront do config (atualizar em dev.ts ao trocar conta)
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Request-Id', 'Idempotency-Key'],
        maxAge: cdk.Duration.hours(1),
        allowCredentials: false,  // Não permite cookies (stateless API)
      },
      cloudWatchRole: true,
    });

    const estoqueIntegration = new apigateway.LambdaIntegration(this.estoqueFunction, {
      proxy: true,
      timeout: cdk.Duration.seconds(29),
    });

    // Options comuns para métodos protegidos (API Estoque)
    const estoqueProtectedMethodOptions = estoqueAuthorizer ? {
      authorizer: estoqueAuthorizer,
      authorizationType: apigateway.AuthorizationType.CUSTOM,
    } : undefined;

    // Routes: /api/v1/produtos
    const estoqueApiV1 = this.apiEstoque.root.addResource('api').addResource('v1');
    const produtosResource = estoqueApiV1.addResource('produtos');
    produtosResource.addMethod('GET', estoqueIntegration, estoqueProtectedMethodOptions);
    produtosResource.addMethod('POST', estoqueIntegration, estoqueProtectedMethodOptions);

    const produtoIdResource = produtosResource.addResource('{id}');
    produtoIdResource.addMethod('GET', estoqueIntegration, estoqueProtectedMethodOptions);
    produtoIdResource.addMethod('PUT', estoqueIntegration, estoqueProtectedMethodOptions);

    // Health check (SEM autenticação - usado por ALB/monitoring)
    const estoqueHealthResource = this.apiEstoque.root.addResource('health');
    estoqueHealthResource.addMethod('GET', estoqueIntegration);

    // Security + CORS Headers em respostas de erro (API Estoque)
    this.apiEstoque.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Idempotency-Key'",
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    this.apiEstoque.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': corsOriginHeader,
        'Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Idempotency-Key'",
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    // CORS headers gerenciados inteiramente pelo Lambda (evita duplicação)

    // ===========================
    // 5. EventBridge Rules (Saga)
    // ===========================

    // Rule: Faturamento.NotaFechada → SQS estoque-reserva (aciona saga de reserva)
    new events.Rule(this, 'NotaFechadaRule', {
      ruleName: `nfe-nota-fechada-${config.environment}`,
      eventBus,
      eventPattern: {
        source: ['nfe.faturamento'],
        detailType: ['Faturamento.NotaFechada'],
      },
      targets: [new targets.SqsQueue(estoqueReservaQueue)],
    });

    // Rule: ReservaConfirmada → SQS faturamento-confirmacao
    new events.Rule(this, 'ReservaConfirmadaRule', {
      ruleName: `nfe-reserva-confirmada-${config.environment}`,
      eventBus,
      eventPattern: {
        source: ['nfe.estoque'],
        detailType: ['ReservaConfirmada'],
      },
      targets: [new targets.SqsQueue(faturamentoConfirmacaoQueue)],
    });

    // Rule: ReservaFalhou → SQS faturamento-compensacao (compensating transaction)
    new events.Rule(this, 'ReservaFalhouRule', {
      ruleName: `nfe-reserva-falhou-${config.environment}`,
      eventBus,
      eventPattern: {
        source: ['nfe.estoque'],
        detailType: ['ReservaFalhou'],
      },
      targets: [new targets.SqsQueue(faturamentoConfirmacaoQueue)],
    });

    // ===========================
    // 6. CloudWatch Alarms (observabilidade)
    // ===========================

    // Alarm 1: DLQ com mensagens — indica falhas críticas na saga
    new cloudwatch.Alarm(this, 'DlqAlarm', {
      alarmName: `nfe-dlq-messages-${config.environment}`,
      alarmDescription: 'Mensagens na DLQ indicam falha na saga (reserva de estoque ou PDF)',
      metric: dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm 2: Lambda Faturamento com erros (3+ erros em 5 minutos)
    new cloudwatch.Alarm(this, 'FaturamentoErrorsAlarm', {
      alarmName: `nfe-faturamento-errors-${config.environment}`,
      alarmDescription: 'Lambda Faturamento com taxa elevada de erros',
      metric: this.faturamentoFunction.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Alarm 3: Lambda Estoque com erros
    new cloudwatch.Alarm(this, 'EstoqueErrorsAlarm', {
      alarmName: `nfe-estoque-errors-${config.environment}`,
      alarmDescription: 'Lambda Estoque com taxa elevada de erros',
      metric: this.estoqueFunction.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // ===========================
    // 7. Outputs
    // ===========================

    new cdk.CfnOutput(this, 'ApiFaturamentoUrl', {
      value: this.apiFaturamento.url,
      description: 'API Gateway Faturamento URL',
      exportName: `NfeApiFaturamentoUrl-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'ApiEstoqueUrl', {
      value: this.apiEstoque.url,
      description: 'API Gateway Estoque URL',
      exportName: `NfeApiEstoqueUrl-${config.environment}`,
    });

    new cdk.CfnOutput(this, 'FaturamentoFunctionArn', {
      value: this.faturamentoFunction.functionArn,
      description: 'Lambda Faturamento ARN',
    });

    new cdk.CfnOutput(this, 'EstoqueFunctionArn', {
      value: this.estoqueFunction.functionArn,
      description: 'Lambda Estoque ARN',
    });

    new cdk.CfnOutput(this, 'EstoqueReservaQueueUrl', {
      value: estoqueReservaQueue.queueUrl,
      description: 'SQS Queue URL - Estoque Reserva',
    });

    new cdk.CfnOutput(this, 'DlqUrl', {
      value: dlq.queueUrl,
      description: 'Dead Letter Queue URL',
    });

    new cdk.CfnOutput(this, 'EstoqueConsumerFunctionArn', {
      value: estoqueConsumerFunction.functionArn,
      description: 'Lambda Estoque Consumer (Go) ARN',
    });

    // ===========================
    // 7. Custom Resource: Cleanup Orphaned Log Groups
    // ===========================
    // DISABLED: Custom resource was causing deployment timeouts
    // This is not critical for app functionality - just maintenance code
    // Can be manually run later if needed
    /*
    const cleanupLogsFunction = new lambda.Function(this, 'CleanupLogsFunction', {
      functionName: `nfe-cleanup-logs-${config.environment}`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import json

logs_client = boto3.client('logs')

ORPHANED_LOG_GROUPS = [
  '/aws/apigateway/welcome',
  '/aws/lambda/nfe-db-cleanup-temp',
  '/aws/lambda/nfe-estoque-cors-proxy-dev',
  '/aws/lambda/LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a',
]

def handler(event, context):
    if event['RequestType'] == 'Delete':
        return {'PhysicalResourceId': 'cleanup-logs'}

    for log_group in ORPHANED_LOG_GROUPS:
        try:
            logs_client.put_retention_policy(
                logGroupName=log_group,
                retentionInDays=1  # DEV: 1 dia
            )
            print(f'Set retention for {log_group}')
        except logs_client.exceptions.ResourceNotFoundException:
            print(f'{log_group} not found, skipping')

    return {'PhysicalResourceId': 'cleanup-logs'}
      `),
      timeout: cdk.Duration.seconds(60),
      logGroup: new logs.LogGroup(this, 'CleanupLogsLogGroup', {
        retention: logs.RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    cleanupLogsFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['logs:PutRetentionPolicy'],
      resources: ['*'],
    }));

    new cdk.CustomResource(this, 'CleanupLogsResource', {
      serviceToken: cleanupLogsFunction.functionArn,
    });
    */

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
