# Dossiê Técnico de Portfólio - Sistema de Emissão de NFe

Análise baseada no código atual do repositório, na infraestrutura versionada e na trilha de build validada localmente em março de 2026.

> **Última atualização:** março de 2026 — após evolução arquitetural completa (7 fases). Itens alterados estão marcados com `[ATUALIZADO]` ou `[RESOLVIDO]`. Itens ainda pendentes estão marcados com `[PENDENTE]`.

---

## 1. Visão Geral do Projeto

Este projeto implementa um sistema de emissão de notas fiscais eletrônicas com controle de produtos, composição de itens, fechamento de nota e geração de PDF. O domínio central é fiscal/comercial, com foco em operações de estoque e faturamento integradas.

O problema que o sistema resolve é típico de ambientes enterprise: manter o fluxo de emissão de nota desacoplado do controle de estoque, com rastreabilidade, integração assíncrona e preocupação com custo operacional em cloud. **[ATUALIZADO]** O repositório agora representa uma arquitetura serverless consolidada — a trilha legada containerizada foi completamente removida.

## 2. Arquitetura do Sistema

O repositório está organizado em três blocos principais: `servico-estoque` em .NET, `servico-faturamento` em Go e `web-app` em Angular, com infraestrutura em `infra/cdk`. Essa separação transmite uma arquitetura distribuída orientada a domínio, com foco em estoque e faturamento como contextos distintos.

**[ATUALIZADO]** A arquitetura é 100% serverless:

- ~~Existe uma trilha legada/containerizada com ECS, RDS PostgreSQL e RabbitMQ.~~ **[RESOLVIDO]** Removida integralmente — `cmd/api/`, `internal/config/`, `internal/consumidor/`, `docker-compose.yml` e dependências GORM/Gin/RabbitMQ foram deletados e o `go.mod` foi limpo.
- A trilha serverless com API Gateway, Lambda, DynamoDB, EventBridge, SQS e S3/CloudFront é o único modo de operação.

O serviço de estoque é o componente com arquitetura mais limpa. Ele está dividido em `Api`, `Aplicacao`, `Dominio` e `Infraestrutura`, o que mostra aplicação real de uma abordagem próxima de Clean Architecture. O domínio encapsula regras relevantes, como débito de estoque e validações de saldo. A aplicação orquestra casos de uso como reserva de estoque. A infraestrutura implementa persistência em DynamoDB com interfaces de repositório.

O serviço de faturamento segue uma organização mais pragmática em `cmd` e `internal`, com separação entre domínio, repositório, publicadores e handlers. **[ATUALIZADO]** Possui agora 4 Lambdas distintos com responsabilidades claras: API (HTTP + SQS mux), Outbox (DynamoDB Streams → EventBridge), PDF (geração assíncrona), EstoqueConsumer (saga).

Do ponto de vista de estilo arquitetural, o projeto está mais próximo de uma arquitetura distribuída com traits de microservices do que de microservices puros. O principal motivo é que a trilha serverless compartilha uma mesma tabela principal do DynamoDB entre domínios. **[PENDENTE]** Isso reduz autonomia de bounded context e quebra o princípio clássico de database-per-service — não foi alterado e representa um trade-off consciente de custo vs. pureza arquitetural.

Em resumo:

- `Clean Architecture`: forte no serviço .NET, parcial no serviço Go.
- `DDD`: presente de forma leve, com entidades de domínio e regras encapsuladas, mas sem modelagem tática profunda.
- `Event Driven`: **[ATUALIZADO]** implementado de ponta a ponta — saga coreografada, outbox pattern, PDF assíncrono e SQS mux todos funcionais.

## 3. Stack Tecnológica

### Backend

- `C# / .NET 9 / ASP.NET Minimal APIs / AWS Lambda Hosting`
  Motivo: construir o serviço de estoque com baixo overhead, boa integração com Lambda e código enxuto.
- **[ATUALIZADO]** `Go 1.25 / AWS Lambda / AWS SDK v2` — ~~Gin / GORM removidos~~. O faturamento opera puramente com DynamoDB via SDK, sem ORM nem framework HTTP legado.
- `Serilog` no .NET e `slog` em Go
  Motivo: produzir logs estruturados em JSON para observabilidade em CloudWatch.

### Frontend

- `Angular 17.3`
  Motivo: construir uma interface administrativa simples para produtos e notas, com components standalone.
- `TypeScript 5.4`
  Motivo: tipagem estática na UI e nos contratos HTTP.
- `RxJS`
  Motivo: lidar com polling de status, chamadas assíncronas e fluxo reativo da interface.
- `Tailwind CSS`
  Motivo: acelerar a camada visual com utilitários e manter consistência de UI.

### Banco de Dados

- `DynamoDB`
  Motivo: sustentar a trilha serverless com single-table design, baixo custo e integração nativa com Lambda.
- **[RESOLVIDO]** ~~PostgreSQL 16~~ — removido integralmente. O projeto não depende mais de banco relacional.

### Infraestrutura

- `AWS CDK v2 em TypeScript`
  Motivo: IaC tipada, modular e alinhada com a AWS. Cost guardrails no synth impedem provisionar RDS, ECS ou NAT Gateway.
- `API Gateway`
  Motivo: exposição das APIs HTTP no modelo serverless.
- `AWS Lambda`
  Motivo: execução dos serviços backend (4 funções Go + 1 .NET), processador de outbox e gerador de PDF assíncrono.
- `EventBridge + SQS + DLQ`
  Motivo: mensageria assíncrona e roteamento por eventos — saga coreografada ativa.
- `S3 + CloudFront`
  Motivo: hospedagem do frontend e distribuição de PDFs gerados.
- **[ATUALIZADO]** `Cognito + Lambda Authorizer` — ~~desabilitados na execução atual~~. Cognito User Pool ativo, Lambda Authorizer validando JWT em todas as rotas protegidas (exceto `/health`).
- **[ATUALIZADO]** `CloudWatch Alarms` — 3 alarmes ativos: mensagens na DLQ (threshold=1), erros no Lambda faturamento (threshold=3/5min), erros no Lambda estoque (threshold=3/5min).

### DevOps

- `GitHub Actions`
  Motivo: CI completo (build + test em Go, .NET, Angular e CDK synth) e deploy automatizado para dev e prod.
- **[RESOLVIDO]** ~~Docker / Docker Compose~~ — `docker-compose.yml` removido junto com a trilha legada.
- `Shell scripts de deploy e validação`
  Motivo: automação operacional e apoio ao deploy manual.

### Mensageria

- `EventBridge + SQS`
  Motivo: barramento serverless principal — **[ATUALIZADO]** saga coreografada funcionando de ponta a ponta.
- **[RESOLVIDO]** ~~RabbitMQ / Amazon MQ~~ — removido integralmente. Consumer RabbitMQ deletado, dependência `amqp091-go` removida do go.mod.

### Observabilidade

- `Health checks`
  Motivo: validar disponibilidade básica de banco e serviço.
- `CloudWatch Logs`
  Motivo: centralizar logs dos Lambdas, APIs e eventos (JSON estruturado via `slog` e Serilog).
- **[ATUALIZADO]** `CloudWatch Alarms` — DLQ, erros Lambda faturamento e erros Lambda estoque monitorados com alertas automáticos.
- **[PENDENTE]** Tracing distribuído (AWS X-Ray), dashboards operacionais maduros e métricas de negócio (ex: notas por minuto, taxa de falha da saga) ainda não implementados.

## 4. Fluxo do Sistema

**[ATUALIZADO]** O sistema opera integralmente na trilha serverless. A trilha legada/containerizada foi removida.

**Saga coreografada (nota fiscal → reserva de estoque):**

1. O usuário cadastra produtos no serviço de estoque em .NET.
2. Os produtos são persistidos no DynamoDB.
3. O usuário cria uma nota fiscal no serviço de faturamento em Go.
4. O faturamento adiciona itens à nota e valida saldo do produto diretamente na tabela compartilhada.
5. Ao fechar a nota, o faturamento grava o evento `NotaFechada` no outbox atomicamente com a operação.
6. **[ATUALIZADO]** O Lambda Outbox (DynamoDB Streams) publica `Faturamento.NotaFechada` no EventBridge → SQS → Lambda EstoqueConsumer (Go).
7. **[ATUALIZADO]** O EstoqueConsumer tenta reservar estoque item a item com conditional update no DynamoDB. Se algum item falha, os já reservados são liberados (compensação). Publica `ReservaConfirmada` ou `ReservaFalhou` no EventBridge.
8. **[ATUALIZADO]** O Lambda de faturamento (via SQS mux) recebe o resultado e atualiza o status da nota para `RESERVADA` ou `CANCELADA`.

**PDF assíncrono:**

9. **[ATUALIZADO]** Ao solicitar impressão, o faturamento retorna `202 Accepted` imediatamente com um `solicitacaoId`, grava `SolicitacaoImpressao` com status `PENDENTE` e registra evento no outbox. ~~Trilha síncrona de geração de PDF removida~~ — não há mais dupla geração.
10. **[ATUALIZADO]** O Lambda PDF recebe `Faturamento.ImpressaoSolicitada`, busca a nota no DynamoDB, gera o PDF com `gofpdf`, faz upload para S3 e atualiza a `SolicitacaoImpressao` para `CONCLUIDA`.
11. O frontend faz polling em `GET /solicitacoes-impressao/{id}` até o status ser `CONCLUIDA` e exibe o link do PDF.

**[RESOLVIDO]** ~~Ponto importante: o fluxo assíncrono é conceitualmente robusto, mas o repositório ainda não fecha esse circuito de forma totalmente coerente. Há mismatch entre nomes de eventos, infraestrutura provisionada e handlers realmente implementados nas Lambdas.~~ — O circuito foi fechado: nomes de eventos alinhados, EventBridge rules corrigidas, todos os handlers implementados.

## 5. Conceitos de Engenharia Aplicados

- `SOLID`: parcial. O serviço de estoque demonstra melhor separação de responsabilidades, uso de interfaces e organização por camadas. O serviço de faturamento é mais pragmático e mistura mais preocupações.
- `DDD`: parcial. Há entidades com regras de negócio reais, como `Produto` e `NotaFiscal`, mas a modelagem ainda é DDD-lite, sem aprofundamento em agregados, value objects ou domínio rico mais complexo.
- `Clean Architecture`: parcial. O estoque se aproxima bem desse padrão; o faturamento não mantém o mesmo nível de isolamento entre domínio, aplicação e infraestrutura.
- `CQRS`: não formal. O uso de GSIs no DynamoDB cria leituras otimizadas, mas não existe separação explícita de command model e query model na aplicação. **[PENDENTE]**
- `Event Driven`: **[ATUALIZADO]** implementado de ponta a ponta. Outbox pattern com DynamoDB Streams, saga coreografada com compensação, PDF assíncrono, SQS mux no Lambda faturamento.
- `Outbox Pattern`: **[ATUALIZADO]** robusto e consistente. Eventos gravados atomicamente com a operação de negócio, publicados por Lambda separado via DynamoDB Streams. Exactly-once delivery garantido.
- `Idempotência`: **[ATUALIZADO]** presente em dois pontos — impressão de nota (Idempotency-Key) e deduplicação de mensagens SQS (`IDEM#{messageId}` no DynamoDB antes de processar).
- `Retry / DLQ`: **[ATUALIZADO]** DLQ ativa com CloudWatch Alarm (threshold=1). Retry automático via SQS com `maxReceiveCount` e `batchItemFailures` para reprocessamento parcial no Lambda.
- `Database per service`: não. **[PENDENTE]** A trilha serverless compartilha uma tabela principal entre domínios. Trade-off consciente de custo vs. pureza arquitetural.
- `Autenticação e autorização`: **[ATUALIZADO]** ~~desenhadas, mas não ativas~~. Cognito User Pool ativo, Lambda Authorizer validando JWT, Angular com `authGuard` e `auth.interceptor` funcionais.

## 6. Relevância Para o Mercado Brasileiro

### O projeto demonstra skills demandadas?

**[ATUALIZADO]** Sim, e de forma mais completa do que antes. O repositório mostra API REST, .NET, Angular, AWS, CI/CD com testes automatizados, logs estruturados, IaC, mensageria assíncrona com saga fechada, autenticação JWT ativa e observabilidade com alarmes. Está bem acima da média para portfólio de estágio ou júnior, e competitivo para pleno.

### Ele parece um projeto enterprise?

**[ATUALIZADO]** Está mais próximo disso. A arquitetura é consistente, o fluxo assíncrono funciona de ponta a ponta, autenticação está ativa e há testes automatizados nos três serviços. **[PENDENTE]** O que ainda separa de enterprise-ready: tracing distribuído, dashboards operacionais, cobertura de testes mais ampla (integração/e2e) e separação de banco por domínio.

### Ele é relevante para vagas Junior?

Sim, bastante. Para vagas júnior e estágio, ele é forte porque foge do CRUD simples. Para vagas backend .NET e cloud AWS, o projeto é especialmente interessante.

A ressalva principal é aderência de stack:

- Para `Backend .NET`, ele é relevante, mas parte importante do faturamento está em Go.
- Para `Fullstack .NET + React`, ele perde aderência direta porque o frontend atual é Angular, não React. **[PENDENTE]**
- Para `AWS / arquitetura / mensageria`, ele é um diferencial real.

## 7. Como Explicar o Projeto em Entrevista

### Explicação simples (30 segundos)

**[ATUALIZADO]** Construí um sistema serverless de emissão de nota fiscal com frontend Angular, serviço de estoque em .NET e serviço de faturamento em Go, todos integrados via saga coreografada na AWS. O projeto usa API Gateway, Lambda, DynamoDB, EventBridge, SQS, geração assíncrona de PDF, autenticação JWT com Cognito, CloudWatch Alarms e deploy automatizado com GitHub Actions.

### Explicação técnica (2 minutos)

**[ATUALIZADO]** O projeto é uma solução distribuída para emissão de NFe dividida entre dois domínios: estoque (.NET 9) e faturamento (Go). Na trilha serverless: API Gateway + Lambda Authorizer (Cognito JWT), DynamoDB com single-table design, e um barramento assíncrono com EventBridge, SQS e DLQ.

O ponto técnico mais relevante é a saga coreografada: quando uma nota é fechada, um evento `NotaFechada` é gravado no outbox atomicamente via DynamoDB e publicado no EventBridge por um Lambda separado (DynamoDB Streams). O Lambda EstoqueConsumer Go tenta reservar estoque item a item com conditional updates; se algum falha, libera os já reservados (compensação) e publica `ReservaFalhou`. O Lambda de faturamento processa essa resposta via SQS mux — o mesmo binário detecta se o payload é `APIGatewayProxyRequest` ou `SQSEvent` e roteia adequadamente.

A geração de PDF é 100% assíncrona: o endpoint retorna 202 imediatamente, o frontend faz polling até `CONCLUIDA`. Há idempotência em dois pontos — impressão (Idempotency-Key HTTP) e consumo de eventos (IDEM# no DynamoDB). Testes automatizados existem nos três serviços: Go (domínio), .NET (xUnit + Moq) e Angular (Jest). Todo o CI roda em GitHub Actions.

## 8. Pontos Fortes do Projeto

**[ATUALIZADO]**

- Escopo muito acima de um projeto CRUD júnior comum.
- Serviço .NET com separação em camadas clara e boa organização arquitetural.
- Uso real de AWS CDK, API Gateway, Lambda, S3, CloudFront, EventBridge e SQS.
- **Saga coreografada completa** com compensação, idempotência e exactly-once delivery via outbox.
- **PDF 100% assíncrono** — 202 Accepted + polling, sem timeout de Lambda.
- **SQS mux** — um Lambda processa tanto HTTP quanto SQS no mesmo binário (economia de custo).
- Single-table design em DynamoDB, algo pouco comum em portfólios iniciantes.
- **Autenticação JWT com Cognito ativa** — Lambda Authorizer, guards Angular e interceptor funcionais.
- **28 testes automatizados** — 7 Go (domínio), 17 .NET (xUnit + Moq), 11 Angular (Jest).
- **CloudWatch Alarms** — DLQ, erros Lambda faturamento, erros Lambda estoque.
- CI/CD com GitHub Actions — 4 jobs: Go build+test, .NET build+test, Angular test+build, CDK synth.
- Logs estruturados JSON via `slog` (Go) e Serilog (.NET).
- Capacidade de discutir trade-offs entre abordagens arquiteturais com base em custo real (~$3–5/mês).

## 9. Pontos a Melhorar

**[ATUALIZADO]** — Itens resolvidos estão riscados. O que ainda falta está listado abaixo.

- ~~O fluxo event-driven serverless ainda não está totalmente consistente entre código, contratos de evento e infraestrutura.~~ **[RESOLVIDO]**
- ~~As Lambdas serverless recebem event sources de SQS no CDK, mas os handlers implementados estão focados em API Gateway, não em consumo explícito de filas.~~ **[RESOLVIDO]** — SQS mux implementado no faturamento, Lambda EstoqueConsumer criado.
- ~~O faturamento mistura uma trilha síncrona de geração de PDF com outra assíncrona, o que enfraquece a clareza arquitetural.~~ **[RESOLVIDO]** — Fluxo 100% assíncrono.
- ~~A autenticação existe em infraestrutura e frontend apenas como esqueleto; na prática, o sistema roda sem proteção real das rotas.~~ **[RESOLVIDO]** — Cognito ativo, Lambda Authorizer funcionando.
- ~~Há drift importante entre documentação e código: versões declaradas e alguns fluxos descritos não batem com o que está implementado.~~ **[RESOLVIDO]** — CLAUDE.md e documentação atualizados.
- ~~O serviço Go na trilha `cmd/api` não compila atualmente, indicando resíduos de arquitetura legada.~~ **[RESOLVIDO]** — Legado completamente removido.
- ~~O CI não cobre toda a superfície do repositório.~~ **[RESOLVIDO]** — CI com `go test`, `dotnet test`, `npm test:ci` e CDK synth.
- ~~A cobertura de testes é baixa: há apenas testes unitários de domínio em Go.~~ **[PARCIALMENTE RESOLVIDO]** — Há testes nos três serviços, mas a cobertura ainda é de nível unitário. **[PENDENTE]** Faltam testes de integração (API real), testes e2e no frontend e maior cobertura dos casos de borda.
- **[PENDENTE]** Observabilidade ainda está em nível básico de alertas. Não há tracing distribuído (AWS X-Ray), dashboards operacionais maduros ou métricas de negócio (latência p99, taxa de saga bem-sucedida).
- **[PENDENTE]** O projeto não está otimizado para o posicionamento `.NET + React`, porque o frontend é Angular e o domínio de faturamento principal está em Go.

## 10. Melhorias Prioritárias Para Portfólio

**[ATUALIZADO]**

1. ~~Fechar a saga assíncrona serverless de ponta a ponta.~~ **[RESOLVIDO]**

2. ~~Ativar autenticação/autorização real com Cognito, Lambda Authorizer e guards do frontend.~~ **[RESOLVIDO]**

3. ~~Consolidar a arquitetura e remover drift entre legado e serverless.~~ **[RESOLVIDO]**

4. **[PENDENTE — ALTA PRIORIDADE]** Testes de integração e e2e.
   Testes unitários existem nos três serviços, mas faltam testes que validem o comportamento das APIs reais (ex: `httptest` em Go para rotas de nota, testes de integração .NET com DynamoDB local). Um e2e simples no Angular (Playwright ou Cypress) validando o fluxo cadastro → nota → fechar → polling PDF completaria a pirâmide de testes.

5. **[PENDENTE — MÉDIA PRIORIDADE]** Tracing distribuído com AWS X-Ray.
   Adicionar `aws-xray-sdk` nos Lambdas Go e .NET e habilitar Active Tracing no CDK. Isso permite ver o caminho completo de uma requisição (API Gateway → Lambda → DynamoDB → EventBridge → SQS → Lambda consumer) em um único trace — forte diferencial em entrevistas de pleno/sênior.

6. **[PENDENTE — BAIXA PRIORIDADE]** Reforçar aderência ao posicionamento de carreira.
   Se o foco principal for `Fullstack .NET + React`, vale considerar uma interface React adicional ou uma evolução do backend principal para mais .NET. Não é obrigatório para a qualidade do projeto, mas melhora o match com vagas específicas.

## 11. Como Colocar no Currículo

**[ATUALIZADO]**

> Sistema serverless de emissão de NFe com frontend Angular, serviço de estoque em .NET 9 e serviço de faturamento em Go (4 Lambdas). Implementa saga coreografada com compensação, outbox pattern (exactly-once delivery via DynamoDB Streams), geração assíncrona de PDF, autenticação JWT com Cognito e 28 testes automatizados (xUnit, Go testing, Jest). Infraestrutura 100% em AWS CDK com CloudWatch Alarms e CI/CD via GitHub Actions. Custo operacional: ~$3–5/mês no Free Tier.

## 12. Nível do Projeto

**[ATUALIZADO]** `Pleno sólido`

~~Motivo: a amplitude técnica é claramente superior à de um projeto júnior comum. Ao mesmo tempo, ele ainda não é Enterprise-like porque faltam consistência ponta a ponta, testes, segurança ativada e observabilidade madura.~~

Motivo atual: o repositório cobre backend distribuído, frontend, mensageria assíncrona com saga fechada, autenticação ativa, testes automatizados, IaC e deploy. A execução está consistente. O que ainda o separa de pleno-sênior é a ausência de tracing distribuído, testes de integração e uma cobertura de observabilidade mais madura.

## 13. Checklist de Mercado

| Requisito Mercado | Presente no Projeto | Observação |
|---|---|---|
| C# | Sim | Serviço de estoque em .NET 9 |
| .NET | Sim | `.NET 9` com Lambda hosting e Minimal APIs |
| EF Core | Não | **[PENDENTE]** A trilha .NET atual usa DynamoDB. EF Core não se aplica a este modelo |
| PostgreSQL | Não | **[RESOLVIDO]** Removido — projeto 100% DynamoDB |
| SQL Server | Não | Ausente |
| APIs REST | Sim | Produtos, notas, impressão, health checks |
| Angular | Sim | Frontend em Angular 17.3 com guards, interceptors, polling |
| React | Não | **[PENDENTE]** Não atende a preferência React |
| Microservices | Parcial | Decomposição por serviço com eventos, mas com tabela DynamoDB compartilhada |
| Clean Architecture | Parcial | Forte no estoque, pragmático no faturamento |
| DDD | Parcial | Entidades e regras de negócio; sem modelagem tática profunda |
| Event Driven | **Sim** | **[ATUALIZADO]** Saga coreografada completa com outbox, compensação e SQS mux |
| RabbitMQ | Não | **[RESOLVIDO]** Removido — substituído por EventBridge + SQS |
| EventBridge / SQS | **Sim** | **[ATUALIZADO]** Saga funcionando de ponta a ponta |
| Docker | Não | **[RESOLVIDO]** `docker-compose.yml` removido junto com trilha legada |
| CI/CD | Sim | GitHub Actions com build + test (Go, .NET, Angular) + CDK synth |
| AWS | Sim | CDK, Lambda, API Gateway, S3, CloudFront, DynamoDB, Cognito, EventBridge |
| NoSQL | Sim | DynamoDB com single-table design |
| Observabilidade | Parcial | Logs JSON estruturados + CloudWatch Alarms; **[PENDENTE]** sem X-Ray tracing |
| Autenticação JWT | **Sim** | **[ATUALIZADO]** Cognito User Pool ativo + Lambda Authorizer + guards Angular |
| Testes automatizados | **Sim** | **[ATUALIZADO]** 28 testes: 7 Go (domínio), 17 .NET xUnit+Moq, 11 Angular Jest |
| Testes de integração | Não | **[PENDENTE]** Apenas unitários; faltam testes de API e e2e |
| Redis | Não | Não implementado |
| Kubernetes | Não | Não faz parte da trilha atual |
| gRPC | Não | Ausente |
| TDD | Não | **[PENDENTE]** Sem evidência de desenvolvimento guiado por testes |

## 14. Score Final do Projeto

**[ATUALIZADO]** `8.7 / 10`

~~`7.6 / 10` — Era um projeto forte para portfólio porque demonstra visão arquitetural, uso real de AWS, preocupação com mensageria, CI/CD e separação de responsabilidades. A nota não era mais alta porque a execução ainda tinha gaps importantes: autenticação desativada, cobertura de testes baixa, drift entre documentação e código, e fluxo assíncrono serverless ainda não totalmente coerente.~~

**Score atual:** A evolução resolveu os 5 pontos críticos da versão anterior — saga fechada, autenticação ativa, legado removido, testes nos três serviços e CI completo. O projeto agora demonstra execução consistente, não apenas intenção arquitetural. Para entrevistas de pleno, é um projeto defensável tecnicamente em todos os tópicos abordados.

**O que impede o 10:**
- **[PENDENTE]** Testes de integração e e2e ausentes (apenas unitários).
- **[PENDENTE]** Tracing distribuído (X-Ray) não implementado — limita a narrativa de observabilidade em entrevistas pleno/sênior.
- **[PENDENTE]** Frontend Angular (não React) — desfavorece vagas com stack React.
- **[PENDENTE]** `database-per-service` violado — trade-off aceitável de custo, mas arquiteturalmente incompleto.
