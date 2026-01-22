#!/usr/bin/env bash
set -euo pipefail

export GOROOT=/home/lucas/go
export GOPATH=/home/lucas/go-path
export PATH="$GOROOT/bin:$PATH"

mkdir -p "$GOPATH"

cd /mnt/d/Programacao/Emissao_NFE/servico-faturamento

GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -ldflags="-s -w" -o build/bootstrap ./cmd/lambda/

cd build
if command -v zip >/dev/null 2>&1; then
  zip -r ../lambda-faturamento.zip bootstrap
else
  python3 - <<'PY'
import zipfile
with zipfile.ZipFile('../lambda-faturamento.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.write('bootstrap')
PY
fi

cd ..
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -ldflags="-s -w" -o build-outbox/bootstrap ./cmd/lambda-outbox/

cd build-outbox
if command -v zip >/dev/null 2>&1; then
  zip -r ../lambda-outbox.zip bootstrap
else
  python3 - <<'PY'
import zipfile
with zipfile.ZipFile('../lambda-outbox.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.write('bootstrap')
PY
fi
