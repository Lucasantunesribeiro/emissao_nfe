#!/bin/bash
set -e

echo "🔨 Build e Deploy Lambda Estoque com Docker"
echo ""

# 1. Build usando Docker
echo "[1/5] Compilando Lambda com Docker (evita problemas de permissão)..."
docker build -f Dockerfile.build -t lambda-estoque-builder .

# 2. Extrair bootstrap do container
echo "[2/5] Extraindo bootstrap do container..."
mkdir -p docker-output
docker create --name temp-lambda lambda-estoque-builder
docker cp temp-lambda:/app/publish/bootstrap ./docker-output/bootstrap
docker rm temp-lambda

# 3. Criar ZIP
echo "[3/5] Criando ZIP do Lambda..."
cd docker-output
zip -r ../lambda-estoque.zip bootstrap
cd ..

# 4. Upload para AWS
echo "[4/5] Fazendo upload para AWS Lambda..."
aws lambda update-function-code \
  --function-name nfe-estoque-dev \
  --zip-file fileb://lambda-estoque.zip \
  --region us-east-1

# 5. Aguardar atualização
echo "[5/5] Aguardando Lambda processar..."
aws lambda wait function-updated \
  --function-name nfe-estoque-dev \
  --region us-east-1

echo ""
echo "✅ Deploy completo!"
echo ""
echo "🧪 Testando endpoint..."
sleep 3
curl -s https://7wirfgw006.execute-api.us-east-1.amazonaws.com/dev/api/v1/produtos | jq .

echo ""
echo "✅ Tudo pronto! O erro 500 deve estar corrigido."
