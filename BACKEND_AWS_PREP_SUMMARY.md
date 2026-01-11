# Backend AWS Preparation Summary

## ✅ **Modificações Completas**

### **Serviço Faturamento (GO)**

#### **Arquivos Criados:**
1. **`/internal/health/health.go`**
   - Health check robusto com validação DB + RabbitMQ
   - Timeout de 5s por check
   - Response JSON estruturado (status, latency_ms, error)
   - HTTP 200 (healthy) ou 503 (unhealthy)

2. **`/internal/logger/logger.go`**
   - Logging estruturado via `log/slog` (JSON output)
   - Campos: timestamp, level, service, environment, message
   - Configurável via `LOG_LEVEL` env var

#### **Arquivos Modificados:**
1. **`/internal/config/database.go`**
   - Suporte a env vars individuais (DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SCHEMA)
   - Fallback para DATABASE_URL
   - Schema configurado via `SET search_path TO {schema}`
   - Defaults locais preservados

2. **`/internal/consumidor/consumidor.go`**
   - Suporte a `amqps://` (TLS para Amazon MQ)
   - Logging via slog (em vez de log.Println)

3. **`/cmd/api/main.go`**
   - Logger.Init() no início
   - Health check robusto integrado
   - Graceful shutdown (SIGTERM/SIGINT)
   - Timeout de 10s para shutdown
   - Configuração GIN mode baseado em ENVIRONMENT

---

### **Serviço Estoque (.NET)**

#### **Arquivos Criados:**
1. **`/Api/HealthCheck.cs`**
   - Health check com validação DB + RabbitMQ
   - CancellationToken com timeout 5s
   - Response JSON estruturado
   - Factory RabbitMQ com suporte TLS

2. **`/appsettings.json`**
   - Configuração Serilog (CompactJsonFormatter)
   - MinimumLevel configurável
   - Enrich com metadata (machine, thread, context)

#### **Arquivos Modificados:**
1. **`ServicoEstoque.csproj`**
   - Adicionado Serilog.AspNetCore 9.0.0
   - Adicionado Serilog.Formatting.Compact 3.0.0
   - Adicionado Serilog.Sinks.Console 6.0.0

2. **`/Api/Program.cs`**
   - Serilog configurado com JSON output
   - Health check robusto integrado
   - Graceful shutdown via IHostApplicationLifetime
   - Schema configurado via DB_SCHEMA env var
   - Log.CloseAndFlush() no finally

3. **`/Infraestrutura/Persistencia/ContextoBancoDados.cs`**
   - `builder.HasDefaultSchema(schema)` baseado em DB_SCHEMA
   - Suporte dinâmico para schemas isolados

4. **`/Infraestrutura/Mensageria/ConsumidorEventos.cs`**
   - Suporte RabbitMQ__Port, RabbitMQ__UseSsl
   - SslOption configurado via env var
   - Porta 5671 para AMQPS

5. **`/Infraestrutura/Mensageria/PublicadorOutbox.cs`**
   - Suporte TLS (RabbitMQ__UseSsl, Port)
   - Factory atualizado com SslOption

---

## 🔧 **Environment Variables (ECS)**

### **Faturamento (GO)**
```bash
# Database (RDS PostgreSQL)
DB_HOST=nfe-db.xxxxx.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=<secrets-manager>
DB_NAME=nfe_db
DB_SCHEMA=faturamento  # Schema isolado
DB_SSLMODE=require

# RabbitMQ (Amazon MQ - TLS porta 5671)
RABBITMQ_URL=amqps://user:pass@broker.mq.region.amazonaws.com:5671/

# Logging
LOG_LEVEL=INFO
ENVIRONMENT=production
```

### **Estoque (.NET)**
```bash
# Database (RDS PostgreSQL)
ConnectionStrings__DefaultConnection=Host=nfe-db.xxxxx.us-east-1.rds.amazonaws.com;Port=5432;Database=nfe_db;Username=admin;Password=<secrets>;SSL Mode=Require;Search Path=estoque
DB_SCHEMA=estoque

# RabbitMQ (Amazon MQ - TLS porta 5671)
RabbitMQ__Host=broker.mq.region.amazonaws.com
RabbitMQ__Port=5671
RabbitMQ__Username=admin
RabbitMQ__Password=<secrets-manager>
RabbitMQ__UseSsl=true

# Logging
Logging__LogLevel__Default=Information
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://+:5000
```

---

## 🧪 **Comandos de Teste Local**

### **1. Testar com Docker-Compose (defaults locais)**
```bash
# Faturamento
cd /mnt/d/Programacao/Emissao_NFE/servico-faturamento
go run cmd/api/main.go
curl http://localhost:8080/health | jq .

# Estoque
cd /mnt/d/Programacao/Emissao_NFE/servico-estoque
dotnet run
curl http://localhost:5000/health | jq .
```

### **2. Testar com Env Vars AWS (simulação)**
```bash
# Faturamento - simular ECS
export ENVIRONMENT=production
export LOG_LEVEL=DEBUG
export DB_HOST=localhost
export DB_SCHEMA=faturamento
export RABBITMQ_URL=amqp://admin:admin123@localhost:5672/
go run cmd/api/main.go

# Estoque - simular ECS
export ASPNETCORE_ENVIRONMENT=Production
export DB_SCHEMA=estoque
export RabbitMQ__Host=localhost
export RabbitMQ__Port=5672
export RabbitMQ__UseSsl=false
dotnet run

# Health check esperado:
{
  "status": "healthy",
  "service": "faturamento",
  "environment": "production",
  "timestamp": "2026-01-11T15:00:00Z",
  "checks": {
    "database": {
      "status": "ok",
      "latency_ms": 5
    },
    "rabbitmq": {
      "status": "ok",
      "latency_ms": 3
    }
  },
  "uptime_seconds": 120
}
```

---

## 📋 **Checklist Deploy AWS**

### **Preparação:**
- [x] Health checks robustos (DB + RabbitMQ)
- [x] Logging estruturado JSON (slog + Serilog)
- [x] 12-Factor config (env vars)
- [x] Graceful shutdown (SIGTERM/SIGINT)
- [x] TLS RabbitMQ (AMQPS porta 5671)
- [x] Schema PostgreSQL isolado (faturamento/estoque)
- [x] Defaults locais preservados (docker-compose funciona)

### **Próximos Passos (Deploy Specialist):**
1. Criar RDS PostgreSQL (1 instância, 2 schemas: faturamento + estoque)
2. Criar Amazon MQ (RabbitMQ broker com TLS)
3. Criar Secrets Manager (DB credentials + RabbitMQ URL)
4. Build imagens Docker + push ECR
5. Criar ECS Task Definitions (env vars + secrets)
6. Criar ECS Services + ALB Target Groups
7. Configurar ALB health checks (/health endpoint)
8. Testar deploy + monitorar logs CloudWatch

---

## 🚫 **NÃO Alterado (Garantido)**
- ✅ Lógica de negócio intacta
- ✅ Docker-compose local funcionando
- ✅ Estrutura de diretórios preservada
- ✅ Sem features novas adicionadas
- ✅ Sem quebra de compatibilidade

---

## 📝 **Arquivos de Referência**
1. **AWS_DEPLOY_ENV_VARS.md**: Guia completo de env vars + ECS Task Definitions
2. **BACKEND_AWS_PREP_SUMMARY.md**: Este resumo executivo

**Status:** ✅ **PRONTO PARA DEPLOY AWS**
