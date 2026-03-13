# Web App

Frontend Angular 19 do sistema `Emissao NFe`. A aplicacao consome as APIs de faturamento e estoque, integra autenticacao Cognito com Amplify e injeta `correlation-id` em todas as chamadas HTTP.

## O que esta ativo

- Angular 19 com standalone components e `provideHttpClient`.
- Runtime config carregado em `APP_INITIALIZER`.
- Autenticacao Cognito ativa em `AuthService`, `authGuard` e `authInterceptor`.
- Interceptor de correlacao para facilitar rastreabilidade no backend.
- Build desacoplado de URLs fixas: o arquivo `src/assets/config/app-config.json` e gerado a partir de variaveis de ambiente.

## Estrutura relevante

```text
src/app/core/config/         runtime config e carregamento inicial
src/app/core/services/       AuthService, ProdutoService, NotaFiscalService
src/app/core/guards/         protecao de rotas publicas e autenticadas
src/app/core/interceptors/   auth, correlation-id, loading, tratamento de erro
src/app/features/auth/       login, cadastro, confirmacao e reset de senha
src/app/features/notas/      telas de notas
src/app/features/produtos/   telas de produtos
src/assets/config/           config de exemplo e config gerada em build
scripts/generate-runtime-config.mjs
```

## Configuracao de runtime

O frontend nao depende mais de URLs hardcoded em `environment.ts`. Antes de `start`, `test` e `build`, o script `scripts/generate-runtime-config.mjs` gera `src/assets/config/app-config.json`.

Variaveis suportadas:

- `API_ESTOQUE_URL`
- `API_FATURAMENTO_URL`
- `AUTH_ENABLED`
- `COGNITO_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_USER_POOL_CLIENT_ID`
- `ENABLE_CORRELATION_ID`
- `APP_ENVIRONMENT_NAME`

Exemplo:

```bash
set API_ESTOQUE_URL=https://api-estoque.example.com
set API_FATURAMENTO_URL=https://api-faturamento.example.com
set AUTH_ENABLED=true
set COGNITO_REGION=us-east-1
set COGNITO_USER_POOL_ID=us-east-1_example
set COGNITO_USER_POOL_CLIENT_ID=exampleclientid
npm run build:prod
```

## Desenvolvimento local

### Pre-requisitos

- Node.js 22+
- npm 10+

### Instalar e rodar

```bash
npm ci
npm start
```

Por padrao, o `app-config.example.json` aponta para:

- `http://localhost:4200/api/estoque`
- `http://localhost:4200/api/faturamento`

Isso permite usar proxy local ou uma camada de API unificada sem recompilar o app.

## Testes e build

```bash
npm run test:ci
npm run build:prod
npm audit --omit=dev --audit-level=high
```

Estado atual:

- testes unitarios ativos para `NotaFiscalService` e guards de autenticacao;
- build de producao validado em Angular 19;
- auditoria de dependencias sem vulnerabilidades `high` em producao.

## Autenticacao

O fluxo de autenticacao usa Amplify v6:

1. `RuntimeConfigService` carrega `userPoolId`, `clientId` e `region`.
2. `AuthService.initialize()` configura o Amplify e tenta reidratar a sessao.
3. `authGuard` bloqueia rotas privadas.
4. `authInterceptor` injeta o JWT nas chamadas autenticadas.
5. `correlationIdInterceptor` adiciona `X-Correlation-Id`.

Se `AUTH_ENABLED=false`, o frontend entra em modo sem Cognito e as rotas protegidas nao sao consideradas autenticadas.

## Deploy

O deploy principal acontece pelos workflows do GitHub. Eles leem os outputs do CloudFormation, exportam variaveis como `API_ESTOQUE_URL`, `API_FATURAMENTO_URL`, `COGNITO_USER_POOL_ID` e `COGNITO_USER_POOL_CLIENT_ID`, geram o `app-config.json` e publicam o bundle no S3/CloudFront.

Para publicacao manual, basta gerar o build com as variaveis corretas e sincronizar `dist/web-app/browser` no bucket configurado.

## Limites atuais

- O app e Angular, nao React/Next.js. Se o alvo principal for Fullstack .NET + React, ainda faz sentido manter uma variante React no portfolio.
- A experiencia cobre login, cadastro, confirmacao e reset, mas nao ha um fluxo de SSO corporativo ou MFA customizado.
- Nao existem dashboards de produto ou telemetria visual no frontend; a observabilidade esta mais forte no backend/infra.
