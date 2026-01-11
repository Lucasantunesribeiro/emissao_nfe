# 🚀 Frontend Angular - Sistema de Emissão de NFe

Sistema web para gerenciamento de produtos e emissão de notas fiscais eletrônicas integrado com backend Go (Faturamento) e .NET (Estoque).

## 📦 Stack Tecnológica

- **Angular:** 17.3
- **TypeScript:** 5.4
- **Tailwind CSS:** 3.4
- **RxJS:** 7.8
- **Standalone Components:** Sim (sem modules)
- **Signals:** Sim (Angular 17+)

## 🏗️ Arquitetura

```
src/
├── app/
│   ├── core/
│   │   ├── interceptors/         # HTTP interceptors (error, loading)
│   │   ├── models/               # TypeScript interfaces
│   │   └── services/             # Services (produtos, notas, idempotência)
│   ├── features/
│   │   ├── produtos/             # Feature de produtos
│   │   └── notas/                # Feature de notas fiscais
│   ├── shared/
│   │   └── components/loading/   # Componentes reutilizáveis
│   ├── app.component.ts          # Root component
│   ├── app.config.ts             # App config (providers)
│   └── app.routes.ts             # Rotas
└── environments/
    ├── environment.ts            # Dev (docker-compose)
    └── environment.prod.ts       # Produção (AWS)
```

## 🛠️ Desenvolvimento Local

### Pré-requisitos
- Node.js 22+
- Docker + Docker Compose (para backend)

### Instalação
```bash
# Instalar dependências
npm ci

# Iniciar ambiente completo (backend + frontend)
docker-compose up -d

# OU apenas frontend (se backend já estiver rodando)
npm start
```

**URLs Locais:**
- Frontend: http://localhost:4200
- API Estoque (.NET): http://localhost:5001
- API Faturamento (Go): http://localhost:5002

### Scripts Disponíveis

```bash
npm start              # Dev server (porta 4200)
npm run build          # Build dev
npm run build:prod     # Build produção (otimizado)
npm run watch          # Build contínuo (dev)
npm run analyze        # Análise de bundle size
```

## 🚀 Deploy em Produção

### Opção 1: AWS S3 + CloudFront (Recomendado)

```bash
# Configurar variáveis de ambiente
export S3_BUCKET="nfe-web-app-prod"
export CLOUDFRONT_DISTRIBUTION_ID="E1234567890ABC"

# Deploy automatizado
./deploy-s3.sh
```

**Veja:** [DEPLOY.md](./DEPLOY.md) para instruções detalhadas

### Opção 2: Docker + nginx

```bash
# Build imagem
docker build -t nfe-web-app:latest .

# Executar
docker run -d -p 80:80 nfe-web-app:latest
```

## 🧪 Validação

Antes de fazer deploy, execute o checklist:

```bash
# Build de produção
npm run build:prod

# Validar environment
grep -r "production: true" dist/web-app/browser/*.js

# Validar tamanho (deve ser < 1.5MB)
du -sh dist/web-app/browser/
```

**Veja:** [CHECKLIST.md](./CHECKLIST.md) para validação completa

## 🔧 Configuração de Ambiente

### Desenvolvimento (`environment.ts`)
```typescript
export const environment = {
  production: false,
  apiEstoqueUrl: '/api/estoque',      // Proxy para localhost:5001
  apiFaturamentoUrl: '/api/faturamento' // Proxy para localhost:5002
};
```

### Produção (`environment.prod.ts`)
```typescript
export const environment = {
  production: true,
  apiEstoqueUrl: '/api/v1/estoque',      // CloudFront → ALB
  apiFaturamentoUrl: '/api/v1/faturamento' // CloudFront → ALB
};
```

## 📡 Integração com APIs

### Serviços Disponíveis

- **ProdutoService:** CRUD de produtos (API Estoque .NET)
- **NotaFiscalService:** Gestão de NFe (API Faturamento Go)
- **IdempotenciaService:** Geração de chaves de idempotência

### Interceptors

- **LoadingInterceptor:** Loading overlay global automático
- **HttpErrorInterceptor:** Tratamento de erros HTTP com mensagens amigáveis

### Exemplo de Uso
```typescript
import { inject } from '@angular/core';
import { NotaFiscalService } from '@core/services/nota-fiscal.service';

export class MinhaFeature {
  private notaService = inject(NotaFiscalService);

  listarNotas() {
    // Loading automático via interceptor
    this.notaService.listarNotas('PENDENTE').subscribe({
      next: (notas) => console.log(notas),
      error: (err) => {
        // Erro já tratado pelo interceptor
        // Mensagem amigável exibida automaticamente
      }
    });
  }
}
```

## 🎨 Estilização

### Tailwind CSS
Configuração em `tailwind.config.js`. Classes utilitárias disponíveis:

```html
<!-- Exemplo de componente -->
<div class="flex items-center gap-4 p-6 bg-white rounded-lg shadow-md">
  <button class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">
    Ação
  </button>
</div>
```

### Responsividade
Mobile-first com breakpoints:
- `sm:` 640px
- `md:` 768px
- `lg:` 1024px
- `xl:` 1280px

## 🔒 Segurança

- **HTTPS:** Obrigatório em produção (CloudFront)
- **CORS:** Configurado no backend (ALB)
- **Environment Isolation:** Produção isolada de desenvolvimento
- **No Secrets:** Sem credenciais hardcoded

## 📊 Performance

### Budgets (angular.json)
- Initial bundle: < 1.5MB (warning), < 2MB (error)
- Component styles: < 4KB (warning), < 8KB (error)

### Otimizações Aplicadas
- ✅ AOT Compilation
- ✅ Build Optimizer
- ✅ Tree Shaking
- ✅ Code Splitting
- ✅ Minification
- ✅ Gzip/Brotli (nginx/CloudFront)

### Targets
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Lighthouse Performance: > 90

## 🐛 Troubleshooting

### Build falha com erro de budget
```bash
# Analisar bundle
npm run analyze

# Ajustar budgets em angular.json se necessário
```

### APIs retornam 404 em produção
- Verificar behavior `/api/*` no CloudFront
- Confirmar origin ALB configurado
- Testar diretamente no ALB (bypass CloudFront)

### Loading não aparece
- Verificar `LoadingComponent` importado no `app.component.ts`
- Verificar interceptors registrados no `app.config.ts`

### Environment errado em build
```bash
# Validar replacement no angular.json
grep -A 5 "fileReplacements" angular.json

# Confirmar build:prod usa configuration production
npm run build:prod -- --verbose
```

## 📚 Documentação Adicional

- [DEPLOY.md](./DEPLOY.md) - Guia completo de deploy AWS
- [CHECKLIST.md](./CHECKLIST.md) - Checklist de validação pré-deploy
- [proxy.conf.json](./proxy.conf.json) - Configuração de proxy dev
- [nginx.conf](./nginx.conf) - Configuração nginx (Docker)

## 🤝 Contribuição

1. Feature/bugfix em branch separado
2. Build local sem erros
3. Testar integração com backend
4. Pull request com descrição clara

## 📞 Suporte

- **Tech Lead:** [Seu Nome]
- **DevOps:** [Nome DevOps]
- **Slack:** #nfe-sistema

## 📄 Licença

Propriedade de Viasoft Korp - Uso interno apenas
