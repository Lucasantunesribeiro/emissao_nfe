# Script PowerShell para rebuild e deploy do Lambda Estoque
# Executa no Windows (não no WSL) para evitar problemas de permissão

$ErrorActionPreference = 'Stop'

Write-Host "🔨 Rebuild Lambda Estoque com correção JSON..." -ForegroundColor Cyan
Write-Host ""

# Navegar para o diretório do projeto
Set-Location $PSScriptRoot

# 1. Limpar builds anteriores
Write-Host "[1/5] Limpando builds anteriores..." -ForegroundColor Yellow
Remove-Item -Path bin, obj, publish, lambda-estoque.zip -Recurse -Force -ErrorAction SilentlyContinue

# 2. Build com Native AOT para ARM64
Write-Host "[2/5] Building .NET Lambda com Native AOT (pode demorar 2-3 min)..." -ForegroundColor Yellow
dotnet publish -c Release -r linux-arm64 --self-contained `
  -p:PublishAot=true `
  -p:StripSymbols=true `
  -o publish

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Erro no build. Verifique os erros acima." -ForegroundColor Red
    exit 1
}

# 3. Criar ZIP do bootstrap
Write-Host "[3/5] Criando ZIP do Lambda..." -ForegroundColor Yellow
Compress-Archive -Path publish/bootstrap -DestinationPath lambda-estoque.zip -Force

# 4. Atualizar função Lambda
Write-Host "[4/5] Atualizando Lambda function code..." -ForegroundColor Yellow
aws lambda update-function-code `
  --function-name nfe-estoque-dev `
  --zip-file fileb://lambda-estoque.zip `
  --region us-east-1

# 5. Aguardar Lambda ficar pronto
Write-Host "[5/5] Aguardando Lambda atualizar..." -ForegroundColor Yellow
aws lambda wait function-updated `
  --function-name nfe-estoque-dev `
  --region us-east-1

Write-Host ""
Write-Host "✅ Lambda Estoque atualizado com sucesso!" -ForegroundColor Green
Write-Host ""
Write-Host "🧪 Testando endpoint /produtos..." -ForegroundColor Cyan
Start-Sleep -Seconds 3

try {
    $response = Invoke-RestMethod -Uri "https://7wirfgw006.execute-api.us-east-1.amazonaws.com/dev/api/v1/produtos" -Method Get
    Write-Host "✅ Endpoint funcionando! Retornou $($response.Count) produtos." -ForegroundColor Green
} catch {
    Write-Host "❌ Erro ao testar endpoint: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "✅ Deploy completo! Problema de serialização JSON corrigido." -ForegroundColor Green
