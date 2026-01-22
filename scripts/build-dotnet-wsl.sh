#!/usr/bin/env bash
set -euo pipefail

export DOTNET_ROOT=/home/lucas/.dotnet
export PATH="$DOTNET_ROOT:$PATH"

cd /mnt/d/Programacao/Emissao_NFE/servico-estoque

$DOTNET_ROOT/dotnet publish -c Release -r linux-arm64 --self-contained -p:PublishAot=true -p:StripSymbols=true -o publish

cd publish

if [ ! -f bootstrap ]; then
  if [ -f ServicoEstoque ]; then
    cp ServicoEstoque bootstrap
  else
    echo "Arquivo bootstrap nao encontrado"
    exit 1
  fi
fi

chmod +x bootstrap

if command -v zip >/dev/null 2>&1; then
  zip -r ../lambda-estoque.zip bootstrap
else
  python3 - <<'PY'
import zipfile
with zipfile.ZipFile('../lambda-estoque.zip', 'w', compression=zipfile.ZIP_DEFLATED) as z:
    z.write('bootstrap')
PY
fi
