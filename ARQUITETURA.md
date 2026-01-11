# 🏗️ ARQUITETURA DO SISTEMA - NFe Microserviços

## 📐 Visão Geral

Sistema distribuído para emissão de notas fiscais implementando **Saga Pattern** coreografada com comunicação assíncrona via eventos.

```
┌─────────────────┐          ┌─────────────────┐          ┌─────────────────┐
│                 │          │                 │          │                 │
│  FRONTEND       │          │  FATURAMENTO    │          │   ESTOQUE       │
│  Angular 17     │◄────────►│  Go 1.23        │◄────────►│   C# .NET 9     │
│                 │   HTTP   │  + GORM         │  Events  │   + EF Core     │
└─────────────────┘          └─────────────────┘          └─────────────────┘
                                      │                             │
                                      │                             │
                                      ▼                             ▼
                              ┌──────────────┐            ┌──────────────┐
                              │  PostgreSQL  │            │  PostgreSQL  │
                              │ Faturamento  │            │   Estoque    │
                              └──────────────┘            └──────────────┘
                                      │                             │
                                      └─────────────┬───────────────┘
                                                    │
                                                    ▼
                                            ┌──────────────┐
                                            │   RabbitMQ   │
                                            │ Message Bus  │
                                            └──────────────┘
```

---

## 🔄 Fluxo da Saga Pattern

### Cenário: Impressão de Nota Fiscal

```
1️⃣ USUÁRIO                    2️⃣ FATURAMENTO                3️⃣ RABBITMQ                  4️⃣ ESTOQUE
────────────────────────────────────────────────────────────────────────────────────────────────────────
   │                              │                              │                              │
   │ POST /notas/{id}/imprimir    │                              │                              │
   ├─────────────────────────────►│                              │                              │
   │                              │                              │                              │
   │                              │ BEGIN TX                     │                              │
   │                              │ ├─ INSERT SolicitacaoImpressao│                             │
   │                              │ │  (status: PENDENTE)        │                              │
   │                              │ ├─ INSERT eventos_outbox     │                              │
   │                              │ │  Faturamento.ImpressaoSolicitada                          │
   │                              │ COMMIT                       │                              │
   │                              │                              │                              │
   │ {"solicitacaoId":"..."}      │                              │                              │
   │◄─────────────────────────────┤                              │                              │
   │                              │                              │                              │
   │                              │ PublicadorOutbox (worker)    │                              │
   │                              │ ├─ SELECT ... WHERE data_publicacao IS NULL                 │
   │                              │ ├─ PUBLISH ───────────────────►│                             │
   │                              │ └─ UPDATE data_publicacao    │                              │
   │                              │                              │                              │
   │                              │                              │ ROUTE: Faturamento.ImpressaoSolicitada
   │                              │                              │ EXCHANGE: faturamento-eventos│
   │                              │                              │ QUEUE: estoque-eventos       │
   │                              │                              │                              │
   │                              │                              │ CONSUME ─────────────────────►│
   │                              │                              │                              │
   │                              │                              │                              │ BEGIN TX
   │                              │                              │                              │ ├─ SELECT ... idempotência
   │                              │                              │                              │ ├─ SELECT produto FOR UPDATE (xmin)
   │                              │                              │                              │ ├─ VALIDA saldo >= quantidade
   │                              │                              │                              │ │  ✓ OK: debita estoque
   │                              │                              │                              │ │  ✗ FALHA: rejeita
   │                              │                              │                              │ ├─ INSERT ReservaEstoque
   │                              │                              │                              │ ├─ INSERT eventos_outbox
   │                              │                              │                              │ │  Estoque.Reservado
   │                              │                              │                              │ ├─ INSERT mensagens_processadas
   │                              │                              │                              │ COMMIT
   │                              │                              │                              │
   │                              │                              │ PUBLISH ◄────────────────────┤
   │                              │                              │                              │
   │                              │                              │ ROUTE: Estoque.Reservado     │
   │                              │                              │ EXCHANGE: estoque-eventos    │
   │                              │                              │ QUEUE: faturamento-eventos   │
   │                              │                              │                              │
   │                              │ CONSUME ◄────────────────────┤                              │
   │                              │                              │                              │
   │                              │ BEGIN TX                     │                              │
   │                              │ ├─ SELECT ... idempotência   │                              │
   │                              │ ├─ SELECT nota FOR UPDATE    │                              │
   │                              │ │  .Preload("Itens")         │                              │
   │                              │ ├─ nota.Fechar()            │                              │
   │                              │ │  (ABERTA → FECHADA)        │                              │
   │                              │ ├─ UPDATE SolicitacaoImpressao│                             │
   │                              │ │  (PENDENTE → CONCLUIDA)    │                              │
   │                              │ ├─ INSERT mensagens_processadas│                            │
   │                              │ COMMIT                       │                              │
   │                              │                              │                              │
   │ GET /solicitacoes/{id}       │                              │                              │
   ├─────────────────────────────►│                              │                              │
   │ {"status":"CONCLUIDA"}       │                              │                              │
   │◄─────────────────────────────┤                              │                              │
```

---

## 🎯 Padrões Implementados

### 1. **Saga Pattern (Coreografada)**

**O que é**: Coordenação de transações distribuídas através de eventos, sem orquestrador central.

**Por que usar**: Garante consistência eventual entre microserviços sem acoplamento direto.

**Implementação**:
- Cada serviço publica eventos sobre mudanças de estado
- Outros serviços reagem aos eventos de forma autônoma
- Compensação automática em caso de falha

**Exemplo**:
```go
// Faturamento publica evento
evento := EventoOutbox{
    TipoEvento: "Faturamento.ImpressaoSolicitada",
    Payload: json.Marshal(solicitacao),
}
tx.Create(&evento)
```

```csharp
// Estoque reage ao evento
var evento = JsonSerializer.Deserialize<EventoImpressao>(mensagem);
var resultado = await _handler.ReservarEstoque(evento.NotaId, evento.ProdutoId, evento.Quantidade);
```

---

### 2. **Transactional Outbox Pattern**

**O que é**: Garante atomicidade entre mudança de estado no banco e publicação de evento.

**Por que usar**: Evita o problema do "dual write" (escrever no banco E publicar mensagem não é atômico).

**Implementação**:
```sql
-- Tabela eventos_outbox
CREATE TABLE eventos_outbox (
    id BIGSERIAL PRIMARY KEY,
    tipo_evento VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    data_ocorrencia TIMESTAMPTZ NOT NULL,
    data_publicacao TIMESTAMPTZ,  -- NULL = pendente
    tentativas_envio INT DEFAULT 0
);
```

**Fluxo**:
1. Transação: salva mudança + evento no outbox
2. Worker assíncrono: publica eventos pendentes
3. Marca evento como publicado após sucesso

---

### 3. **Idempotência**

**O que é**: Garantia de que processar a mesma mensagem múltiplas vezes gera o mesmo resultado.

**Por que usar**: RabbitMQ pode entregar mensagens duplicadas (at-least-once delivery).

**Implementação HTTP**:
```go
// Header Idempotency-Key
chaveIdem := r.Header.Get("Idempotency-Key")
var existente SolicitacaoImpressao
if err := tx.Where("chave_idempotencia = ?", chaveIdem).First(&existente).Error; err == nil {
    // retorna solicitação existente
}
```

**Implementação Mensageria**:
```csharp
// Tabela mensagens_processadas
var jaProcessada = await _ctx.MensagensProcessadas
    .AnyAsync(m => m.IDMensagem == idMensagem);
if (jaProcessada) return; // ignora
```

---

### 4. **Controle de Concorrência**

#### Otimistic Locking (Estoque - C#)

**O que é**: Permite leitura concorrente, detecta conflitos no momento do commit.

**Por que usar**: Alta performance em cenários com baixa contenção.

**Implementação**:
```csharp
// EF Core com xmin (system column do PostgreSQL)
builder.Entity<Produto>(p =>
{
    p.Property(x => x.Versao)
        .HasColumnName("xmin")
        .IsRowVersion();
});

// Ao salvar, EF Core verifica se xmin mudou
await _ctx.SaveChangesAsync(); // → DbUpdateConcurrencyException se conflito
```

#### Pessimistic Locking (Faturamento - Go)

**O que é**: Trava registro no momento da leitura, bloqueando outras transações.

**Por que usar**: Garante exclusividade em operações críticas (fechar nota).

**Implementação**:
```go
// GORM com SELECT FOR UPDATE
var nota NotaFiscal
tx.Clauses(clause.Locking{Strength: "UPDATE"}).
    Preload("Itens").
    First(&nota, "id = ?", notaID)
// Outras transações aguardam até commit
```

---

## 🗄️ Modelo de Dados

### Faturamento (PostgreSQL)
```sql
-- notas_fiscais
id UUID PK
numero VARCHAR(20) UNIQUE
status VARCHAR(20)  -- ABERTA, FECHADA
data_criacao TIMESTAMPTZ

-- itens_nota
id UUID PK
nota_id UUID FK → notas_fiscais
produto_id UUID  -- referência lógica ao Estoque
quantidade INT
preco_unitario DECIMAL(10,2)

-- solicitacoes_impressao
id UUID PK
nota_id UUID FK → notas_fiscais
status VARCHAR(20)  -- PENDENTE, CONCLUIDA, FALHOU
mensagem_erro TEXT
chave_idempotencia VARCHAR(100) UNIQUE
data_criacao TIMESTAMPTZ
data_conclusao TIMESTAMPTZ

-- eventos_outbox
id BIGSERIAL PK
tipo_evento VARCHAR(100)
id_agregado UUID
payload JSONB
data_ocorrencia TIMESTAMPTZ
data_publicacao TIMESTAMPTZ
tentativas_envio INT DEFAULT 0

-- mensagens_processadas (idempotência)
id_mensagem VARCHAR(100) PK
data_processada TIMESTAMPTZ
```

### Estoque (PostgreSQL)

```sql
-- produtos
id UUID PK
sku VARCHAR(50) UNIQUE
nome VARCHAR(200)
saldo INT CHECK (saldo >= 0)
ativo BOOLEAN
data_criacao TIMESTAMPTZ
xmin XID  -- versão para concorrência otimista

-- reservas_estoque
id UUID PK
nota_id UUID  -- referência lógica ao Faturamento
produto_id UUID FK → produtos
quantidade INT
status VARCHAR(20)  -- RESERVADO, CANCELADO
data_criacao TIMESTAMPTZ

-- eventos_outbox
id BIGSERIAL PK
tipo_evento VARCHAR(100)
id_agregado UUID
payload JSONB
data_ocorrencia TIMESTAMPTZ
data_publicacao TIMESTAMPTZ
tentativas_envio INT DEFAULT 0

-- mensagens_processadas (idempotência)
id_mensagem VARCHAR(100) PK
data_processada TIMESTAMPTZ
```

---

## 📨 Topologia RabbitMQ

### Exchanges

```
faturamento-eventos (topic)
├── Routing Key: Faturamento.ImpressaoSolicitada
│   └── Consumidor: Estoque
│
└── Routing Key: Faturamento.* (wildcards suportados)

estoque-eventos (topic)
├── Routing Key: Estoque.Reservado
│   └── Consumidor: Faturamento
│
├── Routing Key: Estoque.ReservaRejeitada
│   └── Consumidor: Faturamento
│
└── Routing Key: Estoque.* (wildcards suportados)
```

### Queues

```
estoque-eventos (durable)
├── Bindings:
│   └── faturamento-eventos → Faturamento.ImpressaoSolicitada
├── Consumer: ConsumidorEventos (C#)
├── QoS: prefetch=1
└── Auto-ACK: false (manual)

faturamento-eventos (durable)
├── Bindings:
│   ├── estoque-eventos → Estoque.Reservado
│   └── estoque-eventos → Estoque.ReservaRejeitada
├── Consumer: Consumidor (Go)
├── QoS: prefetch=1
└── Auto-ACK: false (manual)
```

### Configuração de Durabilidade

```go
// Declaração de exchange (Go)
ch.ExchangeDeclare(
    "faturamento-eventos",  // nome
    "topic",                // tipo
    true,                   // durable
    false,                  // auto-deleted
    false,                  // internal
    false,                  // no-wait
    nil,
)

// Declaração de fila (C#)
_canal.QueueDeclare(
    queue: "estoque-eventos",
    durable: true,
    exclusive: false,
    autoDelete: false,
    arguments: null
);

// QoS (limita mensagens em processamento)
_canal.BasicQos(0, 1, false);  // 1 mensagem por vez
```

---

## 🔄 Cenários de Falha

### 1. Saldo Insuficiente

```
Faturamento                          Estoque
    │                                   │
    │ Faturamento.ImpressaoSolicitada   │
    ├──────────────────────────────────►│
    │                                   │
    │                                   │ BEGIN TX
    │                                   │ ├─ Validar saldo
    │                                   │ │  saldo=5, solicitado=10
    │                                   │ │  ✗ INSUFICIENTE
    │                                   │ ├─ INSERT eventos_outbox
    │                                   │ │  Estoque.ReservaRejeitada
    │                                   │ COMMIT (sem debitar)
    │                                   │
    │ Estoque.ReservaRejeitada          │
    │◄──────────────────────────────────┤
    │                                   │
    │ BEGIN TX                          │
    │ └─ UPDATE solicitacao             │
    │    status=FALHOU                  │
    │    mensagem="Saldo insuficiente"  │
    │ COMMIT                            │
```

**Resultado**: 
- ✓ Estoque não debitado
- ✓ Nota permanece ABERTA
- ✓ Solicitação marcada como FALHOU com mensagem descritiva

### 2. Simulação de Falha (X-Demo-Fail)

```csharp
// ReservarEstoqueHandler.cs
if (simularFalha)
{
    _logger.LogWarning("Falha simulada antes do commit");
    throw new InvalidOperationException("Falha simulada");
}

await _ctx.SaveChangesAsync();
await tx.CommitAsync();
```

**Fluxo**:
1. Estoque debita produto ✓
2. Cria reserva ✓
3. Header `X-Demo-Fail: true` detectado
4. **Exception lançada ANTES do commit**
5. Rollback automático da transação
6. Nenhum evento publicado
7. Faturamento não recebe resposta

**Resultado**:
- ✓ Rollback completo no Estoque
- ✓ Saga interrompida corretamente
- ✓ Sem inconsistências entre serviços

### 3. Conflito de Concorrência

```csharp
// Dois usuários tentam reservar o mesmo produto simultaneamente
User A: SELECT produto (xmin=100)
User B: SELECT produto (xmin=100)

User A: UPDATE produto SET saldo=saldo-10  // xmin → 101
User A: COMMIT ✓

User B: UPDATE produto SET saldo=saldo-20
User B: COMMIT
// → DbUpdateConcurrencyException!
// EF Core detecta xmin mudou (100 → 101)
```

**Tratamento**:
```csharp
catch (DbUpdateConcurrencyException ex)
{
    await tx.RollbackAsync();
    
    // Publica evento de rejeição
    var evt = new EventoOutbox {
        TipoEvento = "Estoque.ReservaRejeitada",
        Payload = JsonSerializer.Serialize(new { 
            motivo = "Conflito de concorrência" 
        })
    };
    _ctx.EventosOutbox.Add(evt);
    await _ctx.SaveChangesAsync();
}
```

---

## 🚀 Tecnologias e Decisões Arquiteturais

### Por que C# para Estoque?

- ✅ EF Core suporta `xmin` nativamente (concorrência otimista)
- ✅ LINQ oferece queries type-safe
- ✅ Background Services integrados no ASP.NET Core
- ✅ System.Text.Json para serialização de eventos

### Por que Go para Faturamento?

- ✅ Performance superior para worker de outbox
- ✅ GORM simplifica pessimistic locking
- ✅ Gin framework minimalista e rápido
- ✅ Compilação estática facilita deploy

### Por que RabbitMQ?

- ✅ Topic exchanges com routing patterns flexíveis
- ✅ Garantia de entrega (at-least-once)
- ✅ Management UI para debug
- ✅ Suporte nativo a ACK/NACK

### Por que PostgreSQL?

- ✅ `xmin` para optimistic locking sem coluna extra
- ✅ JSONB para payloads de eventos
- ✅ Transações ACID robustas
- ✅ Índices parciais (`WHERE data_publicacao IS NULL`)

---

## 📊 Observabilidade

### Logs Estruturados

**Faturamento (Go)**:
```go
log.Printf("✓ Evento publicado: %s (ID: %d)", evento.TipoEvento, evento.ID)
log.Printf("Nota %s fechada com sucesso", notaID)
log.Printf("Erro ao processar mensagem: %v", err)
```

**Estoque (C#)**:
```csharp
_logger.LogInformation("✓ Reserva criada para produto {ProdutoId}", produto.Id);
_logger.LogWarning("Saldo insuficiente. Disponível: {Disponivel}, Solicitado: {Solicitado}", 
    produto.Saldo, quantidade);
_logger.LogError(ex, "Conflito de concorrência ao reservar estoque");
```

### Métricas Importantes

1. **Latência da Saga**
   - Tempo entre `ImpressaoSolicitada` e `SolicitacaoImpressao.CONCLUIDA`
   - Meta: < 3 segundos

2. **Taxa de Falha**
   - Quantidade de `ReservaRejeitada` / Total de solicitações
   - Meta: < 5%

3. **Backlog do Outbox**
   - `SELECT COUNT(*) FROM eventos_outbox WHERE data_publicacao IS NULL`
   - Meta: < 100 eventos pendentes

4. **Dead Letters (DLQ)**
   - Mensagens que falharam após retries
   - Meta: 0 (todas devem ser processadas ou rejeitadas explicitamente)

---

## 🔐 Segurança e Resiliência

### Timeouts

```csharp
// HTTP Client (Angular)
timeout(30000)  // 30 segundos

// Database (C#)
npgsql.CommandTimeout(30);

// RabbitMQ Consumer (Go)
err := tx.Model(&dominio.SolicitacaoImpressao{}).
    Where("nota_id = ? AND status = ?", notaID, "PENDENTE").
    Updates(...)  // timeout implícito da conexão
```

### Retry Policy

```go
// PublicadorOutbox com retry
if tentativas < 3 {
    evento.TentativasEnvio++
    tx.Save(&evento)
    return nil  // aguarda próxima execução
}
// Após 3 falhas, marca como erro definitivo
```

### Circuit Breaker (Futuro)

```go
// Recomendação: github.com/sony/gobreaker
cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
    Name:        "RabbitMQ",
    MaxRequests: 3,
    Timeout:     60 * time.Second,
})
```

---

## 📈 Próximas Melhorias

### Curto Prazo

1. **Dashboard de Monitoramento**
   - Grafana + Prometheus
   - Métricas de latência, throughput, erros

2. **Dead Letter Queue**
   - Configurar DLQ no RabbitMQ
   - Worker para reprocessar mensagens falhadas

3. **Compensação Explícita**
   - Endpoint `POST /reservas/{id}/cancelar`
   - Rollback manual para casos excepcionais

### Médio Prazo

1. **Event Sourcing**
   - Migrar de state-based para event log
   - Replay de eventos para debugging

2. **CQRS**
   - Separar modelos de leitura/escrita
   - Cache de projeções com Redis

3. **Service Mesh**
   - Istio/Linkerd para traffic management
   - Distributed tracing com OpenTelemetry

### Longo Prazo

1. **Orquestração Temporal**
   - Migrar de coreografia para Temporal.io
   - Workflows persistentes com retry automático

2. **Multi-Tenancy**
   - Suporte a múltiplos clientes/empresas
   - Isolamento de dados por tenant

---

## 🎓 Conceitos Avançados Aplicados

### CAP Theorem

Este sistema escolhe **AP** (Availability + Partition Tolerance):
- ✓ Disponibilidade: serviços operam independentemente
- ✓ Tolerância a partições: mensageria assíncrona resiste a falhas de rede
- ✗ Consistência forte: usa consistência eventual via eventos

### BASE vs ACID

**ACID** (dentro de cada serviço):
- Atomicity: transações locais
- Consistency: constraints do banco
- Isolation: locks otimistas/pessimistas
- Durability: WAL do PostgreSQL

**BASE** (entre serviços):
- Basically Available: sempre responde
- Soft state: estado temporário até propagação de eventos
- Eventual consistency: consistência garantida após processamento completo da saga

### Two-Phase Commit vs Saga

**Por que não 2PC?**
- ❌ Coordenador centralizado (ponto único de falha)
- ❌ Locks distribuídos (baixa performance)
- ❌ Acoplamento forte entre serviços

**Vantagens da Saga**:
- ✅ Descentralização (maior resiliência)
- ✅ Compensações assíncronas (melhor UX)
- ✅ Evolução independente de serviços

---

## 📚 Referências

1. **Saga Pattern**
   - [Microsoft: Saga distributed transactions pattern](https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)
   - [Chris Richardson: Pattern: Saga](https://microservices.io/patterns/data/saga.html)

2. **Transactional Outbox**
   - [Debezium: Outbox Event Router](https://debezium.io/documentation/reference/transformations/outbox-event-router.html)
   - [Microservices.io: Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)

3. **Event-Driven Architecture**
   - [Martin Fowler: Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)
   - [AWS: Event-driven architecture](https://aws.amazon.com/event-driven-architecture/)

4. **Concurrency Control**
   - [PostgreSQL: Concurrency Control](https://www.postgresql.org/docs/current/mvcc.html)
   - [Microsoft: Optimistic Concurrency in EF Core](https://learn.microsoft.com/en-us/ef/core/saving/concurrency)

---

## 🏆 Conclusão

Esta arquitetura demonstra implementação profissional de padrões modernos para sistemas distribuídos:

✅ **Saga Pattern** para transações distribuídas  
✅ **Transactional Outbox** para consistência eventual  
✅ **Idempotência** em HTTP e mensageria  
✅ **Concorrência otimista** (xmin) e **pessimista** (SELECT FOR UPDATE)  
✅ **Event-Driven Architecture** com RabbitMQ  
✅ **Polyglot Persistence** com stack híbrida C#/Go  

O sistema está pronto para escalar horizontalmente, suporta falhas parciais e mantém consistência eventual sem acoplamento forte entre serviços.
