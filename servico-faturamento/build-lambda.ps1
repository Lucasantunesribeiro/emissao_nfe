$ErrorActionPreference = "Stop"
Set-Location "D:\Programacao\Emissao_NFE\servico-faturamento"

Write-Host "Building Lambda Faturamento with Docker..."

docker run --rm `
  -v "${PWD}:/app" `
  -w /app `
  golang:1.24-alpine `
  sh -c "apk add --no-cache git && GOOS=linux GOARCH=arm64 go build -tags lambda.norpc -o build/bootstrap-new cmd/lambda/main.go"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build successful!"
    Move-Item -Path "build/bootstrap-new" -Destination "build/bootstrap" -Force
    Write-Host "Bootstrap updated!"
} else {
    Write-Host "Build failed with exit code $LASTEXITCODE"
    exit 1
}
