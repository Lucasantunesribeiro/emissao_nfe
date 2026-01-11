# ========================================
# SCRIPT DE VALIDACAO COMPLETA - SISTEMA NFe
# ========================================
# Executa rebuild, restart e validacao completa dos 4 cenarios

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VALIDACAO COMPLETA - SISTEMA NFe" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$ErrorActionPreference = "Continue"
$webAppPort = if ([string]::IsNullOrWhiteSpace($env:WEBAPP_PORT)) { 4200 } else { [int]$env:WEBAPP_PORT }

# ETAPA 1: Rebuild de servicos com correcoes
Write-Host "[1/6] Rebuild dos servicos backend..." -ForegroundColor Yellow
docker-compose build servico-faturamento servico-estoque

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] FALHA no build dos servicos" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Build concluido com sucesso" -ForegroundColor Green
Write-Host ""

# ETAPA 2: Restart completo do ambiente
Write-Host "[2/6] Reiniciando ambiente Docker..." -ForegroundColor Yellow
docker-compose down
Start-Sleep -Seconds 3
docker-compose up -d

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERRO] FALHA ao iniciar servicos" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Servicos iniciados" -ForegroundColor Green
Write-Host ""

# ETAPA 3: Aguardar 60s para estabilizacao
Write-Host "[3/6] Aguardando 60 segundos para servicos estabilizarem..." -ForegroundColor Yellow
for ($i = 60; $i -gt 0; $i--) {
    Write-Host -NoNewline "`rTempo restante: $i segundos "
    Start-Sleep -Seconds 1
}
Write-Host ""
Write-Host "[OK] Periodo de estabilizacao concluido" -ForegroundColor Green
Write-Host ""

# ETAPA 4: Validar logs de conexao RabbitMQ
Write-Host "[4/6] Validando conexoes RabbitMQ..." -ForegroundColor Yellow

Write-Host "  - Faturamento:" -ForegroundColor Gray
$logsFat = docker logs servico-faturamento 2>&1 | Select-String -Pattern "Publicador conectado|Consumidor RabbitMQ iniciado"
if ($logsFat) {
    $logsFat | ForEach-Object { Write-Host "    $_" -ForegroundColor Green }
} else {
    Write-Host "    [AVISO] Nenhuma mensagem de conexao encontrada" -ForegroundColor Yellow
}

Write-Host "  - Estoque:" -ForegroundColor Gray
$logsEst = docker logs servico-estoque 2>&1 | Select-String -Pattern "Conectado ao RabbitMQ|Publisher Outbox iniciado"
if ($logsEst) {
    $logsEst | ForEach-Object { Write-Host "    $_" -ForegroundColor Green }
} else {
    Write-Host "    [AVISO] Nenhuma mensagem de conexao encontrada" -ForegroundColor Yellow
}
Write-Host ""

# ETAPA 5: Health checks de todos os servicos
Write-Host "[5/6] Verificando health dos servicos..." -ForegroundColor Yellow

$services = @(
    @{Name="postgres-estoque"; Port=5432; Path="/"},
    @{Name="postgres-faturamento"; Port=5433; Path="/"},
    @{Name="rabbitmq"; Port=15672; Path="/"},
    @{Name="servico-estoque"; Port=5001; Path="/health"},
    @{Name="servico-faturamento"; Port=5002; Path="/health"},
    @{Name="web-app"; Port=$webAppPort; Path="/"}
)

$allHealthy = $true
foreach ($svc in $services) {
    Write-Host "  - $($svc.Name):" -NoNewline -ForegroundColor Gray
    try {
        if ($svc.Name -like "postgres-*") {
            # Postgres nao tem HTTP, valida via docker ps
            $status = docker ps --filter "name=$($svc.Name)" --filter "health=healthy" --format "{{.Status}}"
            if ($status -match "healthy") {
                Write-Host " [OK]" -ForegroundColor Green
            } else {
                Write-Host " [ERRO] (nao healthy)" -ForegroundColor Red
                $allHealthy = $false
            }
        } elseif ($svc.Name -eq "rabbitmq") {
            # RabbitMQ valida via docker health
            $status = docker ps --filter "name=rabbitmq" --filter "health=healthy" --format "{{.Status}}"
            if ($status -match "healthy") {
                Write-Host " [OK]" -ForegroundColor Green
            } else {
                Write-Host " [ERRO] (nao healthy)" -ForegroundColor Red
                $allHealthy = $false
            }
        } else {
            # APIs validam via HTTP
            $url = "http://localhost:$($svc.Port)$($svc.Path)"
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($response.StatusCode -eq 200) {
                Write-Host " [OK]" -ForegroundColor Green
            } else {
                Write-Host " [ERRO] (HTTP $($response.StatusCode))" -ForegroundColor Red
                $allHealthy = $false
            }
        }
    } catch {
        Write-Host " [ERRO] ($($_.Exception.Message))" -ForegroundColor Red
        $allHealthy = $false
    }
}

if (-not $allHealthy) {
    Write-Host ""
    Write-Host "[AVISO] Alguns servicos nao estao saudaveis" -ForegroundColor Yellow
    Write-Host "Aguarde mais alguns segundos e tente novamente" -ForegroundColor Yellow
    Write-Host ""
}
Write-Host ""

# ETAPA 6: Executar testes automatizados
Write-Host "[6/6] Executando cenarios de teste..." -ForegroundColor Yellow

if (Test-Path ".\scripts\demo.ps1") {
    & ".\scripts\demo.ps1"
} else {
    Write-Host "[AVISO] Arquivo demo.ps1 nao encontrado em .\scripts\" -ForegroundColor Yellow
    Write-Host "Pulando testes automatizados" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  VALIDACAO CONCLUIDA" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "PROXIMOS PASSOS:" -ForegroundColor Yellow
Write-Host "1. Acesse o frontend: http://localhost:$webAppPort" -ForegroundColor White
Write-Host "2. Teste fluxo manual: criar produto > nota > item > imprimir" -ForegroundColor White
Write-Host "3. Verifique logs em tempo real: docker logs -f servico-faturamento" -ForegroundColor White
Write-Host "4. RabbitMQ Management: http://localhost:15672 - admin/admin123" -ForegroundColor White
Write-Host ""
