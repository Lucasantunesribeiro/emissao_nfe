> **Documento legado.** Descreve a fase com PostgreSQL, RabbitMQ e API HTTP (`cmd/api`), que nao existe mais. A arquitetura atual (Lambdas + DynamoDB + EventBridge/SQS) esta no README da raiz e em `docs/adr`.

# Arquitetura Técnica - Serviço de Faturamento

## 📋 Visão Geral

Microserviço Go responsável pela gestão de notas fiscais e orquestração da Saga de Faturamento através de eventos assíncronos via RabbitMQ.

## 🎯 Decisões Arquiteturais

### 1. Clean Architecture

```
Camada de Apresentação (HTTP)
    ↓
Camada de Aplicação (Handlers)
    ↓
Camada de Domínio (Entidades + Lógica de Negócio)
    ↓
Camada de Infraestrutura (GORM + RabbitMQ)
```

**Benefícios**:
- Domínio isolado sem dependências externas
- Testabilidade (mocking de infraestrutura)
- Facilita mudanças de tecnologia

### 2. Saga Pattern - Orquestração Baseada em Eventos

**Padrão Escolhido**: Coreografia (Event-Driven)

**Fluxo**:
```
Faturamento → SolicitacaoImpressaoCriada → Estoque
Estoque → Reservado/ReservaRejeitada → Faturamento
Faturamento → NotaFechada → [Outros serviços]
```

**Justificativa**:
- Baixo acoplamento entre serviços
- Escalabilidade horizontal
- Resiliência (falha em um serviço não bloqueia outros)

### 3. Outbox Pattern

**Problema**: Garantir consistência entre banco de dados e mensageria.

**Solução**: Eventos persistidos na tabela `eventos_outbox` na mesma transação das alterações de estado.

```go
db.Transaction(func(tx *gorm.DB) error {
    // 1. Criar solicitação
    tx.Create(&solicitacao)
    
    // 2. Criar evento na outbox
    tx.Create(&eventoOutbox)
    
    return nil
})
```

**Publisher Separado** (não implementado nesta versão):
- Worker assíncrono lê `eventos_outbox` WHERE `data_publicacao IS NULL`
- Publica no RabbitMQ
- Atualiza `data_publicacao`

### 4. Idempotência - Duas Camadas

#### Camada HTTP (Requisições Duplicadas)
```
Header: Idempotency-Key: unique-uuid-12345

Constraint: UNIQUE(chave_idempotencia)
```

**Comportamento**:
- Primeira requisição → 201 Created
- Requisições subsequentes com mesma chave → 200 OK (retorna existente)

#### Camada RabbitMQ (Reprocessamento de Eventos)
```go
// Verificar se mensagem já foi processada
var msgProcessada MensagemProcessada
if db.First(&msgProcessada, "id_mensagem = ?", evento.IdMensagem).Error == nil {
    return nil // Já processado - confirmar sem reprocessar
}

// Processar + registrar atomicamente
db.Transaction(func(tx *gorm.DB) error {
    tx.Create(&MensagemProcessada{IdMensagem: evento.IdMensagem})
    // ... lógica de negócio
})
```

### 5. Lock Pessimista

**Problema**: Condição de corrida ao fechar nota (múltiplos eventos Estoque.Reservado).

**Solução**: `SELECT FOR UPDATE` usando GORM.

```go
db.Transaction(func(tx *gorm.DB) error {
    var nota NotaFiscal
    tx.Clauses(clause.Locking{Strength: "UPDATE"}).
       First(&nota, notaID) // Lock na linha
    
    nota.Fechar()
    tx.Save(&nota)
    
    return nil
}) // Lock liberado ao fim da transação
```

**Alternativa Descartada**: Lock Otimista (versioning)
- Mais complexo implementar retry logic
- Lock pessimista é adequado dado baixo volume de contenção esperado

### 6. Validações em Múltiplas Camadas

```
Layer 1: Gin Binding Tags
    ↓
Layer 2: Domain Methods (ex: Fechar())
    ↓
Layer 3: GORM Hooks (BeforeCreate)
```

**Exemplo**:
```go
// Layer 1: HTTP
type AdicionarItemRequest struct {
    Quantidade int `json:"quantidade" binding:"required,gt=0"`
}

// Layer 2: Domínio
func (n *NotaFiscal) Fechar() error {
    if n.Status != StatusNotaAberta {
        return errors.New("nota deve estar ABERTA")
    }
}

// Layer 3: GORM
func (i *ItemNota) BeforeCreate(tx *gorm.DB) error {
    if i.PrecoUnitario <= 0 {
        return errors.New("preço inválido")
    }
}
```

## 🔒 Garantias de Consistência

### ACID Transactions

Toda operação crítica usa `db.Transaction()`:

```go
✓ Criar solicitação + evento outbox
✓ Fechar nota + atualizar solicitação + criar evento
✓ Processar evento + registrar mensagem processada
```

### Níveis de Isolamento

PostgreSQL padrão: **READ COMMITTED**

Lock pessimista (`FOR UPDATE`) eleva para **SERIALIZABLE** na linha específica.

### Rollback Automático

```go
db.Transaction(func(tx *gorm.DB) error {
    // Se qualquer operação retornar erro
    return err // → ROLLBACK automático
})
```

## 🚀 Performance

### 1. Connection Pooling

GORM gerencia pool automaticamente:
```go
sqlDB, _ := db.DB()
sqlDB.SetMaxOpenConns(25)      // Máximo de conexões
sqlDB.SetMaxIdleConns(5)       // Conexões em idle
sqlDB.SetConnMaxLifetime(5min) // Lifetime máximo
```

### 2. Índices Estratégicos

```sql
-- Criados automaticamente por GORM
CREATE INDEX idx_notas_fiscais_numero ON notas_fiscais(numero);
CREATE INDEX idx_itens_nota_nota_id ON itens_nota(nota_id);
CREATE INDEX idx_solicitacoes_chave ON solicitacoes_impressao(chave_idempotencia);
CREATE INDEX idx_eventos_tipo ON eventos_outbox(tipo_evento);
CREATE INDEX idx_eventos_agregado ON eventos_outbox(id_agregado);
```

### 3. Preload Seletivo

```go
// ✗ N+1 Problem
db.Find(&notas)
for _, nota := range notas {
    db.Find(&nota.Itens) // N queries
}

// ✓ Single Query Join
db.Preload("Itens").Find(&notas)
```

### 4. QoS RabbitMQ

```go
channel.Qos(
    1,     // prefetchCount: processa 1 mensagem por vez
    0,     // prefetchSize: sem limite de tamanho
    false, // global: apenas este consumer
)
```

**Impacto**: Evita sobrecarga do consumidor.

## 🛡️ Segurança

### 1. SQL Injection - Prevenção

GORM usa **prepared statements** automaticamente:

```go
// ✓ Seguro (parametrizado)
db.First(&nota, "numero = ?", numeroUsuario)

// ✗ Inseguro (não usar!)
db.Raw("SELECT * FROM notas WHERE numero = " + numeroUsuario)
```

### 2. Validação de UUID

```go
id, err := uuid.Parse(idParam)
if err != nil {
    return BadRequest // Rejeita IDs malformados
}
```

### 3. CORS

```go
// Desenvolvimento: permissivo
c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

// Produção: restritivo
c.Writer.Header().Set("Access-Control-Allow-Origin", "https://app.example.com")
```

## 📊 Observabilidade

### Logs Estruturados

```go
log.Printf("✓ Nota fiscal fechada: %s (ID: %s)", nota.Numero, nota.ID)
log.Printf("✗ Erro ao processar evento: %v", err)
log.Printf("→ Recebido evento: %s", evento.TipoEvento)
log.Printf("⚠ Solicitação marcada como FALHOU: %s", solicitacao.ID)
```

**Padrão**:
- `✓` Sucesso
- `✗` Erro crítico
- `→` Ação iniciada
- `⚠` Warning
- `⊗` Operação ignorada (idempotência)

### Métricas (Próxima Iteração)

```go
// Prometheus metrics
var (
    notasFechadasTotal = prometheus.NewCounter(...)
    duracaoFechamento  = prometheus.NewHistogram(...)
    eventosFalhos      = prometheus.NewCounter(...)
)
```

## 🧪 Estratégia de Testes

### 1. Testes Unitários (Domínio)

```go
func TestNotaFiscal_Fechar(t *testing.T) {
    // Given
    nota := &NotaFiscal{Status: StatusNotaAberta, Itens: [...]ItemNota{...}}
    
    // When
    err := nota.Fechar()
    
    // Then
    assert.Nil(t, err)
    assert.Equal(t, StatusNotaFechada, nota.Status)
}
```

### 2. Testes de Integração (Handlers + DB)

```go
func TestCriarNota_Integration(t *testing.T) {
    // Setup: DB in-memory ou testcontainer
    db := setupTestDB()
    
    // Given
    router := setupRouter(db)
    req := httptest.NewRequest("POST", "/api/v1/notas", body)
    
    // When
    w := httptest.NewRecorder()
    router.ServeHTTP(w, req)
    
    // Then
    assert.Equal(t, 201, w.Code)
}
```

### 3. Testes E2E (RabbitMQ)

```go
func TestSagaFaturamento_E2E(t *testing.T) {
    // 1. Criar nota
    // 2. Solicitar impressão
    // 3. Publicar Estoque.Reservado
    // 4. Verificar nota FECHADA
}
```

## 🔄 Ciclo de Vida da Requisição

### POST /notas/:id/imprimir

```
1. Gin Router → manipulador.SolicitarImpressao()
2. Validar Idempotency-Key header
3. Verificar chave existente (idempotência)
4. Buscar nota + validar estado
5. db.Transaction:
   a. Criar SolicitacaoImpressao
   b. Criar EventoOutbox
6. Retornar 201 Created
```

### Consumidor RabbitMQ - Estoque.Reservado

```
1. RabbitMQ entrega mensagem
2. Deserializar JSON → EventoEstoque
3. Verificar mensagens_processadas (idempotência)
4. db.Transaction:
   a. Inserir MensagemProcessada
   b. SELECT FOR UPDATE nota
   c. nota.Fechar()
   d. Atualizar solicitacao → CONCLUIDA
   e. Criar EventoOutbox (NotaFechada)
5. ACK mensagem
```

## 📦 Deploy

### Docker Multi-Stage Build

```dockerfile
# Stage 1: Build
FROM golang:1.22-alpine AS builder
COPY . .
RUN go build -o servico-faturamento ./cmd/api

# Stage 2: Runtime
FROM alpine:latest
COPY --from=builder /app/servico-faturamento .
CMD ["./servico-faturamento"]
```

**Tamanho da imagem**: ~20MB (vs ~800MB com golang:1.22)

### Graceful Shutdown

```go
sigChan := make(chan os.Signal, 1)
signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
<-sigChan

// 1. Fechar consumidor RabbitMQ
consumidor.Fechar()

// 2. Fechar conexões DB
sqlDB.Close()

// 3. Finalizar servidor HTTP
server.Shutdown(ctx)
```

## 🔮 Melhorias Futuras

### 1. Circuit Breaker (RabbitMQ)

```go
breaker := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "rabbitmq",
    MaxRequests: 3,
    Timeout:     60 * time.Second,
})
```

### 2. Retry Exponencial

```go
backoff := backoff.NewExponentialBackOff()
backoff.MaxElapsedTime = 5 * time.Minute

backoff.Retry(func() error {
    return processarEvento(msg)
}, backoff)
```

### 3. Dead Letter Queue

```yaml
# RabbitMQ config
x-dead-letter-exchange: faturamento-dlx
x-dead-letter-routing-key: dlq
x-message-ttl: 300000  # 5 minutos
```

### 4. Outbox Publisher Worker

```go
// Worker assíncrono (goroutine)
for {
    eventos := db.Where("data_publicacao IS NULL").Limit(100).Find(&EventoOutbox{})
    
    for _, evento := range eventos {
        channel.Publish(evento)
        db.Model(&evento).Update("data_publicacao", time.Now())
    }
    
    time.Sleep(1 * time.Second)
}
```

---

**Stack**: Go 1.22 | Gin | GORM | PostgreSQL 15 | RabbitMQ 3.12  
**Padrões**: Clean Architecture | Saga | Outbox | Idempotency | Pessimistic Locking