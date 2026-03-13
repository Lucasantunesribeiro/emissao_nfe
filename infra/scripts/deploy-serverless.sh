#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CDK_DIR="$PROJECT_ROOT/infra/cdk"
AUTHORIZER_DIR="$PROJECT_ROOT/infra/lambda-authorizer"
FATURAMENTO_DIR="$PROJECT_ROOT/servico-faturamento"
ESTOQUE_DIR="$PROJECT_ROOT/servico-estoque"

COMPUTE_STACK_NAME="nfe-compute-serverless-${ENVIRONMENT}"
FRONTEND_STACK_NAME="nfe-frontend-serverless-${ENVIRONMENT}"
AUTH_STACK_NAME="nfe-auth-serverless-${ENVIRONMENT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERRO]${NC} $1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Comando obrigatorio nao encontrado: $1"
    exit 1
  fi
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"

  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

check_prerequisites() {
  log_info "Verificando pre-requisitos"

  require_command aws
  require_command go
  require_command dotnet
  require_command node
  require_command npm
  require_command jq
  require_command curl

  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    log_error "AWS CLI sem credenciais validas. Execute 'aws configure' ou exporte credenciais."
    exit 1
  fi

  log_success "Ambiente pronto para deploy"
}

build_authorizer() {
  log_info "Build do lambda authorizer"
  cd "$AUTHORIZER_DIR"
  npm ci
  npm run build
}

build_faturamento() {
  log_info "Build das Lambdas Go ativas"
  cd "$FATURAMENTO_DIR"

  go mod download

  mkdir -p build build-pdf build-estoque-consumer

  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags lambda.norpc -o build/bootstrap ./cmd/lambda/main.go

  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags lambda.norpc -o build-pdf/bootstrap ./cmd/lambda-pdf/main.go

  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags lambda.norpc -o build-estoque-consumer/bootstrap ./cmd/lambda-estoque-consumer/main.go

  log_success "Lambdas Go compiladas"
}

build_estoque() {
  log_info "Publish da API .NET e do outbox publisher"
  cd "$ESTOQUE_DIR"

  dotnet restore

  dotnet publish ServicoEstoque.csproj \
    -c Release \
    -r linux-x64 \
    --self-contained false \
    -o publish-dynamodb

  dotnet publish OutboxPublisher/OutboxPublisher.csproj \
    -c Release \
    -r linux-x64 \
    --self-contained false \
    -o OutboxPublisher/publish

  log_success "Artefatos .NET gerados"
}

deploy_cdk() {
  log_info "Deploy do app CDK serverless"
  cd "$CDK_DIR"

  npm ci
  npm run build

  npx cdk deploy \
    --all \
    --app "npx ts-node --prefer-ts-exts bin/nfe-infra-serverless.ts" \
    --context env="$ENVIRONMENT" \
    --require-approval never

  log_success "CDK deploy concluido"
}

validate_health() {
  log_info "Validando endpoints principais"

  local api_faturamento_url
  local api_estoque_url
  api_faturamento_url="$(stack_output "$COMPUTE_STACK_NAME" "ApiFaturamentoUrl")"
  api_estoque_url="$(stack_output "$COMPUTE_STACK_NAME" "ApiEstoqueUrl")"

  if [[ -z "$api_faturamento_url" || -z "$api_estoque_url" ]]; then
    log_error "Nao foi possivel resolver as URLs das APIs via CloudFormation."
    exit 1
  fi

  local faturamento_status
  local estoque_status
  faturamento_status="$(curl -s -o /dev/null -w "%{http_code}" "${api_faturamento_url}/health")"
  estoque_status="$(curl -s -o /dev/null -w "%{http_code}" "${api_estoque_url}/health")"

  if [[ "$faturamento_status" != "200" ]]; then
    log_error "Health check do faturamento falhou com HTTP ${faturamento_status}"
    exit 1
  fi

  if [[ "$estoque_status" != "200" ]]; then
    log_error "Health check do estoque falhou com HTTP ${estoque_status}"
    exit 1
  fi

  log_success "Health checks aprovados"
}

print_summary() {
  local api_faturamento_url
  local api_estoque_url
  local frontend_url
  local user_pool_id
  local user_pool_client_id
  local dashboard_name

  api_faturamento_url="$(stack_output "$COMPUTE_STACK_NAME" "ApiFaturamentoUrl")"
  api_estoque_url="$(stack_output "$COMPUTE_STACK_NAME" "ApiEstoqueUrl")"
  frontend_url="$(stack_output "$FRONTEND_STACK_NAME" "CloudFrontUrl")"
  user_pool_id="$(stack_output "$AUTH_STACK_NAME" "UserPoolId")"
  user_pool_client_id="$(stack_output "$AUTH_STACK_NAME" "UserPoolClientId")"
  dashboard_name="$(stack_output "$COMPUTE_STACK_NAME" "ObservabilityDashboardName")"

  echo
  log_success "Deploy serverless concluido"
  echo "  API faturamento: $api_faturamento_url"
  echo "  API estoque: $api_estoque_url"
  echo "  Frontend: $frontend_url"
  echo "  Cognito User Pool: $user_pool_id"
  echo "  Cognito Client Id: $user_pool_client_id"
  echo "  Dashboard: $dashboard_name"
  echo
  echo "Use esses outputs para configurar o runtime do frontend ou validar o ambiente."
}

main() {
  check_prerequisites
  build_authorizer
  build_faturamento
  build_estoque
  deploy_cdk
  validate_health
  print_summary
}

main "$@"
