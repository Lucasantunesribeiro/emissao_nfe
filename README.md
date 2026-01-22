# Sistema de Emissão de Nota Fiscal Eletrônica (NFE)

Sistema distribuído serverless para emissão de notas fiscais eletrônicas, desenvolvido com arquitetura orientada a eventos e tecnologias modernas.

## 🏗️ Arquitetura

**Arquitetura Serverless Event-Driven**
- **Backend**: AWS Lambda (Go + .NET 9)
- **Mensageria**: AWS EventBridge + SQS
- **Banco de Dados**: AWS RDS PostgreSQL (Free Tier)
- **Frontend**: Angular 18 + TailwindCSS (hospedado em S3 + CloudFront)
- **Infraestrutura como Código**: AWS CDK (TypeScript)

## 🚀 Tecnologias

### Backend
- **Serviço Estoque**: .NET 9 + ASP.NET Core Minimal APIs + Entity Framework Core
- **Serviço Faturamento**: Go 1.23 + Gin + GORM
- **Lambda PDF Generator**: Go + gofpdf

### Frontend
- **Angular 18** (Standalone Components)
- **TailwindCSS** para estilização
- **RxJS** para programação reativa

### Infraestrutura
- **AWS Lambda** (runtime: provided.al2023 para Go, dotnet9 para .NET)
- **AWS API Gateway** (REST APIs)
- **AWS RDS PostgreSQL** (t4g.micro - Free Tier)
- **AWS EventBridge** (event bus customizado)
- **AWS SQS** (filas de mensagens + DLQ)
- **AWS S3 + CloudFront** (hospedagem frontend + PDFs)
- **AWS Secrets Manager** (credenciais do banco)
- **AWS CDK** (deploy automatizado)

## 📦 Estrutura do Projeto

```
emissao_nfe/
├── servico-estoque/          # Microserviço de Estoque (.NET 9)
│   ├── Api/                   # Controllers e configuração
│   ├── Aplicacao/            # Casos de uso (CQRS)
│   ├── Dominio/              # Entidades e regras de negócio
│   └── Infraestrutura/       # Persistência e mensageria
├── servico-faturamento/      # Microserviço de Faturamento (Go)
│   ├── cmd/
│   │   ├── api/              # API HTTP (Gin)
│   │   ├── lambda/           # Lambda Function handler
│   │   └── lambda-pdf/       # PDF Generator Lambda
│   └── internal/
│       ├── dominio/          # Entidades
│       ├── config/           # Configuração do banco
│       ├── manipulador/      # Handlers HTTP
│       └── publicador/       # EventBridge publisher
├── web-app/                  # Frontend Angular 18
│   ├── src/app/
│   │   ├── core/             # Services, models, guards
│   │   ├── features/         # Componentes de funcionalidade
│   │   └── shared/           # Componentes compartilhados
│   └── src/environments/     # Configurações de ambiente
├── infra/                    # Infraestrutura como Código
│   ├── cdk/                  # AWS CDK (TypeScript)
│   │   ├── bin/              # Entry points (ECS e Serverless)
│   │   └── lib/
│   │       ├── config/       # Configurações dev/prod
│   │       └── stacks/       # Stacks CloudFormation
│   └── scripts/              # Scripts de deploy e migrations
├── docs/                     # Documentação do projeto
└── scripts/                  # Scripts utilitários
```

## 🎯 Funcionalidades

### ✅ Gerenciamento de Produtos
- Cadastro de produtos com controle de estoque
- Atualização de saldo em tempo real
- Reserva de estoque com idempotência

### ✅ Emissão de Notas Fiscais
- Criação de notas fiscais com múltiplos itens
- Validação de estoque disponível
- Fechamento de nota com atualização de estoque

### ✅ Geração Automática de PDF
- **EventBridge** publica evento `Faturamento.ImpressaoSolicitada`
- **Lambda PDF Generator** gera PDF da nota em ~500ms
- Upload automático para S3
- Link de download via CloudFront

### ✅ Processamento Assíncrono
- Mensageria com AWS EventBridge + SQS
- Pattern Outbox para garantia de entrega
- DLQ (Dead Letter Queue) para mensagens com falha

## 🛠️ Pré-requisitos

### Desenvolvimento Local
- **.NET 9 SDK** (https://dot.net)
- **Go 1.23+** (https://go.dev)
- **Node.js 22+** e npm (https://nodejs.org)
- **AWS CLI v2** configurado
- **AWS CDK CLI**: `npm install -g aws-cdk`

### Deploy AWS
- **Conta AWS** com Free Tier
- **Credenciais AWS** configuradas (`aws configure`)
- **Permissões IAM**: Lambda, API Gateway, RDS, S3, CloudFront, EventBridge, SQS, Secrets Manager

## 📖 Instalação e Deploy

### 1. Clone o repositório
```bash
git clone https://github.com/Lucasantunesribeiro/emissao_nfe.git
cd emissao_nfe
```

### 2. Configurar variáveis de ambiente
```bash
# Copiar exemplo de configuração
cp .env.example .env

# Editar .env com suas configurações AWS
nano .env
```

### 3. Instalar dependências

**Frontend:**
```bash
cd web-app
npm install
cd ..
```

**CDK:**
```bash
cd infra/cdk
npm install
cd ../..
```

**Go (Faturamento):**
```bash
cd servico-faturamento
go mod download
cd ..
```

### 4. Build dos serviços

**Serviço Estoque (.NET):**
```bash
cd servico-estoque
dotnet publish -c Release -r linux-x64 --self-contained false
cd ..
```

**Serviço Faturamento (Go):**
```bash
cd servico-faturamento
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build/bootstrap cmd/lambda/main.go
cd ..
```

**Lambda PDF Generator:**
```bash
cd servico-faturamento
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o build-pdf/bootstrap cmd/lambda-pdf/main.go
cd ..
```

**Frontend:**
```bash
cd web-app
npm run build
cd ..
```

### 5. Deploy da infraestrutura (Serverless)

```bash
cd infra/cdk

# Bootstrap CDK (primeira vez apenas)
cdk bootstrap

# Deploy de todas as stacks (dev)
cdk deploy --all --require-approval never

# Ou deploy individual
cdk deploy NfeNetworkServerless-dev
cdk deploy NfeSecretsServerless-dev
cdk deploy NfeDatabaseServerless-dev
cdk deploy NfeMessagingServerless-dev
cdk deploy NfeFrontendServerless-dev
cdk deploy NfeComputeServerless-dev
```

### 6. Deploy do Frontend para S3

```bash
cd web-app

# Sincronizar com S3
aws s3 sync dist/web-app/ s3://nfe-frontend-dev-<ACCOUNT_ID>/

# Invalidar cache CloudFront
aws cloudfront create-invalidation --distribution-id <DISTRIBUTION_ID> --paths "/*"
```

## 🧪 Testando a Aplicação

### Acessar o Frontend
Após o deploy, acesse a URL do CloudFront:
```
https://<distribution-id>.cloudfront.net
```

### Testar APIs diretamente

**Listar Produtos:**
```bash
curl https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/api/v1/produtos
```

**Criar Nota Fiscal:**
```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/api/v1/notas \
  -H "Content-Type: application/json" \
  -d '{"numero":"NFE-001"}'
```

**Solicitar Impressão (gera PDF):**
```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/api/v1/notas/<nota-id>/imprimir \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-key-123"
```

## 💰 Custos Estimados (AWS)

### Free Tier (12 meses)
- **Lambda**: 1M requests/mês GRÁTIS
- **API Gateway**: 1M requests/mês GRÁTIS
- **RDS**: 750h/mês (t4g.micro) GRÁTIS
- **S3**: 5GB storage GRÁTIS
- **CloudFront**: 1TB transferência/mês GRÁTIS
- **EventBridge**: 100K eventos/mês GRÁTIS
- **SQS**: 1M requests/mês GRÁTIS

**Total Free Tier: ~$3/mês** (apenas Secrets Manager ~$1 + CloudWatch Logs ~$2)

### Após Free Tier
- **Total estimado: ~$33/mês** (uso moderado)
- **Economia de 83%** vs arquitetura ECS/EC2 (~$180/mês)

## 📊 Monitoramento

### CloudWatch Logs
```bash
# Logs do Lambda Estoque
aws logs tail /aws/lambda/nfe-estoque-dev --follow

# Logs do Lambda Faturamento
aws logs tail /aws/lambda/nfe-faturamento-dev --follow

# Logs do PDF Generator
aws logs tail /aws/lambda/nfe-pdf-generator-dev --follow
```

### CloudWatch Metrics
- Acesse o console AWS → CloudWatch → Metrics
- Namespace: `AWS/Lambda`, `AWS/ApiGateway`, `AWS/RDS`

## 🔧 Troubleshooting

### Lambda timeout conectando ao RDS
- Verificar se Lambda está na mesma VPC do RDS
- Verificar Security Groups (Lambda deve ter acesso à porta 5432 do RDS)

### PDF não gerado
- Verificar logs do Lambda PDF Generator
- Verificar se EventBridge Rule está ativa
- Verificar permissões S3 do Lambda

### CORS errors no frontend
- Verificar configuração de CORS nas APIs
- Verificar CloudFront headers policy

## 📝 Licença

Este projeto é licenciado sob a MIT License - veja o arquivo [LICENSE](LICENSE) para detalhes.

## 👥 Contribuindo

Contribuições são bem-vindas! Por favor:
1. Fork o projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📧 Contato

Lucas Antunes Ribeiro - [GitHub](https://github.com/Lucasantunesribeiro)

Link do Projeto: [https://github.com/Lucasantunesribeiro/emissao_nfe](https://github.com/Lucasantunesribeiro/emissao_nfe)
