# Serviço de Faturamento - Microserviço Go

Microserviço responsável pelo gerenciamento de notas fiscais e processamento de solicitações de impressão com integração via RabbitMQ para orquestração de Saga distribuída.

## 🏗️ Arquitetura

```
servico-faturamento/
├── cmd/api/main.go              # Entrypoint da aplicação
├── internal/
│   ├── dominio/                 # Entidades de domínio
│   │   ├── notafiscal.go        # NotaFiscal + ItemNota
│   │   ├── solicitacaoimpressao.go
│   │   └── eventos.go           # EventoOutbox + MensagemProcessada
│   ├── manipulador/             # HTTP handlers (controllers)
│   │   └── notas.go             # Endpoints REST
│   ├── consumidor/              # Consumer RabbitMQ
│   │   └── consumidor.go        # Processa eventos de estoque
│   └── config/
│       └── database.go          # Conexão GORM + Migrations
├── go.mod
├── go.sum
├── Dockerfile
└── docker-compose.yml
```

## 🚀 Funcionalidades

### Endpoints REST (porta 8080)

#### Notas Fiscais
- `POST /api/v1/notas` - Criar nota fiscal
- `GET /api/v1/notas` - Listar notas (query param: ?status=ABERTA)
- `GET /api/v1/notas/:id` - Buscar nota específica
- `POST /api/v1/notas/:id/itens` - Adicionar item à nota
- `POST /api/v1/notas/:id/imprimir` - Solicitar impressão (requer header `Idempotency-Key`)

#### Solicitações de Impressão
- `GET /api/v1/solicitacoes-impressao/:id` - Consultar status da solicitação

### Processamento de Eventos (RabbitMQ)

**Exchange**: `estoque-eventos` (tipo: topic)  
**Fila**: `faturamento-eventos`

**Eventos Consumidos**:
- `Estoque.Reservado` → Fecha nota fiscal (lock pessimista)
- `Estoque.ReservaRejeitada` → Marca solicitação como FALHOU

## 🔐 Garantias de Qualidade

### Idempotência
- **HTTP**: Header `Idempotency-Key` obrigatório para `POST /notas/:id/imprimir`
- **RabbitMQ**: Tabela `mensagens_processadas` evita reprocessamento

### Consistência
- **Lock Pessimista**: `SELECT FOR UPDATE` ao fechar nota
- **Transações ACID**: Todas operações críticas em `db.Transaction()`
- **Outbox Pattern**: Eventos persistidos antes de serem publicados

### Isolamento
- Clean Architecture (domínio → manipulador → consumidor)
- Separação de responsabilidades (SOLID)
- Zero dependências circulares

## 📦 Dependências

```go
github.com/gin-gonic/gin v1.10.0              // Framework HTTP
github.com/google/uuid v1.6.0                 // Geração de UUIDs
github.com/rabbitmq/amqp091-go v1.10.0       // Cliente RabbitMQ
gorm.io/gorm v1.25.11                         // ORM
gorm.io/driver/postgres v1.5.9               // Driver PostgreSQL
```

## 🛠️ Comandos

### Desenvolvimento Local

```bash
# Instalar dependências
go mod download

# Executar (requer PostgreSQL + RabbitMQ)
go run cmd/api/main.go

# Build
go build -o servico-faturamento ./cmd/api
```

### Docker

```bash
# Subir todos os serviços (Postgres + RabbitMQ + API)
docker-compose up -d

# Ver logs
docker-compose logs -f servico-faturamento

# Rebuild
docker-compose up -d --build

# Parar
docker-compose down
```

### Makefile

```bash
make help          # Mostrar comandos disponíveis
make build         # Compilar
make run           # Executar localmente
make docker-up     # Iniciar containers
make docker-logs   # Ver logs
make test          # Executar testes
make clean         # Limpar binários
```

## 🔧 Configuração

Variáveis de ambiente (ver `.env.example`):

```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=faturamento_db

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672/

# Server
PORT=8080
GIN_MODE=debug
```

## 📊 Modelo de Dados

### Tabelas

1. **notas_fiscais**
   - `id` (UUID PK)
   - `numero` (UNIQUE)
   - `status` (ABERTA | FECHADA | CANCELADA)
   - `data_criacao`, `data_fechada`

2. **itens_nota**
   - `id` (UUID PK)
   - `nota_id` (FK → notas_fiscais)
   - `produto_id` (UUID)
   - `quantidade`, `preco_unitario`

3. **solicitacoes_impressao**
   - `id` (UUID PK)
   - `nota_id` (FK → notas_fiscais)
   - `status` (PENDENTE | CONCLUIDA | FALHOU)
   - `chave_idempotencia` (UNIQUE)
   - `mensagem_erro`

4. **eventos_outbox**
   - `id` (UUID PK)
   - `tipo_evento`, `id_agregado`, `payload` (JSONB)
   - `data_ocorrencia`, `data_publicacao`

5. **mensagens_processadas**
   - `id_mensagem` (PK) - para idempotência RabbitMQ
   - `data_processada`

## 🔄 Fluxo da Saga de Faturamento

```
1. Cliente → POST /notas/:id/imprimir (com Idempotency-Key)
2. API cria SolicitacaoImpressao (status: PENDENTE)
3. API publica evento: Faturamento.SolicitacaoImpressaoCriada
4. Serviço de Estoque consome evento e reserva estoque
5. Estoque publica: Estoque.Reservado OU Estoque.ReservaRejeitada

6a. Se Estoque.Reservado:
    - Consumidor fecha nota fiscal (SELECT FOR UPDATE)
    - Atualiza solicitação para CONCLUIDA
    - Publica: Faturamento.NotaFechada

6b. Se Estoque.ReservaRejeitada:
    - Consumidor marca solicitação como FALHOU
    - Armazena mensagem de erro
```

## 🧪 Testando

### Criar Nota Fiscal

```bash
curl -X POST http://localhost:8080/api/v1/notas \
  -H "Content-Type: application/json" \
  -d '{"numero": "NF-2025-001"}'
```

### Adicionar Item

```bash
curl -X POST http://localhost:8080/api/v1/notas/{nota_id}/itens \
  -H "Content-Type: application/json" \
  -d '{
    "produto_id": "123e4567-e89b-12d3-a456-426614174000",
    "quantidade": 10,
    "preco_unitario": 99.90
  }'
```

### Solicitar Impressão (Idempotente)

```bash
curl -X POST http://localhost:8080/api/v1/notas/{nota_id}/imprimir \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-12345"
```

### Consultar Status

```bash
curl http://localhost:8080/api/v1/solicitacoes-impressao/{solicitacao_id}
```

## 🐰 RabbitMQ Management

Acesse: http://localhost:15672  
Credenciais: `guest` / `guest`

## 🔍 Health Check

```bash
curl http://localhost:8080/health
# {"servico":"faturamento","status":"ok"}
```

## 📝 Convenções de Código

- **Nomes**: PT-BR orgânicos (ServicoImpressao, ProcessarReserva)
- **Estrutura**: Clean Architecture (domínio isolado)
- **Transações**: Sempre usar `db.Transaction()` para operações críticas
- **Locks**: Lock pessimista com `clause.Locking{Strength:"UPDATE"}` ao fechar notas
- **Logs**: Formato estruturado com emojis (✓ sucesso, ✗ erro, → ação, ⚠ warning)

## 🚨 Tratamento de Erros

- **400 Bad Request**: Validação falhou
- **404 Not Found**: Recurso não existe
- **409 Conflict**: Violação de constraint (ex: número de nota duplicado)
- **500 Internal Server Error**: Falha no processamento

## 🔒 Segurança

- Nenhuma informação sensível em logs
- Validação de entrada em todos os endpoints
- CORS configurado (ajustar para produção)
- Prepared statements (GORM) protege contra SQL Injection

## 📈 Performance

- Connection pooling automático (GORM)
- Índices em `nota_id`, `tipo_evento`, `id_agregado`
- Preload seletivo para evitar N+1 queries
- Lock pessimista apenas quando necessário

## 🏢 Produção

### Checklist
- [ ] Ajustar `GIN_MODE=release`
- [ ] Configurar CORS restritivo
- [ ] Implementar rate limiting
- [ ] Configurar observability (Prometheus/Grafana)
- [ ] Implementar circuit breaker para RabbitMQ
- [ ] Configurar retries exponenciais
- [ ] Habilitar SSL/TLS no PostgreSQL
- [ ] Implementar authentication/authorization

---

**Stack**: Go 1.22 | Gin | GORM | PostgreSQL 15 | RabbitMQ 3.12  
**Padrões**: Clean Architecture | Saga Pattern | Outbox Pattern | Idempotency