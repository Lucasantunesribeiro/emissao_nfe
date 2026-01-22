# Deploy Frontend Angular - AWS S3 + CloudFront

## 📋 Pré-requisitos

- AWS CLI configurado (`aws configure`)
- Permissões S3 + CloudFront
- Bucket S3 criado (ex: `nfe-web-app-prod`)
- CloudFront distribution configurada

## 🏗️ Build de Produção

### 1. Build Local

```bash
cd /mnt/d/Programacao/Emissao_NFE/web-app
npm run build:prod
```

**Saída esperada:** `dist/web-app/browser/` com arquivos otimizados

### 2. Validar Build

```bash
# Verificar tamanho dos arquivos
du -sh dist/web-app/browser/

# Verificar se environment.prod.ts foi usado
grep -r "production: true" dist/web-app/browser/*.js && echo "✅ Build de produção OK"
```

## 🚀 Deploy S3 + CloudFront

### Opção 1: Deploy Manual

```bash
# Sincronizar arquivos para S3
aws s3 sync dist/web-app/browser/ s3://nfe-web-app-prod/ \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

# index.html com cache curto (5 minutos)
aws s3 cp dist/web-app/browser/index.html s3://nfe-web-app-prod/index.html \
  --cache-control "public,max-age=300,must-revalidate" \
  --content-type "text/html"

# Invalidar cache CloudFront
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

### Opção 2: Script Automatizado

```bash
#!/bin/bash
# deploy-s3.sh

BUCKET="nfe-web-app-prod"
DISTRIBUTION_ID="E1234567890ABC"

echo "🏗️  Building for production..."
npm run build:prod

echo "📦 Uploading to S3..."
aws s3 sync dist/web-app/browser/ s3://$BUCKET/ \
  --delete \
  --cache-control "public,max-age=31536000,immutable" \
  --exclude "index.html"

aws s3 cp dist/web-app/browser/index.html s3://$BUCKET/index.html \
  --cache-control "public,max-age=300,must-revalidate" \
  --content-type "text/html"

echo "🔄 Invalidating CloudFront cache..."
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"

echo "✅ Deploy completed!"
```

**Uso:**
```bash
chmod +x deploy-s3.sh
./deploy-s3.sh
```

## 🐳 Deploy Docker (Alternativo)

Se preferir hospedar com nginx ao invés de S3:

```bash
# Build imagem
docker build -t nfe-web-app:latest .

# Testar localmente
docker run -p 8080:80 nfe-web-app:latest

# Push para ECR/Registry
docker tag nfe-web-app:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/nfe-web-app:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/nfe-web-app:latest
```

## ⚙️ Configuração CloudFront

### Behavior para /api/*

```json
{
  "PathPattern": "/api/*",
  "TargetOriginId": "ALB-NFE",
  "ViewerProtocolPolicy": "redirect-to-https",
  "AllowedMethods": ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
  "CachedMethods": ["GET", "HEAD", "OPTIONS"],
  "CachePolicyId": "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
  "OriginRequestPolicyId": "216adef6-5c7f-47e4-b989-5492eafa07d3"
}
```

### Origin ALB

```json
{
  "DomainName": "alb-nfe-123456.us-east-1.elb.amazonaws.com",
  "OriginPath": "",
  "CustomHeaders": {
    "X-Forwarded-Host": "nfe.sua-empresa.com.br"
  }
}
```

### Error Pages (SPA Routing)

Configurar custom error response para 404 → 200 (index.html):

```json
{
  "ErrorCode": 404,
  "ResponsePagePath": "/index.html",
  "ResponseCode": "200",
  "ErrorCachingMinTTL": 300
}
```

## 🔒 Configuração S3 Bucket

```bash
# Criar bucket
aws s3 mb s3://nfe-web-app-prod

# Habilitar website hosting (se não usar CloudFront)
aws s3 website s3://nfe-web-app-prod \
  --index-document index.html \
  --error-document index.html

# Política de bucket (privado, apenas CloudFront)
cat > bucket-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::nfe-web-app-prod/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E1234567890ABC"
        }
      }
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket nfe-web-app-prod \
  --policy file://bucket-policy.json
```

## 🧪 Validação Pós-Deploy

```bash
# Testar carregamento
curl -I https://nfe.sua-empresa.com.br

# Verificar headers de cache
curl -I https://nfe.sua-empresa.com.br/main.js | grep -i cache-control

# Testar rota SPA (deve retornar index.html)
curl https://nfe.sua-empresa.com.br/notas/criar

# Testar API proxy
curl https://nfe.sua-empresa.com.br/api/v1/faturamento/health
```

## 📊 Performance Targets

- **First Paint:** < 1.5s
- **TTI (Time to Interactive):** < 3s
- **Bundle size:** < 1.5MB (gzipped)
- **Lighthouse Score:** > 90

## 🔧 Troubleshooting

### Build falha com erro de budget

```bash
# Aumentar budgets no angular.json ou analisar bundle
npm run analyze
```

### APIs retornam 404 em produção

- Verificar behavior `/api/*` no CloudFront
- Confirmar origin ALB configurado
- Checar CORS no backend

### Rota SPA retorna 404

- Configurar error page 404 → 200 no CloudFront
- Verificar `try_files` no nginx (se usar Docker)

### Cache não atualiza após deploy

```bash
# Forçar invalidação completa
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

## 📝 Checklist de Deploy

- [ ] Build local executado com sucesso
- [ ] Arquivos em `dist/web-app/browser/`
- [ ] Environment de produção validado
- [ ] S3 sync completo (sem erros)
- [ ] CloudFront invalidation executada
- [ ] Teste de carregamento OK (curl/browser)
- [ ] Teste de rotas SPA funcionando
- [ ] APIs respondendo via CloudFront
- [ ] Headers de cache corretos
- [ ] HTTPS funcionando com certificado válido
