#!/bin/bash
set -euo pipefail

################################################################################
# deploy-serverless.sh
#
# Script de deploy automatizado para arquitetura serverless NFe.
# Realiza build dos Lambdas, deploy dos stacks CDK e validação de health.
#
# Uso:
#   ./deploy-serverless.sh [dev|prod]
#
# Pré-requisitos:
#   - AWS CLI v2 configurado
#   - Go 1.22+
#   - .NET 8 SDK
#   - Node.js 22+ (CDK)
#   - jq instalado
################################################################################

# ===========================
# Configuração
# ===========================

ENVIRONMENT="${1:-dev}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CDK_DIR="$PROJECT_ROOT/infra/cdk"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ===========================
# Funções Auxiliares
# ===========================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    log_info "Verificando pré-requisitos..."

    # AWS CLI
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI não instalado. Instale: https://aws.amazon.com/cli/"
        exit 1
    fi

    # Go
    if ! command -v go &> /dev/null; then
        log_error "Go não instalado. Instale: https://go.dev/dl/"
        exit 1
    fi

    GO_VERSION=$(go version | awk '{print $3}' | sed 's/go//')
    if [[ "$(printf '%s\n' "1.22" "$GO_VERSION" | sort -V | head -n1)" != "1.22" ]]; then
        log_error "Go versão >= 1.22 requerida. Atual: $GO_VERSION"
        exit 1
    fi

    # .NET
    if ! command -v dotnet &> /dev/null; then
        log_error ".NET SDK não instalado. Instale: https://dotnet.microsoft.com/download"
        exit 1
    fi

    DOTNET_VERSION=$(dotnet --version | cut -d'.' -f1)
    if [[ "$DOTNET_VERSION" -lt 8 ]]; then
        log_error ".NET SDK >= 8.0 requerida. Atual: $(dotnet --version)"
        exit 1
    fi

    # Node.js (CDK)
    if ! command -v node &> /dev/null; then
        log_error "Node.js não instalado. Instale: https://nodejs.org/"
        exit 1
    fi

    # jq
    if ! command -v jq &> /dev/null; then
        log_error "jq não instalado. Instale: apt-get install jq"
        exit 1
    fi

    # AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS credentials não configuradas. Execute: aws configure"
        exit 1
    fi

    log_success "Todos os pré-requisitos atendidos ✓"
}

backup_rds() {
    log_info "Criando backup RDS antes do deploy..."

    SNAPSHOT_ID="nfe-db-backup-pre-serverless-$(date +%Y%m%d-%H%M%S)"
    DB_INSTANCE_ID="nfe-db-${ENVIRONMENT}"

    # Verificar se RDS existe
    if aws rds describe-db-instances \
        --db-instance-identifier "$DB_INSTANCE_ID" \
        --query 'DBInstances[0].DBInstanceIdentifier' \
        --output text 2>/dev/null | grep -q "$DB_INSTANCE_ID"; then

        log_info "Criando snapshot: $SNAPSHOT_ID"
        aws rds create-db-snapshot \
            --db-instance-identifier "$DB_INSTANCE_ID" \
            --db-snapshot-identifier "$SNAPSHOT_ID" \
            --tags Key=Environment,Value="$ENVIRONMENT" Key=Purpose,Value="pre-serverless-migration"

        log_info "Aguardando snapshot completar (pode levar 5-10min)..."
        aws rds wait db-snapshot-completed \
            --db-snapshot-identifier "$SNAPSHOT_ID"

        log_success "Backup RDS criado: $SNAPSHOT_ID ✓"
    else
        log_warning "RDS não encontrado, pulando backup."
    fi
}

build_lambda_faturamento() {
    log_info "Building Lambda Faturamento (Go ARM64)..."

    cd "$PROJECT_ROOT/servico-faturamento"

    # Criar diretório build
    mkdir -p build build-outbox

    # Lambda handler principal (API)
    log_info "  → Building main Lambda handler..."
    GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build \
        -tags lambda.norpc \
        -ldflags="-s -w" \
        -o build/bootstrap \
        cmd/lambda/main.go

    # Lambda Outbox Processor
    log_info "  → Building Outbox Processor..."
    GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build \
        -tags lambda.norpc \
        -ldflags="-s -w" \
        -o build-outbox/bootstrap \
        cmd/outbox/main.go

    # Verificar binários
    if [[ ! -f "build/bootstrap" ]] || [[ ! -f "build-outbox/bootstrap" ]]; then
        log_error "Falha no build dos binários Go"
        exit 1
    fi

    BUILD_SIZE=$(du -h build/bootstrap | awk '{print $1}')
    OUTBOX_SIZE=$(du -h build-outbox/bootstrap | awk '{print $1}')

    log_success "Lambda Faturamento built: $BUILD_SIZE (main), $OUTBOX_SIZE (outbox) ✓"
}

build_lambda_estoque() {
    log_info "Building Lambda Estoque (.NET 8 ARM64 Native AOT)..."

    cd "$PROJECT_ROOT/servico-estoque"

    # Publish Native AOT
    log_info "  → Publishing .NET Native AOT (pode levar 3-5min)..."
    dotnet publish \
        -c Release \
        -r linux-arm64 \
        --self-contained \
        -p:PublishAot=true \
        -p:StripSymbols=true \
        -o publish \
        ServicoEstoque.csproj

    # Verificar binário
    if [[ ! -f "publish/ServicoEstoque" ]]; then
        log_error "Falha no publish .NET"
        exit 1
    fi

    BUILD_SIZE=$(du -h publish/ServicoEstoque | awk '{print $1}')
    log_success "Lambda Estoque built: $BUILD_SIZE ✓"
}

deploy_cdk_stacks() {
    log_info "Deploying CDK stacks (serverless architecture)..."

    cd "$CDK_DIR"

    # Install dependencies se necessário
    if [[ ! -d "node_modules" ]]; then
        log_info "  → Installing CDK dependencies..."
        npm ci
    fi

    # Synth para validar templates
    log_info "  → Synthesizing CloudFormation templates..."
    npx cdk synth --context environment="$ENVIRONMENT" > /dev/null

    # Deploy em ordem correta (dependências)
    log_info "  → Deploying DatabaseStackServerless..."
    npx cdk deploy DatabaseStackServerless \
        --context environment="$ENVIRONMENT" \
        --require-approval never \
        --outputs-file outputs-database.json

    log_info "  → Deploying MessagingStackServerless..."
    npx cdk deploy MessagingStackServerless \
        --context environment="$ENVIRONMENT" \
        --require-approval never \
        --outputs-file outputs-messaging.json

    log_info "  → Deploying ComputeStackServerless..."
    npx cdk deploy ComputeStackServerless \
        --context environment="$ENVIRONMENT" \
        --require-approval never \
        --outputs-file outputs-compute.json

    log_success "CDK stacks deployed ✓"
}

create_database_schemas() {
    log_info "Criando schemas PostgreSQL (faturamento, estoque)..."

    # Obter RDS Proxy endpoint do output CDK
    RDS_PROXY_ENDPOINT=$(jq -r '.DatabaseStackServerless.RdsProxyEndpoint' "$CDK_DIR/outputs-database.json")

    if [[ "$RDS_PROXY_ENDPOINT" == "null" ]] || [[ -z "$RDS_PROXY_ENDPOINT" ]]; then
        log_error "RDS Proxy endpoint não encontrado nos outputs CDK"
        exit 1
    fi

    # Obter credenciais do Secrets Manager
    SECRET_ARN=$(jq -r '.DatabaseStackServerless.DbSecretArn' "$CDK_DIR/outputs-database.json")
    DB_USER=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text | jq -r '.username')
    DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text | jq -r '.password')

    # Executar SQL de criação de schemas
    log_info "  → Conectando em $RDS_PROXY_ENDPOINT..."
    export PGPASSWORD="$DB_PASSWORD"

    psql -h "$RDS_PROXY_ENDPOINT" \
         -U "$DB_USER" \
         -d nfe_db \
         -f "$SCRIPT_DIR/create-schemas.sql" \
         --set ON_ERROR_STOP=1

    unset PGPASSWORD

    log_success "Schemas criados ✓"
}

run_migrations() {
    log_info "Executando migrations (faturamento + estoque)..."

    RDS_PROXY_ENDPOINT=$(jq -r '.DatabaseStackServerless.RdsProxyEndpoint' "$CDK_DIR/outputs-database.json")
    SECRET_ARN=$(jq -r '.DatabaseStackServerless.DbSecretArn' "$CDK_DIR/outputs-database.json")
    DB_USER=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text | jq -r '.username')
    DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --query 'SecretString' --output text | jq -r '.password')

    export PGPASSWORD="$DB_PASSWORD"

    # Migration Faturamento
    log_info "  → Running faturamento migrations..."
    psql -h "$RDS_PROXY_ENDPOINT" \
         -U "$DB_USER" \
         -d nfe_db \
         -f "$SCRIPT_DIR/../scripts/migrations/faturamento-init.sql" \
         --set ON_ERROR_STOP=1

    # Migration Estoque
    log_info "  → Running estoque migrations..."
    psql -h "$RDS_PROXY_ENDPOINT" \
         -U "$DB_USER" \
         -d nfe_db \
         -f "$SCRIPT_DIR/../scripts/migrations/estoque-init.sql" \
         --set ON_ERROR_STOP=1

    unset PGPASSWORD

    log_success "Migrations executadas ✓"
}

validate_health() {
    log_info "Validando health checks dos Lambdas..."

    # Obter URLs dos API Gateways
    API_FATURAMENTO_URL=$(jq -r '.ComputeStackServerless.ApiFaturamentoUrl' "$CDK_DIR/outputs-compute.json")
    API_ESTOQUE_URL=$(jq -r '.ComputeStackServerless.ApiEstoqueUrl' "$CDK_DIR/outputs-compute.json")

    # Test Faturamento health
    log_info "  → Testing $API_FATURAMENTO_URL/health"
    FATURAMENTO_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$API_FATURAMENTO_URL/health")

    if [[ "$FATURAMENTO_HEALTH" != "200" ]]; then
        log_error "Lambda Faturamento health check falhou (HTTP $FATURAMENTO_HEALTH)"
        exit 1
    fi

    # Test Estoque health
    log_info "  → Testing $API_ESTOQUE_URL/health"
    ESTOQUE_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$API_ESTOQUE_URL/health")

    if [[ "$ESTOQUE_HEALTH" != "200" ]]; then
        log_error "Lambda Estoque health check falhou (HTTP $ESTOQUE_HEALTH)"
        exit 1
    fi

    log_success "Health checks OK ✓"
}

print_summary() {
    log_success "================================"
    log_success "Deploy Serverless Completo! ✓"
    log_success "================================"

    API_FATURAMENTO_URL=$(jq -r '.ComputeStackServerless.ApiFaturamentoUrl' "$CDK_DIR/outputs-compute.json")
    API_ESTOQUE_URL=$(jq -r '.ComputeStackServerless.ApiEstoqueUrl' "$CDK_DIR/outputs-compute.json")
    RDS_PROXY_ENDPOINT=$(jq -r '.DatabaseStackServerless.RdsProxyEndpoint' "$CDK_DIR/outputs-database.json")
    EVENT_BUS_NAME=$(jq -r '.MessagingStackServerless.EventBusName' "$CDK_DIR/outputs-messaging.json")

    echo ""
    echo "Recursos Provisionados:"
    echo "  • API Faturamento: $API_FATURAMENTO_URL"
    echo "  • API Estoque: $API_ESTOQUE_URL"
    echo "  • RDS Proxy: $RDS_PROXY_ENDPOINT"
    echo "  • EventBus: $EVENT_BUS_NAME"
    echo ""
    echo "Próximos Passos:"
    echo "  1. Atualizar frontend com novas URLs de API"
    echo "  2. Executar testes end-to-end: npm run test:e2e"
    echo "  3. Load test: k6 run scripts/load-test.js"
    echo "  4. Monitorar CloudWatch Dashboard: https://console.aws.amazon.com/cloudwatch"
    echo ""
    echo "Economia Estimada: $136/mês (76% vs ECS)"
}

# ===========================
# Main
# ===========================

main() {
    log_info "Iniciando deploy serverless - Ambiente: $ENVIRONMENT"

    # Validações
    check_prerequisites

    # Confirmar antes de prosseguir
    read -p "Continuar com deploy em $ENVIRONMENT? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_warning "Deploy cancelado pelo usuário."
        exit 0
    fi

    # Pipeline
    backup_rds
    build_lambda_faturamento
    build_lambda_estoque
    deploy_cdk_stacks
    create_database_schemas
    run_migrations
    validate_health
    print_summary

    log_success "Deploy completo em $(date)"
}

# Executar
main "$@"
