#!/bin/bash
# Script para rebuildar e deployar o Lambda Estoque com correções de CORS
# Requer: .NET 9 SDK instalado

set -e

echo "🔨 Rebuild Lambda Estoque com CORS corrigido..."
echo ""

# 1. Build com Native AOT para ARM64
echo "[1/4] Building .NET Lambda com Native AOT..."
dotnet publish -c Release -r linux-arm64 --self-contained \
  -p:PublishAot=true \
  -p:StripSymbols=true \
  -o publish

# 2. Criar ZIP do bootstrap
echo "[2/4] Criando ZIP do Lambda..."
cd publish
zip -r ../lambda-estoque.zip bootstrap
cd ..

# 3. Atualizar função Lambda
echo "[3/4] Atualizando Lambda function code..."
aws lambda update-function-code \
  --function-name nfe-estoque-dev \
  --zip-file fileb://lambda-estoque.zip

# 4. Aguardar Lambda ficar pronto
echo "[4/4] Aguardando Lambda atualizar..."
aws lambda wait function-updated \
  --function-name nfe-estoque-dev

echo "✅ Lambda Estoque atualizado com sucesso!"
echo ""
echo "🧪 Testando health check..."
sleep 3
curl -s https://7wirfgw006.execute-api.us-east-1.amazonaws.com/dev/health | jq .

echo ""
echo "✅ Deploy completo! CORS agora deve funcionar."
