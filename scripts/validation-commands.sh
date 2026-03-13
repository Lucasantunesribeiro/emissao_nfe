#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-dev}"
AWS_REGION="${AWS_REGION:-us-east-1}"

COMPUTE_STACK_NAME="nfe-compute-serverless-${ENVIRONMENT}"
FRONTEND_STACK_NAME="nfe-frontend-serverless-${ENVIRONMENT}"
AUTH_STACK_NAME="nfe-auth-serverless-${ENVIRONMENT}"
DATABASE_STACK_NAME="nfe-database-dynamodb-${ENVIRONMENT}"
MESSAGING_STACK_NAME="nfe-messaging-serverless-${ENVIRONMENT}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TESTS_TOTAL=0
TESTS_PASSED=0
TESTS_FAILED=0

log() {
  echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1"
}

ok() {
  echo -e "${GREEN}[OK]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

fail() {
  echo -e "${RED}[FAIL]${NC} $1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Comando obrigatorio nao encontrado: $1"
    exit 1
  fi
}

stack_output() {
  local stack_name="$1"
  local output_key="$2"

  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='${output_key}'].OutputValue" \
    --output text
}

assert_success() {
  local description="$1"
  shift

  ((TESTS_TOTAL += 1))

  if "$@"; then
    ok "$description"
    ((TESTS_PASSED += 1))
  else
    fail "$description"
    ((TESTS_FAILED += 1))
  fi
}

check_prerequisites() {
  require_command aws
  require_command jq
  require_command curl

  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    fail "AWS credentials invalidas ou expiradas."
    exit 1
  fi
}

stack_exists() {
  aws cloudformation describe-stacks \
    --region "$AWS_REGION" \
    --stack-name "$1" >/dev/null 2>&1
}

lambda_is_active() {
  local function_name="$1"
  local state
  state="$(aws lambda get-function \
    --region "$AWS_REGION" \
    --function-name "$function_name" \
    --query 'Configuration.State' \
    --output text 2>/dev/null || true)"
  [[ "$state" == "Active" ]]
}

alarm_exists() {
  local alarm_name="$1"
  local result
  result="$(aws cloudwatch describe-alarms \
    --region "$AWS_REGION" \
    --alarm-names "$alarm_name" \
    --query 'MetricAlarms[0].AlarmName' \
    --output text 2>/dev/null || true)"
  [[ "$result" == "$alarm_name" ]]
}

check_http_200() {
  local url="$1"
  local status
  status="$(curl -s -o /dev/null -w "%{http_code}" "$url")"
  [[ "$status" == "200" ]]
}

check_cors_origin() {
  local url="$1"
  local origin="$2"
  local headers
  headers="$(curl -s -I -X OPTIONS "$url" \
    -H "Origin: $origin" \
    -H "Access-Control-Request-Method: GET")"

  echo "$headers" | grep -iq "access-control-allow-origin: $origin"
}

main() {
  check_prerequisites

  log "Validando stacks ativas do ambiente ${ENVIRONMENT}"
  assert_success "Stack Auth presente" stack_exists "$AUTH_STACK_NAME"
  assert_success "Stack DynamoDB presente" stack_exists "$DATABASE_STACK_NAME"
  assert_success "Stack Messaging presente" stack_exists "$MESSAGING_STACK_NAME"
  assert_success "Stack Compute presente" stack_exists "$COMPUTE_STACK_NAME"
  assert_success "Stack Frontend presente" stack_exists "$FRONTEND_STACK_NAME"

  log "Validando Lambdas principais"
  assert_success "Lambda faturamento ativa" lambda_is_active "nfe-faturamento-${ENVIRONMENT}"
  assert_success "Lambda estoque ativa" lambda_is_active "nfe-estoque-${ENVIRONMENT}"
  assert_success "Lambda estoque-consumer ativa" lambda_is_active "nfe-estoque-consumer-${ENVIRONMENT}"
  assert_success "Lambda pdf ativa" lambda_is_active "nfe-pdf-generator-${ENVIRONMENT}"
  assert_success "Lambda outbox publisher ativa" lambda_is_active "nfe-outbox-publisher-${ENVIRONMENT}"

  log "Validando endpoints"
  API_FATURAMENTO_URL="$(stack_output "$COMPUTE_STACK_NAME" "ApiFaturamentoUrl")"
  API_ESTOQUE_URL="$(stack_output "$COMPUTE_STACK_NAME" "ApiEstoqueUrl")"
  FRONTEND_URL="$(stack_output "$FRONTEND_STACK_NAME" "CloudFrontUrl")"
  DASHBOARD_NAME="$(stack_output "$COMPUTE_STACK_NAME" "ObservabilityDashboardName")"
  USER_POOL_ID="$(stack_output "$AUTH_STACK_NAME" "UserPoolId")"
  USER_POOL_CLIENT_ID="$(stack_output "$AUTH_STACK_NAME" "UserPoolClientId")"

  assert_success "Health do faturamento responde 200" check_http_200 "${API_FATURAMENTO_URL}/health"
  assert_success "Health do estoque responde 200" check_http_200 "${API_ESTOQUE_URL}/health"
  assert_success "CORS do faturamento aceita a origem do frontend" check_cors_origin "${API_FATURAMENTO_URL}/health" "$FRONTEND_URL"

  log "Validando observabilidade"
  assert_success "Alarme de erros do faturamento existe" alarm_exists "nfe-faturamento-errors-${ENVIRONMENT}"
  assert_success "Alarme de erros do estoque existe" alarm_exists "nfe-estoque-errors-${ENVIRONMENT}"
  assert_success "Alarme de latencia da API de faturamento existe" alarm_exists "nfe-api-faturamento-latency-${ENVIRONMENT}"
  assert_success "Alarme de latencia da API de estoque existe" alarm_exists "nfe-api-estoque-latency-${ENVIRONMENT}"
  assert_success "Alarme de DLQ existe" alarm_exists "nfe-dlq-messages-${ENVIRONMENT}"

  log "Resumo"
  echo "  API faturamento: $API_FATURAMENTO_URL"
  echo "  API estoque: $API_ESTOQUE_URL"
  echo "  Frontend: $FRONTEND_URL"
  echo "  User Pool: $USER_POOL_ID"
  echo "  User Pool Client: $USER_POOL_CLIENT_ID"
  echo "  Dashboard: $DASHBOARD_NAME"
  echo "  Testes aprovados: $TESTS_PASSED/$TESTS_TOTAL"

  if [[ "$TESTS_FAILED" -gt 0 ]]; then
    warn "Falhas encontradas: $TESTS_FAILED"
    exit 1
  fi

  ok "Validacao operacional concluida"
}

main "$@"
