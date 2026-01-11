#!/bin/bash
set -e

# ========================================
# Deploy Frontend Angular para AWS S3 + CloudFront
# ========================================

# Configurações (ajustar conforme ambiente)
BUCKET="${S3_BUCKET:-nfe-web-app-prod}"
DISTRIBUTION_ID="${CLOUDFRONT_DISTRIBUTION_ID:-}"
BUILD_DIR="dist/web-app/browser"

echo "🔧 Configuração:"
echo "  Bucket: $BUCKET"
echo "  CloudFront: ${DISTRIBUTION_ID:-não configurado}"
echo ""

# Validar variáveis obrigatórias
if [ -z "$BUCKET" ]; then
  echo "❌ Erro: variável S3_BUCKET não definida"
  exit 1
fi

# 1. Instalar dependências (se necessário)
if [ ! -d "node_modules" ]; then
  echo "📦 Instalando dependências..."
  npm ci --prefer-offline --no-audit
fi

# 2. Build de produção
echo "🏗️  Building for production..."
npm run build:prod

# Validar build
if [ ! -d "$BUILD_DIR" ]; then
  echo "❌ Erro: diretório de build não encontrado ($BUILD_DIR)"
  exit 1
fi

# 3. Upload para S3
echo "📤 Uploading to S3 ($BUCKET)..."

# Upload de assets (com cache longo)
aws s3 sync "$BUILD_DIR/" "s3://$BUCKET/" \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable" \
  --metadata-directive REPLACE

# Upload de index.html (com cache curto)
aws s3 cp "$BUILD_DIR/index.html" "s3://$BUCKET/index.html" \
  --cache-control "public,max-age=300,must-revalidate" \
  --content-type "text/html" \
  --metadata-directive REPLACE

# 4. Invalidar cache CloudFront (se configurado)
if [ -n "$DISTRIBUTION_ID" ]; then
  echo "🔄 Invalidating CloudFront cache..."
  INVALIDATION_ID=$(aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/*" \
    --query 'Invalidation.Id' \
    --output text)

  echo "  Invalidation ID: $INVALIDATION_ID"
  echo "  Status: aws cloudfront get-invalidation --id $INVALIDATION_ID --distribution-id $DISTRIBUTION_ID"
else
  echo "⚠️  CloudFront distribution não configurado (variável CLOUDFRONT_DISTRIBUTION_ID)"
fi

# 5. Verificação pós-deploy
echo ""
echo "✅ Deploy completed!"
echo ""
echo "📊 Build info:"
du -sh "$BUILD_DIR"
echo ""
echo "🔗 URLs para validação:"
echo "  S3 Direct: http://$BUCKET.s3-website-us-east-1.amazonaws.com"
if [ -n "$DISTRIBUTION_ID" ]; then
  DOMAIN=$(aws cloudfront get-distribution --id "$DISTRIBUTION_ID" --query 'Distribution.DomainName' --output text 2>/dev/null || echo "")
  if [ -n "$DOMAIN" ]; then
    echo "  CloudFront: https://$DOMAIN"
  fi
fi
echo ""
echo "🧪 Testes recomendados:"
echo "  curl -I https://<seu-dominio>"
echo "  curl https://<seu-dominio>/api/v1/faturamento/health"
