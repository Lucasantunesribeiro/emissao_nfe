# Emissao NFe

Sistema distribuido com arquitetura serverless e fluxo orientado a eventos para cadastro de produtos, fechamento de notas e geracao assincrona de PDF. O projeto foi desenhado como portfolio tecnico com foco em AWS, integracao assincrona, Clean Architecture aplicada no servico .NET e operacao via GitHub Actions.

Importante: a implementacao atual nao e um emissor fiscal oficial. O repositorio nao integra com SEFAZ, nao gera XML fiscal oficial, nao usa certificado A1/A3 e nao aplica regras tributarias reais. Hoje ele representa um workflow de faturamento inspirado no dominio fiscal, util para demonstrar engenharia e arquitetura.

## Visao geral

- `servico-faturamento` em Go concentra a API de notas, o fluxo de confirmacao da saga, a geracao de PDF e parte da orquestracao assincrona.
- `servico-estoque` em .NET 8 expõe a API de produtos e a reserva de estoque com persistencia em DynamoDB, outbox e testes automatizados.
- `servico-estoque/OutboxPublisher` adiciona um worker .NET para publicar eventos do outbox via DynamoDB Streams para EventBridge.
- `web-app` em Angular 19 consome as APIs, faz autenticacao com Cognito via Amplify e injeta `correlation-id` nas chamadas.
- `infra/cdk` provisiona API Gateway, Lambda, DynamoDB, EventBridge, SQS, Cognito, S3, CloudFront, alarmes e dashboard.

## Arquitetura ativa

```text
Angular 19 + Cognito
        |
        v
API Gateway + Lambda Authorizer
        |
        +--> Lambda Faturamento (Go)
        |       |
        |       +--> DynamoDB main table
        |       +--> EventBridge / SQS / DLQ
        |       +--> S3 (PDF)
        |
        +--> Lambda Estoque (.NET 8)
                |
                +--> DynamoDB main table
                +--> Events table (outbox)
                +--> DynamoDB Streams -> Outbox Publisher (.NET 8) -> EventBridge
```

Pontos relevantes da implementacao ativa:

- Event driven com `EventBridge + SQS + DLQ`.
- Persistencia principal em `DynamoDB` com single-table design para o dominio operacional.
- `Outbox pattern` no estoque com publicacao por `DynamoDB Streams`, substituindo o modelo antigo de `Scan` agendado.
- `correlation-id` propagado entre frontend, APIs e eventos.
- `X-Ray tracing`, dashboard e alarmes de latencia/erro provisionados via CDK.
- `CORS` restrito a origens explicitas em vez de wildcard por sufixo.

## Fluxos principais

### Cadastro e reserva de estoque

1. O frontend autentica no Cognito e envia JWT para as rotas protegidas.
2. A API .NET recebe a requisicao, valida o agregado `Produto` e debita o saldo.
3. A reserva e persistida na main table do DynamoDB.
4. Um evento de outbox e salvo na events table com `correlation_id`.
5. O outbox publisher .NET consome o stream e publica no EventBridge.

### Fechamento de nota

1. A API Go fecha a nota fiscal interna.
2. O faturamento publica o evento de fechamento.
3. O consumer de estoque processa a reserva.
4. O faturamento recebe confirmacao ou rejeicao e atualiza o status da nota.

### Impressao assincrona

1. O cliente solicita a impressao.
2. O faturamento grava uma solicitacao pendente.
3. O evento dispara a Lambda de PDF.
4. O PDF e gerado e armazenado no S3.
5. O frontend consulta o status ate receber o link final.

## Stack utilizada

### Backend

- Go 1.25 para faturamento, PDF e parte da orquestracao assincrona.
- .NET 8 para estoque e outbox publisher.
- xUnit + Moq para testes do servico .NET.

### Frontend

- Angular 19 com standalone components.
- AWS Amplify Auth para Cognito.
- Jest para testes unitarios.

### Infraestrutura

- AWS CDK em TypeScript.
- API Gateway, Lambda, DynamoDB, EventBridge, SQS, S3, CloudFront, Cognito.
- CloudWatch Alarms e Dashboard.

## Limites e trade-offs atuais

- O dominio simula faturamento/NFe, mas nao cobre emissao fiscal oficial.
- Estoque e faturamento ainda compartilham a mesma tabela principal no DynamoDB.
- A orquestracao assincrona mais rica continua concentrada em Go, embora a trilha .NET tenha crescido com o outbox publisher.
- Observabilidade melhorou com `correlation-id`, alarmes e X-Ray, mas ainda nao ha metricas de negocio ou tracing distribuido completo fim a fim.
- Ainda existem arquivos legados de uma arquitetura antiga com ECS/RDS/RabbitMQ. Eles foram mantidos apenas como historico e nao representam o caminho operacional atual.

## Executando localmente

### Pre-requisitos

- Go 1.25+
- .NET SDK 9.0+ para compilar app + testes
- Node.js 22+
- Java 17+ para os testes de integracao com DynamoDB Local
- AWS CLI v2

### Backend Go

```bash
cd servico-faturamento
go test ./...
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build/bootstrap ./cmd/lambda/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-pdf/bootstrap ./cmd/lambda-pdf/main.go
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -tags lambda.norpc -o build-estoque-consumer/bootstrap ./cmd/lambda-estoque-consumer/main.go
```

### Backend .NET

```bash
cd servico-estoque
dotnet test Tests/ServicoEstoque.Tests.csproj
dotnet publish ServicoEstoque.csproj -c Release -r linux-x64 --self-contained false -o publish-dynamodb
dotnet publish OutboxPublisher/OutboxPublisher.csproj -c Release -r linux-x64 --self-contained false -o OutboxPublisher/publish
```

Os testes de integracao do estoque baixam automaticamente o DynamoDB Local oficial da AWS e executam o fluxo contra tabelas efemeras.

### Frontend Angular

```bash
cd web-app
npm ci
npm run test:ci
npm run build:prod
npm start
```

O frontend usa `src/assets/config/app-config.json`, gerado a partir de `app-config.example.json` e de variaveis de ambiente em tempo de build.

### Infraestrutura

```bash
cd infra/cdk
npm ci
npm run build
npm run synth:serverless -- --context env=dev
```

## Deploy

Os workflows em `.github/workflows` sao o caminho principal de deploy. Eles:

- compilam as Lambdas Go ativas;
- publicam a API .NET e o outbox publisher .NET;
- fazem deploy do CDK serverless;
- resolvem outputs do CloudFormation para montar o runtime config do frontend;
- sincronizam o build Angular no bucket S3 e invalidam o CloudFront.

Para execucao manual local, use `infra/scripts/deploy-serverless.sh`.

## Qualidade e validacao

Validacoes usadas no repositorio hoje:

- `go test ./...` em `servico-faturamento`
- `dotnet test Tests/ServicoEstoque.Tests.csproj` em `servico-estoque`
- `npm run test:ci` e `npm run build:prod` em `web-app`
- `npm audit --omit=dev --audit-level=high` em `web-app`
- `npm run build` em `infra/cdk`

No momento:

- o frontend nao possui vulnerabilidades `high` em dependencias de producao;
- o estoque possui testes unitarios e de integracao com DynamoDB Local;
- a validacao operacional da stack ativa foi consolidada em `scripts/validation-commands.sh`.

## Estrutura do repositorio

```text
servico-faturamento/      API de faturamento, PDF e consumers em Go
servico-estoque/          API de estoque em .NET 8
web-app/                  Frontend Angular 19
infra/cdk/                Infraestrutura serverless em AWS CDK
infra/scripts/            Scripts operacionais alinhados ao stack serverless
scripts/                  Scripts utilitarios e validacoes
```

## Legado

Alguns arquivos antigos de uma fase pre-serverless foram mantidos para referencia historica. Eles nao sao a fonte de verdade para deploy ou operacao atual. Sempre priorize:

- `.github/workflows/*.yml`
- `infra/cdk/bin/nfe-infra-serverless.ts`
- `infra/scripts/deploy-serverless.sh`
- `scripts/validation-commands.sh`

## Autor

Lucas Antunes Ferreira

- GitHub: [Lucasantunesribeiro](https://github.com/Lucasantunesribeiro/emissao_nfe)
- LinkedIn: [linkedin.com/in/lucas-antunes-ribeiro](https://www.linkedin.com/in/lucas-antunes-ribeiro)
