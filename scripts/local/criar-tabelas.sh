#!/bin/sh
# Cria no DynamoDB Local as tabelas com o mesmo esquema de
# infra/cdk/lib/stacks/database-dynamodb-stack.ts (main + events).
# Idempotente: ignora tabela ja existente.
set -eu

ENDPOINT="${AWS_ENDPOINT_URL_DYNAMODB:-http://localhost:8000}"
MAIN="${DYNAMODB_TABLE_NAME:-nfe-main-local}"
EVENTS="${DYNAMODB_EVENTS_TABLE_NAME:-nfe-events-local}"

criar() {
  nome="$1"; shift
  if aws dynamodb describe-table --endpoint-url "$ENDPOINT" --table-name "$nome" >/dev/null 2>&1; then
    echo "Tabela $nome ja existe"
    return 0
  fi
  aws dynamodb create-table --endpoint-url "$ENDPOINT" --table-name "$nome" \
    --billing-mode PAY_PER_REQUEST "$@" >/dev/null
  echo "Tabela $nome criada"
}

criar "$MAIN" \
  --attribute-definitions \
    AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
    AttributeName=GSI1_PK,AttributeType=S \
    AttributeName=GSI2_PK,AttributeType=S AttributeName=GSI2_SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes \
    'IndexName=GSI1,KeySchema=[{AttributeName=GSI1_PK,KeyType=HASH}],Projection={ProjectionType=ALL}' \
    'IndexName=GSI2,KeySchema=[{AttributeName=GSI2_PK,KeyType=HASH},{AttributeName=GSI2_SK,KeyType=RANGE}],Projection={ProjectionType=ALL}'

criar "$EVENTS" \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE
