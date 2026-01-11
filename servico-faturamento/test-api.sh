#!/bin/bash

# Script de teste da API de Faturamento
# Uso: ./test-api.sh

set -e

API_URL="http://localhost:8080/api/v1"
PRODUTO_ID="123e4567-e89b-12d3-a456-426614174000"

echo "=== Teste do Serviço de Faturamento ==="
echo ""

# Health check
echo "1. Health Check"
curl -s "$API_URL/../health" | jq .
echo -e "\n"

# Criar nota fiscal
echo "2. Criando nota fiscal..."
NOTA_RESPONSE=$(curl -s -X POST "$API_URL/notas" \
  -H "Content-Type: application/json" \
  -d '{"numero": "NF-2025-001"}')

echo "$NOTA_RESPONSE" | jq .
NOTA_ID=$(echo "$NOTA_RESPONSE" | jq -r '.id')
echo "→ Nota criada com ID: $NOTA_ID"
echo -e "\n"

# Adicionar item 1
echo "3. Adicionando item 1 à nota..."
curl -s -X POST "$API_URL/notas/$NOTA_ID/itens" \
  -H "Content-Type: application/json" \
  -d "{
    \"produto_id\": \"$PRODUTO_ID\",
    \"quantidade\": 10,
    \"preco_unitario\": 99.90
  }" | jq .
echo -e "\n"

# Adicionar item 2
echo "4. Adicionando item 2 à nota..."
curl -s -X POST "$API_URL/notas/$NOTA_ID/itens" \
  -H "Content-Type: application/json" \
  -d "{
    \"produto_id\": \"$PRODUTO_ID\",
    \"quantidade\": 5,
    \"preco_unitario\": 49.90
  }" | jq .
echo -e "\n"

# Buscar nota com itens
echo "5. Buscando nota fiscal com itens..."
curl -s "$API_URL/notas/$NOTA_ID" | jq .
echo -e "\n"

# Solicitar impressão (idempotente)
echo "6. Solicitando impressão (primeira vez)..."
IDEMPOTENCY_KEY="test-$(date +%s)"
SOLICITACAO_RESPONSE=$(curl -s -X POST "$API_URL/notas/$NOTA_ID/imprimir" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY")

echo "$SOLICITACAO_RESPONSE" | jq .
SOLICITACAO_ID=$(echo "$SOLICITACAO_RESPONSE" | jq -r '.id')
echo "→ Solicitação criada com ID: $SOLICITACAO_ID"
echo -e "\n"

# Solicitar impressão novamente (deve retornar a mesma)
echo "7. Solicitando impressão novamente (idempotência)..."
curl -s -X POST "$API_URL/notas/$NOTA_ID/imprimir" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" | jq .
echo "→ Deve retornar a mesma solicitação (status code 200)"
echo -e "\n"

# Consultar status da solicitação
echo "8. Consultando status da solicitação..."
curl -s "$API_URL/solicitacoes-impressao/$SOLICITACAO_ID" | jq .
echo -e "\n"

# Listar todas as notas
echo "9. Listando todas as notas..."
curl -s "$API_URL/notas" | jq .
echo -e "\n"

# Listar notas ABERTAS
echo "10. Listando apenas notas ABERTAS..."
curl -s "$API_URL/notas?status=ABERTA" | jq .
echo -e "\n"

echo "=== Testes Concluídos ==="
echo ""
echo "IDs gerados:"
echo "  Nota ID: $NOTA_ID"
echo "  Solicitação ID: $SOLICITACAO_ID"
echo "  Idempotency Key: $IDEMPOTENCY_KEY"