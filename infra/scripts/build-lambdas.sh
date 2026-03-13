#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FATURAMENTO_DIR="$PROJECT_ROOT/servico-faturamento"
ESTOQUE_DIR="$PROJECT_ROOT/servico-estoque"

echo "Building active Lambda artifacts for the serverless stack"

cd "$FATURAMENTO_DIR"
go mod download
mkdir -p build build-pdf build-estoque-consumer

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -o build/bootstrap ./cmd/lambda/main.go

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -o build-pdf/bootstrap ./cmd/lambda-pdf/main.go

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  go build -tags lambda.norpc -o build-estoque-consumer/bootstrap ./cmd/lambda-estoque-consumer/main.go

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

echo "Artifacts generated:"
echo "  - servico-faturamento/build/bootstrap"
echo "  - servico-faturamento/build-pdf/bootstrap"
echo "  - servico-faturamento/build-estoque-consumer/bootstrap"
echo "  - servico-estoque/publish-dynamodb"
echo "  - servico-estoque/OutboxPublisher/publish"
