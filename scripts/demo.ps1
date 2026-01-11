Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ApiEstoque      = 'http://localhost:5001/api/v1'
$ApiFaturamento  = 'http://localhost:5002/api/v1'
$SpinnerFrames   = '|/-\\'

function Write-Section {
    param([string]$Title, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
    Write-Host "`n=== $Title ===" -ForegroundColor $Color
}

function Write-Step {
    param([string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Gray)
    Write-Host "  • $Message" -ForegroundColor $Color
}

function Invoke-Api {
    param(
        [Parameter(Mandatory)] [ValidateSet('GET','POST','PUT','DELETE')] [string]$Method,
        [Parameter(Mandatory)] [string]$Uri,
        [hashtable]$Headers,
        [object]$Body
    )

    $params = @{ Method = $Method; Uri = $Uri; ContentType = 'application/json'; ErrorAction = 'Stop' }
    if ($Headers) { $params.Headers = $Headers }
    if ($Body)    { $params.Body    = ($Body | ConvertTo-Json -Depth 6) }

    try {
        return Invoke-RestMethod @params
    }
    catch {
        $message = $_.Exception.Message
        $response = $_.Exception.Response
        if ($response -and $response.GetResponseStream()) {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $reader.BaseStream.Position = 0
            $reader.DiscardBufferedData()
            $body = $reader.ReadToEnd()
            if ($body) {
                $message = "$message | $body"
            }
        }
        throw [System.Exception]::new("Falha ao chamar $Method $Uri : $message", $_.Exception)
    }
}

function Wait-Poll {
    param(
        [Parameter(Mandatory)] [scriptblock]$Operation,
        [int]$TimeoutSeconds = 30,
        [int]$IntervalSeconds = 1,
        [string]$WaitingMessage = 'Aguardando...'
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $frameIndex = 0
    Write-Host "  $WaitingMessage " -NoNewline

    while ((Get-Date) -lt $deadline) {
        try {
            $result = & $Operation
            if ($result) {
                Write-Host ""
                return $result
            }
        }
        catch {
            Write-Host ""
            throw
        }

        $frame = $SpinnerFrames[$frameIndex % $SpinnerFrames.Length]
        Write-Host "`b$frame" -NoNewline
        $frameIndex++
        Start-Sleep -Seconds $IntervalSeconds
    }

    Write-Host ""
    throw "Timeout apos $TimeoutSeconds segundos."
}

function Ensure-Produto {
    param([string]$SkuBase, [string]$Nome, [int]$Saldo)

    $sufixo = Get-Date -Format 'HHmmssfff'
    $skuFinal = "$SkuBase-$sufixo"
    return Invoke-Api -Method POST -Uri "$ApiEstoque/produtos" -Body @{ sku = $skuFinal; nome = $Nome; saldo = $Saldo }
}

function Ensure-Nota {
    param([string]$NumeroBase)

    $sufixo = Get-Date -Format 'HHmmssfff'
    $numeroFinal = "$NumeroBase-$sufixo"
    return Invoke-Api -Method POST -Uri "$ApiFaturamento/notas" -Body @{ numero = $numeroFinal }
}

function Adicionar-ItemNota {
    param([Guid]$NotaId, [Guid]$ProdutoId, [int]$Quantidade, [double]$Preco)
    Invoke-Api -Method POST -Uri "$ApiFaturamento/notas/$NotaId/itens" -Body @{ produtoId = $ProdutoId; quantidade = $Quantidade; precoUnitario = $Preco } | Out-Null
}

function Solicitar-Impressao {
    param([Guid]$NotaId)
    $chave = [guid]::NewGuid().ToString()
    return Invoke-Api -Method POST -Uri "$ApiFaturamento/notas/$NotaId/imprimir" -Headers @{ 'Idempotency-Key' = $chave }
}

function Obter-Solicitacao {
    param([Guid]$Id)
    return Invoke-Api -Method GET -Uri "$ApiFaturamento/solicitacoes-impressao/$Id"
}

function Validar-Saldo {
    param([Guid]$ProdutoId, [int]$SaldoEsperado)
    $produto = Invoke-Api -Method GET -Uri "$ApiEstoque/produtos/$ProdutoId"
    if ($produto.saldo -ne $SaldoEsperado) {
        throw "Saldo inesperado para produto $($produto.sku): encontrado $($produto.saldo), esperado $SaldoEsperado"
    }
    Write-Step "Saldo confirmado: $SaldoEsperado" ([ConsoleColor]::Green)
}

Write-Section 'Demo Sistema NFe - Viasoft Korp' ([ConsoleColor]::Cyan)

Write-Section 'Verificando servicos'
Write-Step 'Health Estoque' ([ConsoleColor]::Gray)
Invoke-Api -Method GET -Uri "$ApiEstoque/health" | Out-Null
Write-Step 'Health Faturamento' ([ConsoleColor]::Gray)
Invoke-Api -Method GET -Uri "$ApiFaturamento/health" | Out-Null

try {
    # Cenario 1: Fluxo feliz
    Write-Section 'Cenario 1 - Fluxo Normal (reserva + impressao)' ([ConsoleColor]::Green)
    $prod1 = Ensure-Produto -Sku 'DEMO-001' -Nome 'Produto Demo' -Saldo 100
    $nota1 = Ensure-Nota -Numero 'NFE-001'
    Write-Step "Produto $($prod1.sku) criado (saldo 100)" ([ConsoleColor]::Green)
    Write-Step "Nota fiscal $($nota1.numero) criada" ([ConsoleColor]::Green)

    Adicionar-ItemNota -NotaId $nota1.id -ProdutoId $prod1.id -Quantidade 30 -Preco 15.5
    Write-Step 'Item adicionado (quantidade 30)' ([ConsoleColor]::Gray)

    $sol1 = Solicitar-Impressao -NotaId $nota1.id
    Write-Step "Solicitacao enviada (ID: $($sol1.id))" ([ConsoleColor]::Cyan)

    $resultado1 = Wait-Poll -WaitingMessage 'Processando impressao' -Operation {
        $status = Obter-Solicitacao -Id $sol1.id
        if ($status.status -eq 'CONCLUIDA' -or $status.status -eq 'FALHOU') { return $status }
        return $null
    }

    if ($resultado1.status -ne 'CONCLUIDA') {
        throw "Impressao nao concluiu: status $($resultado1.status)"
    }
    Write-Step 'Nota impressa com sucesso' ([ConsoleColor]::Green)
    Validar-Saldo -ProdutoId $prod1.id -SaldoEsperado 70

    # Cenario 2: Saldo insuficiente
    Write-Section 'Cenario 2 - Saldo insuficiente' ([ConsoleColor]::Yellow)
    $prod2 = Ensure-Produto -Sku 'DEMO-002' -Nome 'Produto Limitado' -Saldo 10
    $nota2 = Ensure-Nota -Numero 'NFE-002'
    Adicionar-ItemNota -NotaId $nota2.id -ProdutoId $prod2.id -Quantidade 50 -Preco 25
    $sol2 = Solicitar-Impressao -NotaId $nota2.id
    $resultado2 = Wait-Poll -WaitingMessage 'Aguardando rejeicao' -Operation {
        $status = Obter-Solicitacao -Id $sol2.id
        if ($status.status -ne 'PENDENTE') { return $status }
        return $null
    }

    if ($resultado2.status -ne 'FALHOU') {
        throw "Esperava falha por saldo insuficiente, recebeu $($resultado2.status)"
    }
    Write-Step "Rejeicao confirmada: $($resultado2.mensagemErro)" ([ConsoleColor]::Green)
    Validar-Saldo -ProdutoId $prod2.id -SaldoEsperado 10

    # Cenario 3: Idempotencia
    Write-Section 'Cenario 3 - Idempotencia' ([ConsoleColor]::Magenta)
    $prod3 = Ensure-Produto -Sku 'DEMO-003' -Nome 'Produto Idempotencia' -Saldo 40
    $nota3 = Ensure-Nota -Numero 'NFE-003'
    Adicionar-ItemNota -NotaId $nota3.id -ProdutoId $prod3.id -Quantidade 20 -Preco 10

    $chave = [guid]::NewGuid().ToString()
    $resp1 = Invoke-Api -Method POST -Uri "$ApiFaturamento/notas/$($nota3.id)/imprimir" -Headers @{ 'Idempotency-Key' = $chave }
    Start-Sleep -Milliseconds 500
    $resp2 = Invoke-Api -Method POST -Uri "$ApiFaturamento/notas/$($nota3.id)/imprimir" -Headers @{ 'Idempotency-Key' = $chave }

    if ($resp1.id -ne $resp2.id) {
        throw "Idempotencia violada: IDs diferentes ($($resp1.id) vs $($resp2.id))"
    }
    Write-Step "Mesmo ID retornado para requisicoes duplicadas: $($resp1.id)" ([ConsoleColor]::Green)

    # Cenario 4: Rollback manual (X-Demo-Fail)
    Write-Section 'Cenario 4 - Rollback com X-Demo-Fail' ([ConsoleColor]::Red)
    $prod4 = Ensure-Produto -Sku 'DEMO-004' -Nome 'Produto Rollback' -Saldo 50
    $nota4 = Ensure-Nota -Numero 'NFE-004'
    Write-Step "Produto rollback: $($prod4.sku) ($($prod4.id))" ([ConsoleColor]::Gray)
    Write-Step "Nota rollback: $($nota4.numero) ($($nota4.id))" ([ConsoleColor]::Gray)

    $bodyRollback = @{ notaId = $nota4.id; produtoId = $prod4.id; quantidade = 20 }
    try {
        Invoke-Api -Method POST -Uri "$ApiEstoque/reservas" -Headers @{ 'X-Demo-Fail' = 'true' } -Body $bodyRollback | Out-Null
        throw 'Reserva com X-Demo-Fail nao deveria retornar sucesso.'
    }
    catch {
        if (-not $_.Exception.Message.Contains('Falha simulada')) {
            throw
        }
        Write-Step 'Falha simulada detectada conforme esperado' ([ConsoleColor]::Green)
    }

    Start-Sleep -Seconds 2
    Validar-Saldo -ProdutoId $prod4.id -SaldoEsperado 50

    Write-Section 'Resumo' ([ConsoleColor]::Cyan)
    Write-Step 'Fluxo feliz: sucesso com baixa de estoque' ([ConsoleColor]::Green)
    Write-Step 'Saldo insuficiente: rejeicao protegida' ([ConsoleColor]::Green)
    Write-Step 'Idempotencia: chave repetida retorna mesma solicitacao' ([ConsoleColor]::Green)
    Write-Step 'Rollback: X-Demo-Fail preserva saldo' ([ConsoleColor]::Green)

    Write-Host "`nDemo concluida com sucesso" -ForegroundColor Green
}
catch {
    Write-Host "`nERRO: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
