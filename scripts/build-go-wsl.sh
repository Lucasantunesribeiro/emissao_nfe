#!/usr/bin/env bash
set -euo pipefail

export GOROOT=/home/lucas/go
export GOPATH=/home/lucas/go-path
export PATH="$GOROOT/bin:$PATH"

mkdir -p "$GOPATH"

cd /mnt/d/Programacao/Emissao_NFE/servico-faturamento

mkdir -p build build-pdf build-estoque-consumer

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -tags lambda.norpc \
  -ldflags="-s -w" \
  -o build/bootstrap \
  ./cmd/lambda/main.go

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -tags lambda.norpc \
  -ldflags="-s -w" \
  -o build-pdf/bootstrap \
  ./cmd/lambda-pdf/main.go

GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build \
  -tags lambda.norpc \
  -ldflags="-s -w" \
  -o build-estoque-consumer/bootstrap \
  ./cmd/lambda-estoque-consumer/main.go

for artifact_dir in build build-pdf build-estoque-consumer; do
  cd "/mnt/d/Programacao/Emissao_NFE/servico-faturamento/${artifact_dir}"

  zip_name="../${artifact_dir}.zip"
  if command -v zip >/dev/null 2>&1; then
    zip -r "$zip_name" bootstrap
  else
    python3 - <<PY
import zipfile
with zipfile.ZipFile('${zip_name}', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    archive.write('bootstrap')
PY
  fi
done
