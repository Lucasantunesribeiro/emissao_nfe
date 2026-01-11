# ✅ Checklist de Deploy - Frontend Angular

## 📋 Pré-Deploy

### Ambiente Local
- [ ] Node.js 22 instalado (`node --version`)
- [ ] Dependências instaladas (`npm ci`)
- [ ] Docker-compose funcionando (dev local)
- [ ] Testes de integração passando

### Build de Produção
```bash
cd /mnt/d/Programacao/Emissao_NFE/web-app
npm ci
npm run build:prod
```

- [ ] Build executado sem erros
- [ ] Arquivos gerados em `dist/web-app/browser/`
- [ ] Tamanho bundle < 1.5MB (verificar com `du -sh dist/web-app/browser/`)
- [ ] Source maps **não** incluídos (verificar ausência de `.map` files)
- [ ] Environment produção validado:
  ```bash
  grep -r "production: true" dist/web-app/browser/*.js
  ```

### Validação de Código
- [ ] Lint sem erros (`ng lint` se configurado)
- [ ] TypeScript compilado sem erros
- [ ] Interceptors registrados (`http-error.interceptor`, `loading.interceptor`)
- [ ] Loading component funcional

## 🚀 Deploy AWS

### Configuração S3
- [ ] Bucket criado: `nfe-web-app-prod`
- [ ] Versioning habilitado (recomendado)
- [ ] Política de bucket configurada (acesso apenas CloudFront)
- [ ] Lifecycle rules configuradas (opcional - deletar versões antigas)

### Configuração CloudFront
- [ ] Distribution criada
- [ ] Origin S3 configurado
- [ ] Origin ALB configurado para `/api/*`
- [ ] Behavior `/api/*` → ALB (HTTPS redirect)
- [ ] Behavior `/*` → S3 (default)
- [ ] Error pages configuradas:
  - [ ] 404 → /index.html (código 200)
  - [ ] 403 → /index.html (código 200)
- [ ] Certificado SSL/TLS configurado (ACM)
- [ ] Custom domain name (CNAME) configurado
- [ ] Compress objects habilitado

### Deploy Execution
```bash
# Configurar variáveis de ambiente
export S3_BUCKET="nfe-web-app-prod"
export CLOUDFRONT_DISTRIBUTION_ID="E1234567890ABC"

# Executar deploy
./deploy-s3.sh
```

- [ ] Upload S3 completo sem erros
- [ ] Cache headers corretos:
  - [ ] Assets (js/css/fonts): `max-age=31536000,immutable`
  - [ ] index.html: `max-age=300,must-revalidate`
- [ ] Invalidação CloudFront executada
- [ ] Invalidação concluída (status: `Completed`)

## 🧪 Validação Pós-Deploy

### Testes de Carregamento
```bash
# Carregamento principal
curl -I https://nfe.sua-empresa.com.br

# Verificar headers de cache
curl -I https://nfe.sua-empresa.com.br/main.js | grep -i cache-control

# Testar rota SPA (deve retornar HTML)
curl -s https://nfe.sua-empresa.com.br/notas/criar | grep -q "<app-root" && echo "✅ SPA routing OK"
```

- [ ] Status 200 para `/`
- [ ] HTTPS funcionando (certificado válido)
- [ ] Headers de cache corretos
- [ ] Gzip/Brotli compressão ativa
- [ ] Content-Type correto (HTML, JS, CSS)

### Testes de API (via CloudFront)
```bash
# Health check estoque
curl https://nfe.sua-empresa.com.br/api/v1/estoque/health

# Health check faturamento
curl https://nfe.sua-empresa.com.br/api/v1/faturamento/health
```

- [ ] APIs respondendo via CloudFront
- [ ] CORS configurado corretamente
- [ ] Headers de segurança presentes (se configurados no ALB)
- [ ] Latência aceitável (< 500ms para requests simples)

### Testes Funcionais
- [ ] Login funcional (se houver autenticação)
- [ ] Listagem de produtos carrega
- [ ] Criação de produto funciona
- [ ] Listagem de notas fiscais carrega
- [ ] Criação de nota fiscal funciona
- [ ] Impressão de nota funciona
- [ ] Loading overlay aparece durante requisições
- [ ] Mensagens de erro exibidas corretamente

### Performance
```bash
# Lighthouse audit (executar no navegador DevTools)
# Targets:
# - Performance: > 90
# - Accessibility: > 95
# - Best Practices: > 90
# - SEO: > 80
```

- [ ] First Contentful Paint < 1.5s
- [ ] Time to Interactive < 3s
- [ ] Largest Contentful Paint < 2.5s
- [ ] Cumulative Layout Shift < 0.1

### Segurança
- [ ] HTTPS obrigatório (HTTP redirect)
- [ ] Headers de segurança configurados:
  - [ ] `X-Content-Type-Options: nosniff`
  - [ ] `X-Frame-Options: DENY` (se não usar iframes)
  - [ ] `Strict-Transport-Security` (HSTS)
  - [ ] `Content-Security-Policy` (recomendado)
- [ ] Sem credenciais hardcoded (verificar código-fonte navegador)
- [ ] Ambiente de produção detectado (`production: true`)

## 📊 Monitoramento Pós-Deploy

### CloudWatch (AWS)
- [ ] Métricas CloudFront habilitadas
- [ ] Alarmes configurados:
  - [ ] 4xx/5xx error rate > 5%
  - [ ] Origin latency > 1s
- [ ] Logs de acesso S3 habilitados (opcional)
- [ ] CloudFront logs habilitados (opcional)

### Application Monitoring
- [ ] Sentry/Rollbar configurado (erro tracking)
- [ ] Google Analytics / Amplitude (analytics)
- [ ] RUM (Real User Monitoring) habilitado

## 🔄 Rollback Plan

Em caso de problemas:

### Rollback S3 (se versioning habilitado)
```bash
# Listar versões
aws s3api list-object-versions --bucket nfe-web-app-prod --prefix index.html

# Restaurar versão anterior
aws s3api copy-object \
  --bucket nfe-web-app-prod \
  --copy-source nfe-web-app-prod/index.html?versionId=PREVIOUS_VERSION_ID \
  --key index.html

# Invalidar cache
aws cloudfront create-invalidation \
  --distribution-id E1234567890ABC \
  --paths "/*"
```

### Rollback CloudFront
- [ ] Distribution anterior salva (export JSON)
- [ ] Procedure de rollback documentada

## 📝 Documentação

- [ ] README atualizado com URLs de produção
- [ ] Variáveis de ambiente documentadas
- [ ] Runbook de troubleshooting criado
- [ ] Contatos de escalação definidos

## ✅ Sign-Off

- [ ] Tech Lead aprovação: _______________
- [ ] QA validação: _______________
- [ ] DevOps review: _______________
- [ ] Stakeholder sign-off: _______________

**Data do deploy:** _______________
**Versão:** _______________
**Deployed by:** _______________
