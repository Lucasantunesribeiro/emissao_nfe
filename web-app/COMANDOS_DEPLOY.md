# 🚀 Comandos Rápidos - Deploy Frontend

## 📦 Build Local (Validação)

```bash
# 1. Entrar no diretório
cd /mnt/d/Programacao/Emissao_NFE/web-app

# 2. Instalar dependências (primeira vez)
npm ci

# 3. Build de produção
npm run build:prod

# 4. Validar build
ls -lh dist/web-app/browser/
du -sh dist/web-app/browser/  # Deve ser < 1.5MB

# 5. Verificar environment produção
grep -r "production: true" dist/web-app/browser/*.js
```

**✅ Sucesso esperado:**
```
dist/web-app/browser/
├── index.html          (cache: 5min)
├── main-HASH.js        (cache: 1 ano)
├── polyfills-HASH.js   (cache: 1 ano)
├── styles-HASH.css     (cache: 1 ano)
└── assets/             (cache: 1 ano)
```

---

## 🌐 Deploy AWS S3 + CloudFront

### Opção A: Script Automatizado (Recomendado)

```bash
# 1. Configurar variáveis de ambiente
export S3_BUCKET="nfe-web-app-prod"
export CLOUDFRONT_DISTRIBUTION_ID="E1234567890ABC"

# 2. Executar deploy
./deploy-s3.sh
```

### Opção B: Comandos Manuais

```bash
# 1. Build
npm run build:prod

# 2. Sync S3 (assets com cache longo)
aws s3 sync dist/web-app/browser/ s3://nfe-web-app-prod/ \
  --delete \
  --exclude "index.html" \
  --cache-control "public,max-age=31536000,immutable"

# 3. Upload index.html (cache curto)
aws s3 cp dist/web-app/browser/index.html s3://nfe-web-app-prod/index.html \
  --cache-control "public,max-age=300,must-revalidate" \
  --content-type "text/html"

# 4. Invalidar CloudFront
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

---

## 🐳 Deploy Docker (Alternativo)

### Build e Push para ECR

```bash
# 1. Autenticar no ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin 123456789012.dkr.ecr.us-east-1.amazonaws.com

# 2. Build imagem
docker build -t nfe-web-app:latest .

# 3. Tag
docker tag nfe-web-app:latest \
  123456789012.dkr.ecr.us-east-1.amazonaws.com/nfe-web-app:latest

# 4. Push
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/nfe-web-app:latest
```

### Teste Local Docker

```bash
# 1. Build
docker build -t nfe-web-app:test .

# 2. Run
docker run -d -p 8080:80 --name nfe-test nfe-web-app:test

# 3. Testar
curl http://localhost:8080

# 4. Logs
docker logs nfe-test

# 5. Cleanup
docker stop nfe-test && docker rm nfe-test
```

---

## ✅ Validação Pós-Deploy

```bash
# 1. Verificar carregamento
curl -I https://nfe.sua-empresa.com.br

# 2. Verificar cache headers
curl -I https://nfe.sua-empresa.com.br/main.js | grep -i cache-control

# 3. Testar SPA routing
curl -s https://nfe.sua-empresa.com.br/notas/criar | grep -q "<app-root"

# 4. Testar API proxy (via CloudFront)
curl https://nfe.sua-empresa.com.br/api/v1/faturamento/health
curl https://nfe.sua-empresa.com.br/api/v1/estoque/health

# 5. Verificar compressão
curl -H "Accept-Encoding: gzip" -I https://nfe.sua-empresa.com.br/main.js | grep -i encoding
```

**✅ Respostas esperadas:**
- Status: `200 OK`
- Cache-Control (main.js): `public,max-age=31536000,immutable`
- Cache-Control (index.html): `public,max-age=300,must-revalidate`
- Content-Encoding: `gzip` ou `br`

---

## 🔄 Rollback (Emergência)

### S3 Versioning

```bash
# 1. Listar versões do index.html
aws s3api list-object-versions \
  --bucket nfe-web-app-prod \
  --prefix index.html

# 2. Restaurar versão anterior
aws s3api copy-object \
  --bucket nfe-web-app-prod \
  --copy-source "nfe-web-app-prod/index.html?versionId=VERSION_ID_ANTERIOR" \
  --key index.html

# 3. Invalidar cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

### Docker Rollback

```bash
# 1. Retornar para tag anterior
docker pull 123456789012.dkr.ecr.us-east-1.amazonaws.com/nfe-web-app:v1.0.0

# 2. Deploy da versão anterior
# (comandos específicos do seu orquestrador - ECS, K8s, etc)
```

---

## 📊 Análise de Bundle

```bash
# Gerar análise de bundle size
npm run analyze

# Abrirá navegador com visualização interativa
# Identifique módulos grandes e otimize se necessário
```

---

## 🐛 Troubleshooting Comum

### Erro: "ng: not found"
```bash
# Instalar dependências
npm ci

# Usar npx se necessário
npx ng build --configuration production
```

### Erro: "Budget exceeded"
```bash
# Analisar bundle
npm run analyze

# Ajustar budgets em angular.json (temporário)
# OU otimizar imports (permanente)
```

### APIs retornam 404 em produção
```bash
# Verificar CloudFront behaviors
aws cloudfront get-distribution-config \
  --id E1234567890ABC \
  --query 'DistributionConfig.CacheBehaviors'

# Testar direto no ALB (bypass CloudFront)
curl https://alb-interno.amazonaws.com/api/v1/faturamento/health
```

### Cache não atualiza
```bash
# Forçar invalidação completa
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"

# Verificar status
aws cloudfront get-invalidation \
  --id INVALIDATION_ID \
  --distribution-id E1234567890ABC
```

---

## 📚 Referências Rápidas

- **Documentação completa:** [DEPLOY.md](./DEPLOY.md)
- **Checklist validação:** [CHECKLIST.md](./CHECKLIST.md)
- **README principal:** [README.md](./README.md)
- **Angular docs:** https://angular.dev
- **AWS CLI S3:** https://docs.aws.amazon.com/cli/latest/reference/s3/
- **CloudFront:** https://docs.aws.amazon.com/cloudfront/
