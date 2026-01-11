# Environment Variables para Deploy AWS

## **Serviço Faturamento (GO)**

### **Database (PostgreSQL RDS)**
```bash
# Opção 1: URL completa (recomendado)
DATABASE_URL=postgres://username:password@rds-endpoint:5432/nfe_db?sslmode=require

# Opção 2: Componentes individuais
DB_HOST=rds-endpoint.region.rds.amazonaws.com
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=senha_secreta
DB_NAME=nfe_db
DB_SCHEMA=faturamento  # IMPORTANTE: schema isolado
DB_SSLMODE=require     # AWS RDS exige TLS
```

### **RabbitMQ (Amazon MQ)**
```bash
# TLS obrigatório (porta 5671)
RABBITMQ_URL=amqps://username:password@mq-broker.mq.region.amazonaws.com:5671/vhost
```

### **Logging**
```bash
LOG_LEVEL=INFO           # DEBUG|INFO|WARN|ERROR
ENVIRONMENT=production   # development|staging|production
```

### **ECS Task Definition Example (Faturamento)**
```json
{
  "containerDefinitions": [
    {
      "name": "faturamento",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/faturamento:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "ENVIRONMENT",
          "value": "production"
        },
        {
          "name": "LOG_LEVEL",
          "value": "INFO"
        },
        {
          "name": "DB_HOST",
          "value": "nfe-db.xxxxx.us-east-1.rds.amazonaws.com"
        },
        {
          "name": "DB_PORT",
          "value": "5432"
        },
        {
          "name": "DB_NAME",
          "value": "nfe_db"
        },
        {
          "name": "DB_SCHEMA",
          "value": "faturamento"
        },
        {
          "name": "DB_SSLMODE",
          "value": "require"
        }
      ],
      "secrets": [
        {
          "name": "DB_USER",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/db/username"
        },
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/db/password"
        },
        {
          "name": "RABBITMQ_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/rabbitmq/url"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/faturamento",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "family": "faturamento",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512"
}
```

---

## **Serviço Estoque (.NET)**

### **Database (PostgreSQL RDS)**
```bash
# Connection String com SearchPath para schema
ConnectionStrings__DefaultConnection=Host=rds-endpoint.region.rds.amazonaws.com;Port=5432;Database=nfe_db;Username=admin;Password=senha;SSL Mode=Require;Search Path=estoque

# OU via env var separada para schema
DB_SCHEMA=estoque
```

### **RabbitMQ (Amazon MQ)**
```bash
RabbitMQ__Host=mq-broker.mq.region.amazonaws.com
RabbitMQ__Port=5671          # TLS obrigatório
RabbitMQ__Username=admin
RabbitMQ__Password=senha
RabbitMQ__UseSsl=true        # IMPORTANTE
```

### **Logging**
```bash
Logging__LogLevel__Default=Information
ASPNETCORE_ENVIRONMENT=Production
```

### **ECS Task Definition Example (Estoque)**
```json
{
  "containerDefinitions": [
    {
      "name": "estoque",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/estoque:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 5000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "ASPNETCORE_ENVIRONMENT",
          "value": "Production"
        },
        {
          "name": "ASPNETCORE_URLS",
          "value": "http://+:5000"
        },
        {
          "name": "Logging__LogLevel__Default",
          "value": "Information"
        },
        {
          "name": "DB_SCHEMA",
          "value": "estoque"
        },
        {
          "name": "RabbitMQ__Host",
          "value": "b-xxxxx.mq.us-east-1.amazonaws.com"
        },
        {
          "name": "RabbitMQ__Port",
          "value": "5671"
        },
        {
          "name": "RabbitMQ__UseSsl",
          "value": "true"
        }
      ],
      "secrets": [
        {
          "name": "ConnectionStrings__DefaultConnection",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/db/connstring-estoque"
        },
        {
          "name": "RabbitMQ__Username",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/rabbitmq/username"
        },
        {
          "name": "RabbitMQ__Password",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:nfe/rabbitmq/password"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:5000/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      },
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/estoque",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ],
  "family": "estoque",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512"
}
```

---

## **Secrets Manager Structure**

### **Database Credentials**
```bash
# Secret: nfe/db/username
admin

# Secret: nfe/db/password
SenhaSegura123!

# Secret: nfe/db/connstring-estoque
Host=nfe-db.xxxxx.us-east-1.rds.amazonaws.com;Port=5432;Database=nfe_db;Username=admin;Password=SenhaSegura123!;SSL Mode=Require;Search Path=estoque
```

### **RabbitMQ Credentials**
```bash
# Secret: nfe/rabbitmq/url
amqps://admin:SenhaRabbit456!@b-xxxxx.mq.us-east-1.amazonaws.com:5671/

# Secret: nfe/rabbitmq/username
admin

# Secret: nfe/rabbitmq/password
SenhaRabbit456!
```

---

## **ALB Health Check Configuration**

### **Target Group: Faturamento**
- Protocol: HTTP
- Port: 8080
- Path: `/health`
- Success codes: 200
- Interval: 30s
- Timeout: 5s
- Healthy threshold: 2
- Unhealthy threshold: 3

### **Target Group: Estoque**
- Protocol: HTTP
- Port: 5000
- Path: `/health`
- Success codes: 200
- Interval: 30s
- Timeout: 5s
- Healthy threshold: 2
- Unhealthy threshold: 3

---

## **Comandos de Teste Local (com env vars)**

### **Faturamento (GO)**
```bash
# Teste com env vars AWS
export ENVIRONMENT=production
export LOG_LEVEL=DEBUG
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=admin
export DB_PASSWORD=admin123
export DB_NAME=nfe_db
export DB_SCHEMA=faturamento
export DB_SSLMODE=disable
export RABBITMQ_URL=amqp://admin:admin123@localhost:5672/

cd /mnt/d/Programacao/Emissao_NFE/servico-faturamento
go run cmd/api/main.go

# Health check
curl -s http://localhost:8080/health | jq .
```

### **Estoque (.NET)**
```bash
# Teste com env vars AWS
export ASPNETCORE_ENVIRONMENT=Production
export ConnectionStrings__DefaultConnection="Host=localhost;Port=5432;Database=nfe_db;Username=admin;Password=admin123;Search Path=estoque"
export DB_SCHEMA=estoque
export RabbitMQ__Host=localhost
export RabbitMQ__Port=5672
export RabbitMQ__Username=admin
export RabbitMQ__Password=admin123
export RabbitMQ__UseSsl=false
export Logging__LogLevel__Default=Information

cd /mnt/d/Programacao/Emissao_NFE/servico-estoque
dotnet run --project ServicoEstoque.csproj

# Health check
curl -s http://localhost:5000/health | jq .
```

### **Exemplo de Response Health Check Esperado**
```json
{
  "status": "healthy",
  "service": "faturamento",
  "environment": "production",
  "timestamp": "2026-01-11T14:30:00Z",
  "checks": {
    "database": {
      "status": "ok",
      "latency_ms": 8
    },
    "rabbitmq": {
      "status": "ok",
      "latency_ms": 12
    }
  },
  "uptime_seconds": 3600
}
```

---

## **Logs Estruturados (CloudWatch Insights Queries)**

### **GO - Filtrar erros**
```sql
fields @timestamp, level, message, context
| filter level = "ERROR"
| sort @timestamp desc
```

### **.NET - Filtrar por SourceContext**
```sql
fields @timestamp, @level, SourceContext, Message
| filter @level = "Error"
| sort @timestamp desc
```
