#!/bin/bash

set -e

echo "🔨 Building Lambda Functions for NFe System"
echo "==========================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Directories
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FATURAMENTO_DIR="$PROJECT_ROOT/servico-faturamento"
ESTOQUE_DIR="$PROJECT_ROOT/servico-estoque"

echo -e "${YELLOW}Project Root: $PROJECT_ROOT${NC}\n"

# ========================================
# 1. Build Lambda Faturamento (Go ARM64)
# ========================================

echo -e "${GREEN}[1/3] Building Faturamento Lambda (Go)...${NC}"

cd "$FATURAMENTO_DIR"

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: Go is not installed${NC}"
    exit 1
fi

# Create build directory
mkdir -p build
mkdir -p build-outbox

# Build main API handler
echo "  → Building main handler (bootstrap)..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build \
    -tags lambda.norpc \
    -ldflags="-s -w" \
    -o build/bootstrap \
    cmd/lambda/main.go

if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✓ Main handler built successfully${NC}"
    ls -lh build/bootstrap
else
    echo -e "  ${RED}✗ Failed to build main handler${NC}"
    exit 1
fi

# Build outbox processor handler
echo "  → Building outbox processor handler..."
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build \
    -tags lambda.norpc \
    -ldflags="-s -w" \
    -o build-outbox/bootstrap \
    cmd/lambda-outbox/main.go

if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✓ Outbox handler built successfully${NC}"
    ls -lh build-outbox/bootstrap
else
    echo -e "  ${RED}✗ Failed to build outbox handler${NC}"
    exit 1
fi

# ========================================
# 2. Build Lambda Estoque (.NET 9 ARM64)
# ========================================

echo -e "\n${GREEN}[2/3] Building Estoque Lambda (.NET)...${NC}"

cd "$ESTOQUE_DIR"

# Check if .NET is installed
if ! command -v dotnet &> /dev/null; then
    echo -e "${RED}Error: .NET SDK is not installed${NC}"
    exit 1
fi

# Clean previous builds
echo "  → Cleaning previous builds..."
dotnet clean -c Release > /dev/null

# Publish for Lambda (ARM64)
echo "  → Publishing for AWS Lambda (ARM64)..."
dotnet publish \
    -c Release \
    -r linux-arm64 \
    --self-contained true \
    -p:PublishReadyToRun=true \
    -p:PublishSingleFile=false \
    -p:PublishTrimmed=false \
    -o publish

if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✓ Estoque Lambda built successfully${NC}"
    ls -lh publish/ServicoEstoque.dll
else
    echo -e "  ${RED}✗ Failed to build Estoque Lambda${NC}"
    exit 1
fi

# ========================================
# 3. Verify Builds
# ========================================

echo -e "\n${GREEN}[3/3] Verifying builds...${NC}"

# Faturamento checks
if [ ! -f "$FATURAMENTO_DIR/build/bootstrap" ]; then
    echo -e "${RED}✗ Faturamento main handler not found${NC}"
    exit 1
fi

if [ ! -f "$FATURAMENTO_DIR/build-outbox/bootstrap" ]; then
    echo -e "${RED}✗ Faturamento outbox handler not found${NC}"
    exit 1
fi

# Estoque checks
if [ ! -f "$ESTOQUE_DIR/publish/ServicoEstoque.dll" ]; then
    echo -e "${RED}✗ Estoque Lambda not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All Lambda functions built successfully!${NC}\n"

# ========================================
# 4. Size Report
# ========================================

echo "📦 Build Size Report:"
echo "-------------------"
echo "Faturamento (main):   $(du -h "$FATURAMENTO_DIR/build/bootstrap" | cut -f1)"
echo "Faturamento (outbox): $(du -h "$FATURAMENTO_DIR/build-outbox/bootstrap" | cut -f1)"
echo "Estoque (total):      $(du -sh "$ESTOQUE_DIR/publish" | cut -f1)"

echo -e "\n${GREEN}✅ Lambda builds ready for deployment!${NC}"
echo -e "${YELLOW}Next: Run 'npm run deploy:serverless:dev' from infra/cdk${NC}"
