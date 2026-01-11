Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$ApiEstoque = 'http://localhost:5001/api/v1'

function Write-Info {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray)
    Write-Host $Message -ForegroundColor $Color
}

function Invoke-RawRequest {
    param(
        [string]$Uri,
        [object]$Body
    )

    $params = @{
        Method             = 'POST'
        Uri                = $Uri
        Body               = ($Body | ConvertTo-Json -Depth 4)
        ContentType        = 'application/json'
        SkipHttpErrorCheck = $true
        ErrorAction        = 'Stop'
    }

    $response = Invoke-WebRequest @params

    $parsed = $null
    if ($response.Content) {
        try { $parsed = $response.Content | ConvertFrom-Json }
        catch { $parsed = $response.Content }
    }

    [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Content    = $parsed
    }
}

Write-Info '=== Teste de Concorrencia - Reservas simultaneas ===' ([ConsoleColor]::Cyan)

$sku = "CONC-$(Get-Date -Format 'HHmmss')"
$produto = Invoke-WebRequest -Method POST -Uri "$ApiEstoque/produtos" -ContentType 'application/json' -Body (@{
        sku   = $sku
        nome  = 'Produto Concurrency'
        saldo = 5
    } | ConvertTo-Json -Depth 3)
$produtoJson = $produto.Content | ConvertFrom-Json
Write-Info "Produto criado: $($produtoJson.sku) | Saldo inicial: $($produtoJson.saldo)" ([ConsoleColor]::Green)

$notaId = [guid]::NewGuid()
$body   = @{ notaId = $notaId; produtoId = $produtoJson.id; quantidade = 3 }

Write-Info 'Disparando duas reservas simultaneas (quantidade 3 cada)...' ([ConsoleColor]::Gray)

$payloadJson = $body | ConvertTo-Json -Depth 4
$uriReservas = "$ApiEstoque/reservas"
$httpClient  = [System.Net.Http.HttpClient]::new()

try {
    $tasks = @(
        $httpClient.PostAsync($uriReservas, (New-Object System.Net.Http.StringContent($payloadJson, [System.Text.Encoding]::UTF8, 'application/json'))),
        $httpClient.PostAsync($uriReservas, (New-Object System.Net.Http.StringContent($payloadJson, [System.Text.Encoding]::UTF8, 'application/json')))
    )

    [System.Threading.Tasks.Task]::WaitAll([System.Threading.Tasks.Task[]]$tasks)

    $responses = $tasks | ForEach-Object { $_.Result }
    $results = foreach ($response in $responses) {
        $contentString = $response.Content.ReadAsStringAsync().Result
        $parsed = $null
        if ($contentString) {
            try { $parsed = $contentString | ConvertFrom-Json }
            catch { $parsed = $contentString }
        }

        [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content    = $parsed
        }
    }
    $responses | ForEach-Object { $_.Dispose() }
}
finally {
    $httpClient.Dispose()
}

foreach ($result in $results) {
    $status = if ($result.StatusCode -ge 200 -and $result.StatusCode -lt 300) { 'SUCESSO' } else { 'FALHA' }
    $color  = if ($status -eq 'SUCESSO') { [ConsoleColor]::Green } else { [ConsoleColor]::Red }
    Write-Info ("  -> {0} | HTTP {1}" -f $status, $result.StatusCode) $color
}

$sucessos = @($results | Where-Object { $_.StatusCode -ge 200 -and $_.StatusCode -lt 300 })
$falhas   = @($results | Where-Object { $_.StatusCode -ge 400 })

if ($sucessos.Count -ne 1 -or $falhas.Count -ne 1) {
    throw "Esperava exatamente 1 sucesso e 1 falha. Obtidos: $($sucessos.Count) sucesso(s) / $($falhas.Count) falha(s)."
}

$produtoFinal = Invoke-RestMethod -Method GET -Uri "$ApiEstoque/produtos/$($produtoJson.id)"
Write-Info "Saldo final do produto: $($produtoFinal.saldo)" ([ConsoleColor]::Yellow)

if ($produtoFinal.saldo -ne 2) {
    throw "Saldo final inesperado. Esperado 2, obtido $($produtoFinal.saldo)."
}

Write-Info 'Concorrencia OK: uma reserva foi efetivada e a outra rejeitada.' ([ConsoleColor]::Green)
