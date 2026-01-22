import { InfraConfig } from './dev';

export const prodConfig: InfraConfig = {
  environment: 'prod',
  region: 'us-east-1',

  // VPC Configuration
  vpc: {
    cidr: '10.1.0.0/16',
    maxAzs: 2,
    natGateways: 2, // Alta disponibilidade: 1 NAT/AZ
    enableFlowLogs: true,
  },

  // RDS PostgreSQL Configuration
  database: {
    instanceType: 'db.t4g.small', // Maior capacidade para prod
    engine: 'postgres',
    engineVersion: '16.4',
    allocatedStorage: 50,
    maxAllocatedStorage: 200,
    multiAz: true, // Alta disponibilidade
    backupRetention: 7,
    deletionProtection: true,
    enablePerformanceInsights: true,
    schemas: ['faturamento', 'estoque'],
  },

  // Amazon MQ (RabbitMQ) Configuration
  messaging: {
    instanceType: 'mq.t3.micro',
    engine: 'RABBITMQ',
    engineVersion: '3.13',
    deploymentMode: 'ACTIVE_STANDBY_MULTI_AZ', // Alta disponibilidade
    autoMinorVersionUpgrade: true,
  },

  // ECS Fargate Configuration
  ecs: {
    faturamento: {
      cpu: 512, // 0.5 vCPU
      memory: 1024, // 1 GB
      desiredCount: 2, // Mínimo 2 tasks para HA
      minCapacity: 2,
      maxCapacity: 10,
      containerPort: 8080,
      healthCheckPath: '/health',
      image: 'faturamento-service',
    },
    estoque: {
      cpu: 512,
      memory: 1024,
      desiredCount: 2,
      minCapacity: 2,
      maxCapacity: 10,
      containerPort: 5000,
      healthCheckPath: '/health',
      image: 'estoque-service',
    },
  },

  // Application Load Balancer Configuration
  alb: {
    idleTimeout: 120,
    http2Enabled: true,
    deletionProtection: true,
    healthCheck: {
      interval: 30,
      timeout: 5,
      healthyThreshold: 2,
      unhealthyThreshold: 3,
      path: '/health',
    },
  },

  // CloudFront + S3 Configuration (Frontend)
  frontend: {
    certificateArn: undefined, // IMPORTANTE: Adicionar ACM certificate ARN para custom domain
    priceClass: 'PriceClass_200', // NA + EU + Asia
    defaultTtl: 86400, // 24 horas
    maxTtl: 31536000, // 1 ano
    minTtl: 0,
  },

  // CORS Configuration
  cloudFrontDomain: 'https://nfe.meudominio.com', // Update with actual production domain

  // CloudWatch Alarms Configuration
  alarms: {
    cpuThreshold: 70,
    memoryThreshold: 70,
    errorRateThreshold: 2,
    latencyThreshold: 500,
    enabled: true,
  },

  // Auto Scaling Configuration
  autoScaling: {
    enabled: true, // Habilitado para prod
    targetCpuUtilization: 60,
    targetMemoryUtilization: 60,
  },

  // Tags
  tags: {
    Environment: 'prod',
    Project: 'NFe-System',
    ManagedBy: 'CDK',
    CostCenter: 'Production',
  },
};
