# Dossie Tecnico de Portfolio - Sistema de Emissao de NFe

> Base desta avaliacao: leitura do codigo-fonte, workflows, stacks de infraestrutura e execucao local de `go test ./...`, `dotnet test Tests/ServicoEstoque.Tests.csproj`, `npm test` e `npm run build:prod`. O build do CDK compila, mas a sintese serverless no ambiente Windows apresentou falha de empacotamento do authorizer e warnings de APIs depreciadas.

## 1. Visao Geral do Projeto

O projeto implementa um sistema distribuido para cadastro de produtos, criacao de notas fiscais, fechamento do fluxo de faturamento, reserva de estoque e geracao assincrona de PDF em AWS. Na pratica, ele resolve um problema operacional de coordenar faturamento e estoque sem bloquear a experiencia do usuario, usando eventos e processamento assicrono para desacoplar as etapas.

O dominio real implementado hoje e de faturamento interno e controle de estoque com uma experiencia de "emissao de nota" orientada a workflow. O nome do repositorio sugere uma NFe completa, mas nao ha evidencias de integracao oficial com SEFAZ, XML fiscal, assinatura digital, certificado A1/A3 ou regras tributarias reais. Portanto, o enquadramento correto para portfolio e: sistema de gestao de notas fiscais e estoque com arquitetura event-driven, e nao um emissor fiscal homologado.

Escopo funcional identificado no codigo:

- cadastro e listagem de produtos
- criacao de notas fiscais
- adicao de itens a nota
- fechamento de nota
- reserva de estoque orientada por eventos
- solicitacao assincrona de impressao
- geracao de PDF e disponibilizacao via S3/CloudFront

## 2. Arquitetura do Sistema

A melhor classificacao para a arquitetura atual nao e "monolito modular" e tambem nao e "microservices puro". O repositorio implementa um sistema distribuido serverless com fronteiras de servico e comunicacao assincrona, mas com banco compartilhado entre dominios.

### Como a arquitetura esta organizada no codigo

- `servico-estoque` concentra a parte .NET e esta mais proxima de uma Clean Architecture simplificada, com separacao em `Api`, `Aplicacao`, `Dominio` e `Infraestrutura`.
- `servico-faturamento` concentra a maior parte da orquestracao assincrona em Go, com `cmd/` para Lambdas e `internal/` para dominio, repositorio, logger e geracao de PDF.
- `infra/cdk` define a infraestrutura AWS em stacks modulares.
- `web-app` implementa o cliente web em Angular.

### Padrões efetivamente aplicados

**Clean Architecture / camadas**

- Sim, de forma mais forte no servico de estoque.
- `Produto` e regras de negocio ficam em `Dominio/Entidades`.
- `ReservarEstoqueHandler` aplica caso de uso na camada de aplicacao.
- `RepositorioDynamoDB*` isola o acesso a persistencia.
- O acoplamento e menor no .NET do que no Go.

**DDD**

- Parcial.
- Ha linguagem de dominio explicita em entidades como `Produto`, `ReservaEstoque`, `NotaFiscal` e `SolicitacaoImpressao`.
- Existem regras de negocio encapsuladas, como debito de estoque e fechamento de nota.
- Nao ha bounded contexts rigidamente isolados, porque faturamento e estoque compartilham a mesma tabela DynamoDB principal.

**Event Driven Architecture**

- Sim, e um dos pontos mais fortes do projeto.
- O fluxo usa EventBridge como barramento e SQS como filas de entrega.
- Eventos como `Faturamento.NotaFechada`, `ReservaConfirmada`, `ReservaFalhou` e `Faturamento.ImpressaoSolicitada` aparecem no codigo e nas regras de roteamento do CDK.

**Saga coreografada**

- Sim.
- O fechamento da nota gera evento de faturamento.
- O consumidor de estoque processa o evento, tenta reservar itens e publica o resultado.
- O faturamento reage ao sucesso ou falha atualizando o status final da nota.

**Outbox Pattern**

- Sim, mas com um detalhe importante: a implementacao real e por tabela de eventos + processador agendado.
- O repositorio grava eventos na tabela `nfe-events-*`.
- A publicacao nao e por DynamoDB Streams na implementacao atual; ela e feita por um Lambda agendado que faz `Scan` em busca de eventos sem `data_publicacao`.
- Isso resolve consistencia basica, mas nao tem a eficiencia e reatividade de uma implementacao stream-driven.

### Trade-off arquitetural principal

O maior trade-off do projeto e o uso de um single-table design compartilhado por faturamento e estoque. Isso simplifica custo, deploy e throughput em DynamoDB, mas reduz a independencia entre servicos. Em entrevista, a narrativa correta e:

- o projeto tem desenho orientado a eventos e separacao de responsabilidades
- mas ainda nao atingiu independencia total de dados entre os dominios
- por isso ele fica entre "arquitetura enterprise-like" e "microservicos com banco compartilhado"

## 3. Stack Tecnologica

| Area | Tecnologia | Uso no projeto | Por que foi usada |
| --- | --- | --- | --- |
| Backend | C# / .NET 8 / ASP.NET Core Minimal API | servico de estoque em Lambda | boa produtividade para regras de dominio, endpoints simples e organizacao em camadas |
| Backend | Go 1.25 | faturamento, outbox, PDF e consumer de estoque | cold start baixo em Lambda e binarios pequenos |
| Persistencia | DynamoDB | tabela principal e tabela de eventos | aderencia forte ao ecossistema AWS serverless e baixo custo operacional |
| Modelagem | Single-table design | notas, itens, produtos, reservas | reduz numero de tabelas e resolve access patterns com PK/SK e GSIs |
| Mensageria | EventBridge + SQS + DLQ | saga, confirmacoes e reprocessamento | mensageria real em AWS sem operar broker proprio |
| Autenticacao | Cognito + Lambda Authorizer em Node.js | protecao de rotas na API Gateway | autenticao JWT gerenciada pela AWS com validacao centralizada |
| Frontend | Angular 17 + RxJS + TailwindCSS | interface web, polling e UX | entrega um front moderno com componentes standalone e fluxo reativo |
| Testes | xUnit + Moq, Go test, Jest | backend .NET, dominio Go e frontend | garante um nivel minimo de confianca nas regras principais |
| Infraestrutura | AWS CDK em TypeScript | stacks de rede, auth, banco, mensageria, compute e frontend | IaC fortemente tipada e integrada ao ecossistema AWS |
| Deploy | GitHub Actions | CI e deploy dev/prod | automatiza build, teste e publicacao |
| Observabilidade | CloudWatch Logs, alarms, Serilog, slog | logs e alarmes basicos | monitoracao inicial adequada para projeto de portfolio |
| Entrega de front | S3 + CloudFront | hospedagem do frontend e PDFs | arquitetura barata e nativa em AWS |

Tecnologias presentes apenas como legado ou suporte, nao como arquitetura ativa:

- Docker e docker-compose
- stacks antigas de RDS, RabbitMQ e ECS/Fargate
- scripts SQL e migrations para PostgreSQL

Esses artefatos ajudam a mostrar evolucao do projeto, mas hoje reduzem a consistencia documental do repositorio.

## 4. Fluxo do Sistema

### Fluxo principal de nota e estoque

1. O usuario cria uma nota fiscal pela API de faturamento.
2. A nota recebe itens, com validacao de saldo disponivel do produto no momento da composicao.
3. Ao fechar a nota, o faturamento atualiza o status e grava um evento de outbox.
4. O processador de outbox publica `Faturamento.NotaFechada` no EventBridge.
5. Uma regra do EventBridge envia esse evento para a fila de reserva de estoque.
6. O consumer de estoque processa os itens, reserva saldo no DynamoDB e publica `ReservaConfirmada` ou `ReservaFalhou`.
7. O faturamento consome a fila de confirmacao e atualiza a nota para `RESERVADA` ou `CANCELADA`.

### Fluxo de impressao assincrona

1. O usuario solicita a impressao da nota com `Idempotency-Key`.
2. O faturamento cria uma `SolicitacaoImpressao` com status `PENDENTE`.
3. O faturamento grava um evento de outbox para `Faturamento.ImpressaoSolicitada`.
4. O processador de outbox publica o evento no EventBridge.
5. O Lambda de PDF consome o evento, busca a nota, gera o arquivo e salva no S3.
6. O status da solicitacao muda para `CONCLUIDA` ou `FALHOU`.
7. O frontend faz polling ate receber a URL final do PDF.

## 5. Conceitos de Engenharia Aplicados

**SOLID**

- Sim, parcialmente.
- O servico .NET demonstra melhor Single Responsibility e separacao de dependencias.
- O Go ainda concentra muita responsabilidade em handlers Lambda grandes, especialmente em `cmd/lambda/main.go`.

**DDD**

- Parcial.
- Existe dominio explicito e regras encapsuladas.
- Falta um isolamento mais forte entre contextos e ownership de dados.

**Clean Architecture**

- Parcial.
- Clara no .NET.
- Moderada no Go, onde a camada de entrada ainda mistura roteamento HTTP, validacao e orquestracao.

**CQRS**

- Nao de forma formal.
- O projeto usa GSIs para diferentes access patterns, mas leitura e escrita compartilham o mesmo modelo e a mesma tabela.

**Event Driven**

- Sim.
- E um dos pontos mais fortes e mais relevantes para mercado.

**Outbox Pattern**

- Sim.
- Persistencia do evento e publicacao posterior estao implementadas.
- A publicacao e por polling agendado, nao por stream trigger.

**Idempotencia**

- Sim, mas aplicada de forma localizada.
- Existe `Idempotency-Key` na impressao e marcacao de mensagens processadas no fluxo assincrono.
- Nao ha uma estrategia transversal para toda escrita critica da API.

**Retry / DLQ**

- Sim, no nivel de infraestrutura.
- SQS usa DLQ e os event sources reportam `BatchItemFailures`.
- Nao ha estrategia explicita de exponential backoff ou politicas de retry de negocio no codigo da aplicacao.

**Concorrencia**

- Sim, no estoque .NET, com controle otimista por versao.
- O repositorio DynamoDB usa `ConditionExpression` para detectar conflito de atualizacao.
- O mapeamento de entidade, porem, usa `FormatterServices.GetUninitializedObject`, que e um caminho fragil e obsoleto para reidratacao.

## 6. Relevancia Para o Mercado Brasileiro

**O projeto demonstra skills demandadas?**

Sim, principalmente para vagas de backend/cloud. O repositorio mostra .NET, API REST, AWS, IaC, mensageria real, CI/CD, testes automatizados, autenticacao JWT na borda e preocupacao com custo e operacao. Isso conversa bem com vagas que pedem backend moderno, arquitetura orientada a eventos e cloud.

**Ele parece um projeto enterprise?**

Ele parece enterprise-like em desenho e em stack, mas ainda nao em consistencia total de engenharia. O uso de CDK, Cognito, EventBridge, SQS, DLQ, CloudWatch e monorepo multi-servico gera uma percepcao forte de arquitetura corporativa. Por outro lado, o banco compartilhado, a autenticacao incompleta no frontend, a presenca de artefatos legados de RDS/RabbitMQ/ECS e a ausencia de testes de integracao tiram o projeto da faixa de maturidade enterprise completa.

**Ele e relevante para vagas Junior?**

Muito. Na pratica, e mais sofisticado do que a maioria dos portfolios junior. O risco nao e falta de nivel tecnico; o risco e o candidato vender o projeto como algo mais pronto do que ele realmente esta. Se Lucas explicar claramente o que esta implementado, o que esta simulado e quais trade-offs foram assumidos, o projeto vira um diferencial real.

**Aderencia ao foco de carreira do candidato**

- Para vagas Backend .NET + AWS: alta aderencia.
- Para vagas Fullstack .NET + Angular: boa aderencia.
- Para vagas Fullstack .NET + React: aderencia parcial, porque o frontend atual e Angular.
- Para vagas .NET tradicionais com EF Core + SQL Server/PostgreSQL: aderencia parcial, porque a arquitetura ativa usa DynamoDB e a parte mais complexa da orquestracao esta em Go.

## 7. Como Explicar o Projeto em Entrevista

### Explicacao simples (30 segundos)

Construí um sistema de faturamento e estoque em AWS para criar notas fiscais, reservar estoque de forma assincrona e gerar PDF sem travar a requisicao do usuario. O projeto usa .NET no servico de estoque, Go no faturamento, AWS CDK para infraestrutura e uma arquitetura orientada a eventos com EventBridge e SQS.

### Explicacao tecnica (2 minutos)

O projeto e um sistema serverless distribuido em monorepo. O servico de estoque foi implementado em .NET com separacao entre API, aplicacao, dominio e infraestrutura. O servico de faturamento e os workers assincronos foram implementados em Go para aproveitar cold start baixo em Lambda. A persistencia ativa esta em DynamoDB, com single-table design para notas, itens, produtos e reservas, e uma tabela separada para outbox e idempotencia.

O fluxo principal usa saga coreografada. Quando uma nota e fechada, o faturamento grava um evento de outbox. Um Lambda agendado publica esse evento no EventBridge. O EventBridge roteia para SQS e um consumer de estoque reserva os itens. O resultado volta como `ReservaConfirmada` ou `ReservaFalhou`, e o faturamento atualiza o status final da nota. A impressao tambem e assincrona: a API retorna rapidamente, um worker gera o PDF e o frontend consulta o status por polling. A infraestrutura foi definida em CDK com Cognito, Lambda Authorizer, CloudFront, S3, CloudWatch e alarms, e o repositorio tem CI/CD com GitHub Actions.

## 8. Pontos Fortes do Projeto

- arquitetura cloud-native em AWS com infraestrutura definida como codigo
- uso real de EventBridge, SQS e DLQ para orquestracao assincrona
- aplicacao pratica de outbox pattern e idempotencia
- separacao de camadas consistente no servico .NET
- uso de DynamoDB com single-table design e GSIs orientados a access pattern
- CI com build e testes para backend Go, backend .NET, frontend e CDK
- autenticacao em infraestrutura com Cognito e Lambda Authorizer
- preocupacao explicita com custo, operacao e FinOps
- frontend funcional com polling de processo assincrono
- cobertura automatizada inicial suficiente para sustentar regras de dominio e servicos basicos

## 9. Pontos a Melhorar

- a documentacao do repositorio nao esta totalmente alinhada com o codigo ativo; ainda existem arquivos e scripts relevantes de PostgreSQL, RabbitMQ e ECS
- a implementacao ativa nao e um emissor fiscal oficial; falta integracao com SEFAZ, XML, certificado e regras tributarias reais
- o frontend nao concluiu a autenticacao Cognito; `AuthService`, guards e interceptor ainda estao em modo stub ou comentados
- a separacao entre servicos nao e total, porque estoque e faturamento compartilham a mesma tabela principal no DynamoDB
- a parte mais sofisticada da orquestracao assincrona esta em Go; para portfolio .NET, o protagonismo de .NET ainda pode crescer
- os testes sao majoritariamente unitarios; faltam testes de integracao, contrato e fluxo ponta a ponta da saga
- a observabilidade e inicial, mas ainda sem tracing distribuido, correlation-id, dashboards e metricas de negocio
- a reidratacao de entidades .NET em DynamoDB usa `FormatterServices`, que e obsoleto e deve ser substituido
- o outbox publisher faz `Scan` agendado na tabela de eventos; funciona para portfolio, mas nao e o modelo mais robusto para alta escala
- existem configuracoes hardcoded em workflows e environments do frontend, o que reduz portabilidade e maturidade operacional
- o frontend Angular 17 esta com 3 vulnerabilidades high em dependencias de producao segundo `npm audit --omit=dev`
- o CORS do faturamento aceita qualquer origem terminada em `.cloudfront.net`, o que merece endurecimento

## 10. Melhorias Prioritarias Para Portfolio

1. Concluir a autenticacao Cognito no frontend e reabilitar guards/interceptors.
Porque ajuda no mercado: mostra dominio completo de autenticacao JWT ponta a ponta, algo muito cobrado em vagas fullstack e backend.

2. Adicionar testes de integracao e e2e da saga com LocalStack, DynamoDB Local ou ambiente efemero.
Porque ajuda no mercado: eleva a percepcao de qualidade de engenharia e mostra maturidade em sistemas distribuidos.

3. Limpar o legado e alinhar README, scripts e stacks com a arquitetura serverless ativa.
Porque ajuda no mercado: recrutador e entrevistador tecnico avaliam muito a coerencia do repositorio, nao apenas o codigo.

4. Fortalecer observabilidade com correlation-id, dashboards, alarmes de latencia e tracing.
Porque ajuda no mercado: observabilidade e um diferencial cada vez mais presente em vagas backend e cloud.

5. Criar uma variante React/Next.js para o frontend ou migrar o cliente atual se o alvo principal for Fullstack .NET + React.
Porque ajuda no mercado: aumenta aderencia direta ao stack mais comum em vagas fullstack .NET no Brasil.

6. Dar mais protagonismo a .NET no fluxo assincrono, por exemplo com um worker/consumer .NET ou read model adicional em .NET.
Porque ajuda no mercado: reforca a narrativa do candidato como backend .NET, hoje um pouco diluida pelo peso do Go no orquestrador.

7. Atualizar dependencias do frontend e revisar hardening de seguranca.
Porque ajuda no mercado: mostra cuidado com manutencao, dependencias e postura de producao.

8. Se a estrategia for vender o dominio fiscal como diferencial, evoluir para um modulo real de NF-e.
Porque ajuda no mercado: transforma o projeto de "workflow fiscal" em um case mais aderente ao dominio enterprise/financeiro.

## 11. Como Colocar no Curriculo

Sistema distribuido para faturamento e estoque construido em AWS com .NET, Go e Angular, utilizando arquitetura orientada a eventos, EventBridge, SQS, DynamoDB, Cognito e infraestrutura como codigo com CDK para processar fechamento de notas, reserva de estoque e geracao assincrona de PDFs.

## 12. Nivel do Projeto

**Classificacao: Pleno**

Motivo:

- o projeto esta acima do nivel junior em arquitetura, infraestrutura e preocupacao operacional
- demonstra cloud, mensageria, outbox, CI/CD e boas praticas reais
- ainda nao chega a enterprise-like completo por falta de autenticacao ponta a ponta concluida, testes de integracao, consistencia documental e isolamento total entre dominios

## 13. Checklist de Mercado

| Requisito Mercado | Presente no Projeto | Observacao |
| --- | --- | --- |
| C# / .NET | Sim | servico de estoque em .NET 8 com Minimal API e Lambda hosting |
| ASP.NET Core APIs REST | Sim | APIs de produtos, reservas e health em .NET; APIs de notas em Go |
| React | Nao | frontend atual e Angular |
| Angular | Sim | Angular 17 com componentes standalone |
| EF Core | Nao | arquitetura ativa usa DynamoDB |
| SQL Server / PostgreSQL | Parcial | ha artefatos legados e scripts SQL, mas nao fazem parte da arquitetura ativa |
| NoSQL | Sim | DynamoDB e a base principal |
| AWS | Sim | CDK, Lambda, API Gateway, Cognito, EventBridge, SQS, S3, CloudFront, CloudWatch |
| Docker | Parcial | presente como suporte/legado, nao como runtime principal do ambiente ativo |
| CI/CD | Sim | GitHub Actions para build, teste e deploy |
| Microservices | Parcial | fronteiras de servico existem, mas com banco principal compartilhado |
| Event Driven | Sim | fluxo coreografado com EventBridge e SQS |
| RabbitMQ / Kafka | Nao na arquitetura ativa | existem referencias legadas a RabbitMQ no repositorio |
| SQS / EventBridge | Sim | mensageria real implementada |
| Outbox Pattern | Sim | tabela de eventos + publicador agendado |
| Idempotencia | Sim | `Idempotency-Key` e deduplicacao de mensagens |
| Retry / DLQ | Parcial | DLQ e redrive existem; retry de aplicacao ainda e basico |
| Redis | Nao | nao implementado |
| Observabilidade | Parcial | logs estruturados e alarms existem; tracing e dashboards nao |
| Testes automatizados | Sim | unitarios em Go, .NET e Angular |
| Testes de integracao / E2E | Nao | nao identificados no codigo ativo |
| JWT / Auth | Parcial | infraestrutura de auth existe, frontend ainda nao integrou o fluxo completo |
| DDD / Clean Architecture | Parcial | mais forte no .NET, parcial no Go |
| Kubernetes | Nao | nao faz parte da arquitetura atual |
| Terraform | Nao | IaC foi feita com AWS CDK |

## 14. Score Final do Projeto

**Nota final: 7.5/10**

### Justificativa da nota

O projeto tem um excelente potencial de portfolio porque demonstra algo raro em nivel junior: pensamento arquitetural, cloud AWS de verdade, mensageria, outbox, CI/CD e preocupacao de custo. Isso por si so ja o coloca acima da media.

Ele perde pontos porque ainda existe uma distancia entre a ambicao da arquitetura e a consistencia de engenharia exigida por um ambiente enterprise real. Os principais fatores sao:

- documentacao e scripts ainda misturam arquitetura ativa e legado
- autenticacao ponta a ponta nao esta concluida
- faltam testes de integracao/e2e
- o dominio fiscal ainda nao e um caso real de NF-e homologada
- o protagonismo .NET, para fins de posicionamento profissional, ainda pode ser fortalecido

Mesmo com essas limitacoes, o repositorio ja e forte o suficiente para portfolio profissional e pode funcionar muito bem em entrevistas para vagas Junior, Junior+ e ate algumas de entrada com escopo mais proximo de pleno, desde que a explicacao seja precisa e tecnicamente honesta.

---

## Atualizacao Tecnica - 2026-03-13

Esta secao complementa a avaliacao original acima. O texto anterior foi mantido para preservar o historico da auditoria; os pontos abaixo registram o que mudou no repositorio depois da rodada de correcoes.

### 1. Melhorias efetivamente implementadas

- autenticacao Cognito do frontend foi concluida com `AuthService` real via Amplify, `authGuard`, `publicGuard`, `authInterceptor` e inicializacao em `APP_INITIALIZER`
- configuracoes hardcoded do frontend foram substituidas por runtime config gerado em `src/assets/config/app-config.json`
- `correlation-id` passou a existir no frontend, no backend .NET, no backend Go e nos payloads de evento
- o CORS do faturamento deixou de aceitar qualquer origem `*.cloudfront.net` e passou a usar allowlist explicita
- a reidratacao .NET em DynamoDB deixou de usar `FormatterServices` e passou a usar `Produto.Rehydrate(...)`
- o publisher de outbox em .NET foi adicionado com `DynamoDB Streams -> EventBridge`, substituindo o modelo anterior baseado em `Scan` agendado como mecanismo principal
- a observabilidade subiu de nivel com `X-Ray tracing`, dashboard no CloudWatch e alarmes de latencia/erro
- o frontend foi atualizado de Angular 17 para Angular 19
- o `npm audit --omit=dev --audit-level=high` deixou de reportar vulnerabilidades `high` em producao
- foram adicionados testes de integracao do estoque usando DynamoDB Local oficial da AWS, validando persistencia de produto, reserva e outbox
- a documentacao principal do repositorio foi reescrita para refletir a trilha serverless ativa
- scripts operacionais ativos foram alinhados com a arquitetura atual e scripts antigos de ECS/RDS/RabbitMQ passaram a carregar aviso explicito de legado

### 2. Reavaliacao dos pontos de melhoria antigos

| Item | Status apos update | Comentario tecnico |
| --- | --- | --- |
| Documentacao desalinhada com codigo ativo | Resolvido em grande parte | `README.md`, `web-app/README.md`, `infra/cdk/README.md` e scripts operacionais ativos agora refletem a arquitetura serverless vigente |
| Nao e emissor fiscal oficial | Permanece | Continua faltando SEFAZ, XML fiscal, certificado e regras tributarias reais |
| Cognito no frontend estava stubado | Resolvido | Fluxo de login, cadastro, confirmacao, reset, guards e interceptor agora estao ativos |
| Banco compartilhado entre servicos | Permanece | Estoque e faturamento ainda compartilham a main table do DynamoDB |
| Protagonismo .NET menor no fluxo assincrono | Melhorou, mas ainda parcial | O outbox publisher .NET aumenta o peso do ecossistema .NET, mas a saga principal ainda tem bastante logica em Go |
| Falta de testes de integracao | Resolvido parcialmente | Agora ha integracao real com DynamoDB Local no estoque; ainda faltam contrato e e2e completa da saga distribuida |
| Observabilidade inicial demais | Melhorou de forma relevante | Agora ha `correlation-id`, tracing habilitado, dashboard e alarmes; ainda faltam metricas de negocio e tracing fim a fim mais rico |
| Uso de `FormatterServices` obsoleto | Resolvido | Substituido por reidratacao explicita e testada |
| Outbox publisher baseado em `Scan` | Resolvido no caminho principal | O fluxo principal passou a usar DynamoDB Streams com publisher .NET |
| Configuracoes hardcoded em workflows/frontend | Resolvido em grande parte | Frontend e workflows passaram a consumir outputs do CloudFormation e runtime config |
| Vulnerabilidades high no Angular 17 | Resolvido | O frontend foi atualizado para Angular 19 e o audit nao retorna mais severidade `high` |
| CORS permissivo para `.cloudfront.net` | Resolvido | Agora ha allowlist explicita de origens |

### 3. Evidencias tecnicas da atualizacao

Validacoes executadas depois das correcoes:

- `dotnet test servico-estoque/Tests/ServicoEstoque.Tests.csproj`
- `dotnet build servico-estoque/OutboxPublisher/OutboxPublisher.csproj`
- `go test ./...`
- `npm run test:ci`
- `npm run build:prod`
- `npm audit --omit=dev --audit-level=high`
- `npm run build` em `infra/cdk`

Leitura arquitetural apos essas evidencias:

- o servico .NET ficou mais defensavel em entrevista porque agora tem auth ponta a ponta no frontend, outbox publisher proprio e testes de integracao reais
- o repositorio ganhou mais coerencia de portfolio, porque README, scripts e workflows passaram a contar a mesma historia da stack ativa
- a confiabilidade percebida subiu, pois CORS, runtime config, correlation-id, tracing e alarmes reduziram o aspecto de "projeto conceitual" e aproximaram o repositorio de um case operacional

### 4. Checklist de mercado revisado

| Requisito Mercado | Situacao revisada | Observacao |
| --- | --- | --- |
| C# / .NET | Sim | estoque e outbox publisher em .NET 8 |
| JWT / Auth | Sim | Cognito no frontend + Lambda Authorizer na infraestrutura |
| Angular | Sim | frontend atualizado para Angular 19 |
| React | Nao | continua sendo um gap para o alvo Fullstack .NET + React |
| Event Driven | Sim | EventBridge + SQS + DLQ continuam sendo o centro da arquitetura |
| Outbox Pattern | Sim | agora com publicacao principal por DynamoDB Streams |
| Testes automatizados | Sim | unitarios e integracao no estoque, unitarios no frontend e Go |
| Testes de integracao | Sim, parcial | presente no estoque com DynamoDB Local |
| Testes e2e / contrato | Nao | ainda nao implementados |
| Observabilidade | Sim, parcial | correlation-id, tracing, dashboard e alarmes; faltam metricas de negocio |
| Hardening de seguranca | Sim, parcial | auth, CORS mais estrito e reducao de configs fixas; ainda cabe revisar CSP, rate limit e posture de producao |
| Cloud / AWS | Sim | continua sendo um dos pontos mais fortes do repositorio |

### 5. Prioridades remanescentes de maior impacto para empregabilidade

1. Adicionar testes de contrato e um e2e da saga completa.
Porque ajuda no mercado: depois de resolver integracao basica, isso fecha a narrativa de qualidade em sistema distribuido.

2. Criar uma variante React ou Next.js para a camada cliente.
Porque ajuda no mercado: melhora a aderencia direta a vagas Fullstack .NET + React no Brasil.

3. Separar melhor faturamento e estoque no modelo de dados.
Porque ajuda no mercado: reforca maturidade de microservicos e reduz a principal ressalva arquitetural atual.

4. Evoluir observabilidade para metricas de negocio e tracing fim a fim.
Porque ajuda no mercado: deixa o projeto mais proximo de um ambiente enterprise real.

5. Se o objetivo for vender dominio fiscal, implementar um modulo de NF-e real.
Porque ajuda no mercado: elimina a maior distancia entre o nome do projeto e o dominio de negocio efetivamente suportado.

### 6. Resumo atualizado para curriculo

Sistema distribuido serverless para faturamento interno, estoque e geracao assincrona de PDF, construido com .NET 8, Go, Angular 19 e AWS, utilizando EventBridge, SQS, DynamoDB, Cognito, CloudWatch e infraestrutura como codigo com CDK. O projeto aplica arquitetura orientada a eventos, outbox com DynamoDB Streams, autenticacao JWT ponta a ponta e testes de integracao com DynamoDB Local.

### 7. Reclassificacao do projeto

**Classificacao revisada: Enterprise-like**

Motivo:

- a combinacao de auth ponta a ponta, runtime config, hardening, outbox stream-driven, observabilidade via dashboard/alarmes e testes de integracao tira o projeto da zona de "bom laboratorio" e aproxima o repositorio de um case de engenharia mais maduro
- ainda ha limites reais que impedem chamar isso de sistema enterprise completo, especialmente o banco compartilhado, a falta de e2e/contrato e a ausencia de dominio fiscal homologado
- mesmo assim, para leitura de portfolio e vaga de backend/fullstack .NET, o projeto agora demonstra um repertorio mais forte e mais coerente com o que o mercado brasileiro considera diferenciado

### 8. Novo score final

**Nota revisada: 8.6/10**

Justificativa da revisao:

- a nota sobe porque foram corrigidos varios gaps que antes puxavam o projeto para baixo: autenticacao stubada, vulnerabilidades high, uso de `FormatterServices`, outbox por `Scan`, CORS permissivo, documentacao desalinhada e ausencia de integracao real no estoque
- a nota nao sobe mais porque ainda permanecem tres limitadores relevantes: o projeto nao e NF-e oficial, os dominios ainda compartilham a mesma tabela principal e a trilha React/e2e completo continua em aberto

Conclusao revisada:

Hoje o repositorio ja se sustenta muito melhor como projeto principal de portfolio para vagas Junior, Junior+ e varias vagas de entrada com exigencia tecnica de nivel pleno. Para entrevistas, a narrativa passou a ficar mais convincente porque o codigo, a infraestrutura, os testes e a documentacao contam uma historia muito mais consistente.
