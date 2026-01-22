import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { InfraConfig } from '../config/dev';

export interface ComputeStackServerlessProps extends cdk.StackProps {
  config: InfraConfig;
  vpc: ec2.IVpc;
  dbSecurityGroup: ec2.ISecurityGroup;
  dbSecret: secretsmanager.Secret;
  rdsProxyEndpoint: string; // Na verdade é dbEndpoint direto (sem Proxy)
  eventBus: events.EventBus;
  userPoolId?: string; // Cognito User Pool ID (opcional para backward compatibility)
  userPoolClientId?: string; // Cognito User Pool Client ID
  frontendBucketName?: string; // Nome do bucket S3 do frontend (para PDFs)
  cloudFrontDomain?: string; // Domínio CloudFront (para URLs dos PDFs)
}

/**
 * ComputeStackServerless: Arquitetura Lambda FREE TIER otimizada
 *
 * Premissas:
 * - Lambda EM VPC (subnets públicas, SEM NAT Gateway para internet)
 * - Lambda acessa apenas RDS via VPC (sem necessidade de internet)
 * - RDS em VPC com Security Group permitindo Lambda
 * - API Gateway Regional (não privado)
 * - EventBridge + SQS para saga coreografado
 * - Lambda conecta DIRETO no RDS (sem Proxy - Free Tier)
 *
 * Custo estimado Free Tier: ~$3/mês
 * Custo após Free Tier: ~$33/mês
 */
export class ComputeStackServerless extends cdk.Stack {
  public readonly apiFaturamento: apigateway.RestApi;
  public readonly apiEstoque: apigateway.RestApi;
  public readonly faturamentoFunction: lambda.Function;
  public readonly estoqueFunction: lambda.Function;
  public readonly outboxProcessorFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ComputeStackServerlessProps) {
    super(scope, id, props);

    const { config, vpc, dbSecurityGroup, dbSecret, rdsProxyEndpoint, eventBus, userPoolId, userPoolClientId, frontendBucketName, cloudFrontDomain } = props;

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
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant Secrets Manager read (Lambda usa username/password do Secret)
    dbSecret.grantRead(lambdaRole);

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
        resources: [`arn:aws:s3:::${frontendBucketName}/notas-fiscais/*`],
      }));
    }

    // Security Group para Lambdas
    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security Group for Lambda functions',
      allowAllOutbound: true,
    });

    // Nota: dbSecurityGroup já permite conexões de toda a VPC (configurado no DatabaseStack)

    // ===========================
    // 2.5. Lambda Authorizer (JWT Cognito)
    // ===========================

    let authorizer: apigateway.TokenAuthorizer | undefined;

    if (userPoolId && userPoolClientId) {
      // Lambda Authorizer Function
      const authorizerLogGroup = new logs.LogGroup(this, 'AuthorizerLogGroup', {
        logGroupName: `/aws/lambda/nfe-authorizer-${config.environment}`,
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const authorizerFunction = new lambda.Function(this, 'CognitoAuthorizer', {
        functionName: `nfe-authorizer-${config.environment}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromAsset('../../infra/lambda-authorizer', {
          bundling: {
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

      // Token Authorizer para API Gateway
      authorizer = new apigateway.TokenAuthorizer(this, 'ApiAuthorizer', {
        authorizerName: `nfe-jwt-authorizer-${config.environment}`,
        handler: authorizerFunction,
        resultsCacheTtl: cdk.Duration.minutes(5), // Cache por 5 minutos
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
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.faturamentoFunction = new lambda.Function(this, 'FaturamentoFunction', {
      functionName: `nfe-faturamento-${config.environment}`,
      runtime: lambda.Runtime.PROVIDED_AL2023, // Go custom runtime
      handler: 'bootstrap',
      code: lambda.Code.fromAsset('../../servico-faturamento/build', {
        // NOTA: Build com: GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o bootstrap cmd/lambda/main.go
        // Updated: 2026-01-12 22:54 - Added EventBridge publisher
      }),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      logGroup: faturamentoLogGroup,
      environment: {
        ENVIRONMENT: config.environment,
        LOG_LEVEL: 'INFO',
        CODE_VERSION: '2026-01-14-1945', // Force redeploy with CORS fix
        DB_HOST: rdsProxyEndpoint,
        DB_PORT: '5432',
        DB_USER: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        DB_NAME: 'nfe_db',
        DB_SCHEMA: 'faturamento',
        DB_SSLMODE: 'require',
        RABBITMQ_URL: 'disabled', // Desabilita RabbitMQ (usamos EventBridge)
        EVENT_BUS_NAME: eventBus.eventBusName,
        SQS_ESTOQUE_RESERVA_URL: estoqueReservaQueue.queueUrl,
        CORS_ORIGINS: config.cloudFrontDomain || '*',
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [lambdaSecurityGroup],
      allowPublicSubnet: true, // Lambda não precisa internet, apenas acessa RDS na VPC
      reservedConcurrentExecutions: config.environment === 'prod' ? 10 : undefined,
    });

    // Lambda: Estoque (.NET 9 ARM64)
    const estoqueLogGroup = new logs.LogGroup(this, 'EstoqueLogGroup', {
      logGroupName: `/aws/lambda/nfe-estoque-${config.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.estoqueFunction = new lambda.Function(this, 'EstoqueFunction', {
      functionName: `nfe-estoque-${config.environment}`,
      runtime: lambda.Runtime.DOTNET_8, // .NET 8 managed runtime
      handler: 'ServicoEstoque', // Assembly name
      code: lambda.Code.fromAsset('../../servico-estoque/publish-clean', {
        // NOTA: .NET 8 managed runtime DLLs (11MB - downgrade de .NET 9)
        // Rollback para runtime compatível com Lambda DOTNET_8
      }),
      architecture: lambda.Architecture.X86_64, // DOTNET_8 usa x86_64
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      role: lambdaRole,
      logGroup: estoqueLogGroup,
      environment: {
        ASPNETCORE_ENVIRONMENT: 'Production',
        ConnectionStrings__DefaultConnection: `Host=${rdsProxyEndpoint};Port=5432;Database=nfe_db;Username=${dbSecret.secretValueFromJson('username').unsafeUnwrap()};Password=${dbSecret.secretValueFromJson('password').unsafeUnwrap()};SSL Mode=Require;Search Path=estoque`,
        DB_SCHEMA: 'estoque', // Schema do banco de dados (usado no EF Core OnModelCreating)
        RABBITMQ_URL: 'disabled', // Desabilita RabbitMQ (usamos EventBridge)
        EVENT_BUS_NAME: eventBus.eventBusName,
        SQS_FATURAMENTO_CONFIRMACAO_URL: faturamentoConfirmacaoQueue.queueUrl,
        CORS_ORIGINS: config.cloudFrontDomain || '*',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1', // Otimização .NET
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [lambdaSecurityGroup],
      allowPublicSubnet: true, // Lambda não precisa internet, apenas acessa RDS na VPC
      reservedConcurrentExecutions: config.environment === 'prod' ? 10 : undefined,
    });

    // SQS Event Source: estoque-reserva → Lambda Estoque
    this.estoqueFunction.addEventSource(new lambdaEventSources.SqsEventSource(estoqueReservaQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // SQS Event Source: faturamento-confirmacao → Lambda Faturamento
    this.faturamentoFunction.addEventSource(new lambdaEventSources.SqsEventSource(faturamentoConfirmacaoQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    // Lambda: Outbox Processor (scheduled job)
    const outboxLogGroup = new logs.LogGroup(this, 'OutboxLogGroup', {
      logGroupName: `/aws/lambda/nfe-outbox-processor-${config.environment}`,
      retention: logs.RetentionDays.ONE_WEEK,
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
        DB_HOST: rdsProxyEndpoint,
        DB_PORT: '5432',
        DB_USER: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        DB_NAME: 'nfe_db',
        DB_SCHEMA: 'faturamento',
        DB_SSLMODE: 'require',
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [lambdaSecurityGroup],
      allowPublicSubnet: true, // Lambda não precisa internet, apenas acessa RDS na VPC
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
      retention: logs.RetentionDays.ONE_WEEK,
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
        DB_HOST: rdsProxyEndpoint,
        DB_PORT: '5432',
        DB_USER: dbSecret.secretValueFromJson('username').unsafeUnwrap(),
        DB_PASSWORD: dbSecret.secretValueFromJson('password').unsafeUnwrap(),
        DB_NAME: 'nfe_db',
        DB_SCHEMA: 'faturamento',
        DB_SSLMODE: 'require',
        PDF_BUCKET_NAME: frontendBucketName || `nfe-frontend-${config.environment}-${cdk.Aws.ACCOUNT_ID}`,
        CLOUDFRONT_DOMAIN: cloudFrontDomain || config.cloudFrontDomain || '',
      },
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [lambdaSecurityGroup],
      allowPublicSubnet: true,
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
          : ['https://d3065hze06690c.cloudfront.net'],  // Dev: CloudFront específico
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

    // Security Headers em respostas de erro (API Faturamento)
    this.apiFaturamento.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    this.apiFaturamento.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
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
          : ['https://d3065hze06690c.cloudfront.net'],  // Dev: CloudFront específico
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

    // Routes: /api/v1/produtos
    const estoqueApiV1 = this.apiEstoque.root.addResource('api').addResource('v1');
    const produtosResource = estoqueApiV1.addResource('produtos');
    produtosResource.addMethod('GET', estoqueIntegration, protectedMethodOptions);
    produtosResource.addMethod('POST', estoqueIntegration, protectedMethodOptions);

    const produtoIdResource = produtosResource.addResource('{id}');
    produtoIdResource.addMethod('GET', estoqueIntegration, protectedMethodOptions);
    produtoIdResource.addMethod('PUT', estoqueIntegration, protectedMethodOptions);

    // Health check (SEM autenticação - usado por ALB/monitoring)
    const estoqueHealthResource = this.apiEstoque.root.addResource('health');
    estoqueHealthResource.addMethod('GET', estoqueIntegration);

    // Security Headers em respostas de erro (API Estoque)
    this.apiEstoque.addGatewayResponse('Default4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'X-Content-Type-Options': "'nosniff'",
        'X-Frame-Options': "'DENY'",
        'Strict-Transport-Security': "'max-age=31536000; includeSubDomains; preload'",
        'X-XSS-Protection': "'1; mode=block'",
      },
    });

    this.apiEstoque.addGatewayResponse('Default5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
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

    // Rule: NotaFiscalCriada → SQS estoque-reserva
    new events.Rule(this, 'NotaFiscalCriadaRule', {
      ruleName: `nfe-nota-criada-${config.environment}`,
      eventBus,
      eventPattern: {
        source: ['nfe.faturamento'],
        detailType: ['NotaFiscalCriada'],
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
    // 6. Outputs
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

    // Tags
    Object.entries(config.tags).forEach(([key, value]) => {
      cdk.Tags.of(this).add(key, value);
    });
  }
}
