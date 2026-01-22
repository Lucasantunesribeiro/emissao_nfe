#!/bin/bash

# ================================================================
# Script: Criar Schemas no RDS PostgreSQL
# Database: nfe_db
# Environment: dev
# ================================================================

set -e

echo "🗄️  Criando schemas no RDS PostgreSQL..."

# Configurações
RDS_ENDPOINT="nfe-db-dev.cch2gou443t0.us-east-1.rds.amazonaws.com"
DB_NAME="nfe_db"
DB_USER="postgres"
SECRET_ARN="arn:aws:secretsmanager:us-east-1:212051644015:secret:nfe/db/credentials-dev-worXqM"
REGION="us-east-1"

# Recuperar senha do Secrets Manager
echo "📥 Recuperando senha do Secrets Manager..."
DB_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id "$SECRET_ARN" \
  --region "$REGION" \
  --query SecretString \
  --output text | jq -r '.password')

if [ -z "$DB_PASSWORD" ]; then
  echo "❌ Erro: Não foi possível recuperar a senha"
  exit 1
fi

echo "✅ Senha recuperada com sucesso"

# Verificar se psql está instalado
if ! command -v psql &> /dev/null; then
  echo "❌ Erro: psql não encontrado"
  echo ""
  echo "Instale o PostgreSQL client:"
  echo "  Ubuntu/Debian: sudo apt-get install postgresql-client"
  echo "  macOS: brew install postgresql"
  echo "  Windows: Baixe de https://www.postgresql.org/download/"
  echo ""
  echo "Ou use Docker:"
  echo "  docker run --rm -i postgres:16-alpine psql \"host=$RDS_ENDPOINT port=5432 dbname=$DB_NAME user=$DB_USER password=$DB_PASSWORD sslmode=require\" -f /path/to/create-schemas-simple.sql"
  exit 1
fi

# Criar schemas
echo "🔨 Criando schemas faturamento e estoque..."

PGPASSWORD="$DB_PASSWORD" psql \
  -h "$RDS_ENDPOINT" \
  -p 5432 \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "CREATE SCHEMA IF NOT EXISTS faturamento; CREATE SCHEMA IF NOT EXISTS estoque; ALTER USER postgres SET search_path TO faturamento, estoque, public;"

if [ $? -eq 0 ]; then
  echo "✅ Schemas criados com sucesso"
else
  echo "❌ Erro ao criar schemas"
  exit 1
fi

# Verificar schemas
echo "🔍 Verificando schemas criados..."
PGPASSWORD="$DB_PASSWORD" psql \
  -h "$RDS_ENDPOINT" \
  -p 5432 \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('faturamento', 'estoque');"

echo ""
echo "✅ Schemas criados com sucesso!"
echo ""
echo "Próximos passos:"
echo "1. Executar migrations do serviço Faturamento (Go)"
echo "2. Executar migrations do serviço Estoque (.NET)"
echo "3. Testar APIs: https://ilbswtmp4m.execute-api.us-east-1.amazonaws.com/dev/health"
