Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ApiEstoque     = 'http://localhost:5001/api/v1'
$ApiFaturamento = 'http://localhost:5002/api/v1'

function Write-Info {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray)
    Write-Host $Message -ForegroundColor $Color
}

function Invoke-Api {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET','POST','PUT','DELETE')] [string]$Method,
        [Parameter(Mandatory)] [string]$Uri,
        [object]$Body,
        [hashtable]$Headers
    )

    $params = @{ Method = $Method; Uri = $Uri; ContentType = 'application/json'; ErrorAction = 'Stop' }
    if ($Body)    { $params.Body    = ($Body | ConvertTo-Json -Depth 6) }
    if ($Headers) { $params.Headers = $Headers }

    return Invoke-RestMethod @params
}

Write-Info "=== Teste de Rollback (X-Demo-Fail) ===" ([ConsoleColor]::Cyan)

Write-Info 'Criando dados de teste...' ([ConsoleColor]::Gray)
$sku    = "ROLL-$(Get-Date -Format 'HHmmss')"
$produto = Invoke-Api -Method POST -Uri "$ApiEstoque/produtos" -Body @{ sku = $sku; nome = 'Produto Rollback Demo'; saldo = 5 }
$nota    = Invoke-Api -Method POST -Uri "$ApiFaturamento/notas" -Body @{ numero = "NFE-ROLL-${sku}" }

Write-Info "Produto criado: $($produto.sku) (Saldo inicial: $($produto.saldo))" ([ConsoleColor]::Green)
Write-Info "Nota criada:   $($nota.numero)" ([ConsoleColor]::Green)

$bodyReserva = @{ notaId = $nota.id; produtoId = $produto.id; quantidade = 3 }

$saldoAntes = (Invoke-Api -Method GET -Uri "$ApiEstoque/produtos/$($produto.id)").saldo
Write-Info "Saldo ANTES:  $saldoAntes" ([ConsoleColor]::Yellow)

Write-Info 'Enviando reserva com X-Demo-Fail=true ...' ([ConsoleColor]::Gray)
$falhaEsperada = $false
try {
    Invoke-Api -Method POST -Uri "$ApiEstoque/reservas" -Body $bodyReserva -Headers @{ 'X-Demo-Fail' = 'true' } | Out-Null
}
catch {
    $response = $_.Exception.Response
    if ($response -and $response.StatusCode.value__ -eq 400) {
        Write-Info "Falha simulada recebida (HTTP 400)" ([ConsoleColor]::Green)
        $falhaEsperada = $true
    }
    else {
        throw
    }
}

if (-not $falhaEsperada) {
    throw 'A API retornou sucesso, mas esperavamos falha simulada (HTTP 400).'
}

Start-Sleep -Seconds 2
$saldoDepois = (Invoke-Api -Method GET -Uri "$ApiEstoque/produtos/$($produto.id)").saldo
Write-Info "Saldo DEPOIS: $saldoDepois" ([ConsoleColor]::Yellow)

if ($saldoDepois -ne $saldoAntes) {
    throw "Rollback falhou: saldo final $saldoDepois, esperado $saldoAntes"
}

Write-Info 'ROLLBACK FUNCIONOU! O saldo permaneceu inalterado.' ([ConsoleColor]::Green)
