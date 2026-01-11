export const devConfig = {
  environment: 'dev',
  region: 'us-east-1',

  // VPC Configuration
  vpc: {
    cidr: '10.0.0.0/16',
    maxAzs: 2,
    natGateways: 1, // Economia: 1 NAT Gateway para dev
    enableFlowLogs: false,
  },

  // RDS PostgreSQL Configuration
  database: {
    instanceType: 'db.t4g.micro',
    engine: 'postgres',
    engineVersion: '16.4',
    allocatedStorage: 20,
    maxAllocatedStorage: 50,
    multiAz: false, // Economia: Single-AZ para dev
    backupRetention: 3,
    deletionProtection: false,
    enablePerformanceInsights: false,
    schemas: ['faturamento', 'estoque'],
  },

  // Amazon MQ (RabbitMQ) Configuration
  messaging: {
    instanceType: 'mq.t3.micro',
    engine: 'RABBITMQ',
    engineVersion: '3.13',
    deploymentMode: 'SINGLE_INSTANCE', // Economia: Single instance para dev
    autoMinorVersionUpgrade: true,
  },

  // ECS Fargate Configuration
  ecs: {
    faturamento: {
      cpu: 256, // 0.25 vCPU
      memory: 512, // 0.5 GB
      desiredCount: 1, // Economia: 1 task para dev
      minCapacity: 1,
      maxCapacity: 2,
      containerPort: 8080,
      healthCheckPath: '/health',
      image: 'faturamento-service', // ECR repository name
    },
    estoque: {
      cpu: 256,
      memory: 512,
      desiredCount: 1,
      minCapacity: 1,
      maxCapacity: 2,
      containerPort: 5000,
      healthCheckPath: '/health',
      image: 'estoque-service',
    },
  },

  // Application Load Balancer Configuration
  alb: {
    idleTimeout: 60,
    http2Enabled: true,
    deletionProtection: false,
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
    certificateArn: undefined, // Opcional: ACM certificate ARN
    priceClass: 'PriceClass_100', // Economia: NA + EU
    defaultTtl: 300, // 5 minutos para dev
    maxTtl: 1800, // 30 minutos
    minTtl: 0,
  },

  // CloudWatch Alarms Configuration
  alarms: {
    cpuThreshold: 80,
    memoryThreshold: 80,
    errorRateThreshold: 5,
    latencyThreshold: 1000,
    enabled: true,
  },

  // Auto Scaling Configuration
  autoScaling: {
    enabled: false, // Desabilitado para dev (reduz custos)
    targetCpuUtilization: 70,
    targetMemoryUtilization: 70,
  },

  // Tags
  tags: {
    Environment: 'dev',
    Project: 'NFe-System',
    ManagedBy: 'CDK',
    CostCenter: 'Development',
  },
};

export type InfraConfig = typeof devConfig;
