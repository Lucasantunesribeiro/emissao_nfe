# Configuração AWS MCP para Claude Code CLI

![AWS](https://img.shields.io/badge/AWS-MCP-orange?style=for-the-badge&logo=amazon-aws)
![Claude Code](https://img.shields.io/badge/Claude_Code-CLI-blue?style=for-the-badge)

Este guia explica como configurar o **AWS MCP (Model Context Protocol)** para que o Claude Code CLI tenha acesso completo aos recursos da AWS, permitindo gerenciar toda a infraestrutura do projeto através de linguagem natural.

---

## 📋 Índice

1. [O que é AWS MCP?](#o-que-é-aws-mcp)
2. [Pré-requisitos](#pré-requisitos)
3. [Instalação do AWS CLI](#instalação-do-aws-cli)
4. [Configuração de Credenciais AWS](#configuração-de-credenciais-aws)
5. [Configuração do MCP](#configuração-do-mcp)
6. [Servidores MCP Disponíveis](#servidores-mcp-disponíveis)
7. [Como Usar](#como-usar)
8. [Troubleshooting](#troubleshooting)
9. [Segurança](#segurança)

---

## 🔍 O que é AWS MCP?

O **AWS MCP (Model Context Protocol)** é uma integração oficial que permite ao Claude Code acessar e gerenciar recursos da AWS através de interface em linguagem natural. Com ele, você pode:

- **Criar recursos AWS**: EC2, RDS, S3, Lambda, VPC, etc.
- **Gerenciar infraestrutura**: Modificar, consultar e deletar recursos
- **Deploy automatizado**: Configurar toda a stack do projeto na AWS
- **Consultar documentação**: Acesso offline à documentação AWS
- **Gestão de IAM**: Criar usuários, roles e políticas de acesso

### Arquitetura do MCP

```
┌─────────────────┐
│  Claude Code    │
│      CLI        │
└────────┬────────┘
         │
         │ Natural Language
         ▼
┌─────────────────┐
│   MCP Servers   │
│                 │
│  ┌───────────┐  │
│  │  Core     │  │
│  ├───────────┤  │
│  │  CFN      │  │ ◄── CloudFormation (1100+ recursos)
│  ├───────────┤  │
│  │  API      │  │ ◄── AWS APIs diretas
│  ├───────────┤  │
│  │  IAM      │  │ ◄── Gestão de identidade
│  ├───────────┤  │
│  │  Lambda   │  │ ◄── Funções serverless
│  ├───────────┤  │
│  │  DynamoDB │  │ ◄── NoSQL database
│  └───────────┘  │
└────────┬────────┘
         │
         │ AWS SDK/API
         ▼
┌─────────────────┐
│   AWS Cloud     │
│                 │
│  EC2 │ RDS      │
│  S3  │ Lambda   │
│  IAM │ VPC      │
└─────────────────┘
```

---

## ✅ Pré-requisitos

Antes de começar, verifique se você tem instalado:

### 1. Node.js 18+
```bash
node --version
# Deve retornar v18.x.x ou superior
```

Se não tiver instalado:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew install node

# Windows
# Baixe do site oficial: https://nodejs.org/
```

### 2. Python 3.11+
```bash
python3 --version
# Deve retornar Python 3.11.x ou superior
```

### 3. uvx (Python package runner)
```bash
uvx --version
# Ou
pipx --version
```

Se não tiver instalado:
```bash
# Instalar uvx via pip
pip install uv

# Ou instalar pipx
python3 -m pip install --user pipx
python3 -m pipx ensurepath
```

### 4. AWS CLI v2
```bash
aws --version
# Deve retornar aws-cli/2.x.x
```

---

## 🔧 Instalação do AWS CLI

### Linux (Ubuntu/Debian)

```bash
# Baixar o instalador
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"

# Descompactar
unzip awscliv2.zip

# Instalar
sudo ./aws/install

# Verificar instalação
aws --version
```

### macOS

```bash
# Usando Homebrew
brew install awscli

# Ou baixar o instalador oficial
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /
```

### Windows

```powershell
# Baixar e executar o instalador MSI
# https://awscli.amazonaws.com/AWSCLIV2.msi

# Ou usando Chocolatey
choco install awscli

# Ou usando winget
winget install Amazon.AWSCLI
```

### Verificar Instalação

```bash
aws --version
# Deve retornar: aws-cli/2.x.x Python/3.x.x ...
```

---

## 🔑 Configuração de Credenciais AWS

### Método 1: AWS Profile (Recomendado)

Este é o método mais seguro e recomendado para desenvolvimento local.

#### Passo 1: Criar Access Keys no AWS Console

1. Acesse o [AWS Console](https://console.aws.amazon.com/)
2. Vá para **IAM** → **Users** → Seu usuário
3. Clique em **Security credentials**
4. Em **Access keys**, clique em **Create access key**
5. Escolha **CLI** como caso de uso
6. Copie o **Access Key ID** e **Secret Access Key**

⚠️ **IMPORTANTE**: Salve o Secret Access Key em local seguro. Você não poderá vê-lo novamente!

#### Passo 2: Configurar o AWS CLI

```bash
# Configurar o perfil default
aws configure --profile default

# Você será solicitado a informar:
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

#### Passo 3: Verificar Configuração

```bash
# Testar credenciais
aws sts get-caller-identity --profile default

# Deve retornar:
{
    "UserId": "AIDAXXXXXXXXXXXXXXXXX",
    "Account": "123456789012",
    "Arn": "arn:aws:iam::123456789012:user/seu-usuario"
}
```

### Método 2: Variáveis de Ambiente

Para ambientes CI/CD ou temporários:

```bash
# Copiar o arquivo de exemplo
cp .env.example .env

# Editar o arquivo .env
nano .env

# Adicionar suas credenciais
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
```

### Método 3: IAM Roles (Para EC2/ECS)

Se você está rodando em uma instância EC2 ou container ECS:

```bash
# Não precisa configurar credenciais!
# A AWS automaticamente usa a IAM Role anexada à instância

# Apenas configure a região
export AWS_REGION=us-east-1
```

---

## ⚙️ Configuração do MCP

O projeto já vem com um arquivo `.mcp.json` pré-configurado com os principais servidores AWS MCP.

### Estrutura do .mcp.json

```json
{
  "mcpServers": {
    "awslabs-core": {
      "command": "uvx",
      "args": ["awslabs.core-mcp-server@latest"],
      "env": {
        "FASTMCP_LOG_LEVEL": "ERROR"
      }
    },
    "awslabs-cfn": {
      "command": "uvx",
      "args": ["awslabs.cfn-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1",
        "FASTMCP_LOG_LEVEL": "ERROR"
      }
    },
    "awslabs-api": {
      "command": "uvx",
      "args": ["awslabs.aws-api-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1"
      }
    },
    "awslabs-iam": {
      "command": "uvx",
      "args": ["awslabs.iam-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1"
      }
    },
    "awslabs-dynamodb": {
      "command": "uvx",
      "args": ["awslabs.dynamodb-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1"
      }
    },
    "awslabs-lambda": {
      "command": "uvx",
      "args": ["awslabs.lambda-mcp-server@latest"],
      "env": {
        "AWS_PROFILE": "default",
        "AWS_REGION": "us-east-1"
      }
    },
    "awslabs-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"]
    }
  }
}
```

### Personalizar a Região

Se você quiser usar uma região diferente de `us-east-1`:

1. **Editar o arquivo .mcp.json**:
   ```bash
   nano .mcp.json
   ```

2. **Alterar a região em todos os servidores**:
   ```json
   "AWS_REGION": "sa-east-1"  // São Paulo
   ```

3. **Regiões comuns**:
   - `us-east-1` - Norte da Virgínia (padrão)
   - `us-west-2` - Oregon
   - `sa-east-1` - São Paulo 🇧🇷
   - `eu-west-1` - Irlanda
   - `ap-southeast-1` - Singapura

### Verificar Instalação do MCP

```bash
# Listar todos os servidores MCP configurados
claude mcp list

# Deve mostrar:
# awslabs-core (project)
# awslabs-cfn (project)
# awslabs-api (project)
# awslabs-iam (project)
# awslabs-dynamodb (project)
# awslabs-lambda (project)
# awslabs-docs (project)
```

---

## 🛠️ Servidores MCP Disponíveis

### 1. Core MCP Server (`awslabs-core`)
**Obrigatório** - Servidor base necessário para todos os outros

### 2. CloudFormation MCP Server (`awslabs-cfn`)
**Acesso a 1.100+ recursos AWS**

- EC2 (Instâncias, Security Groups, Load Balancers)
- RDS (Bancos de dados relacionais)
- S3 (Buckets e objetos)
- Lambda (Funções serverless)
- VPC (Redes, Subnets, Internet Gateways)
- ECS/EKS (Containers orquestrados)
- CloudWatch (Logs, Métricas, Alarmes)
- SNS/SQS (Mensageria)
- Route53 (DNS)

**Exemplo de uso**:
```
Claude: Crie uma instância EC2 t3.micro com Ubuntu 22.04 em us-east-1
```

### 3. AWS API Server (`awslabs-api`)
**Acesso direto às APIs AWS**

Para operações não cobertas pelo CloudFormation:
- Operações customizadas
- APIs específicas de serviços
- Integração com serviços regionais

**Exemplo de uso**:
```
Claude: Liste todos os snapshots de EBS com mais de 30 dias
```

### 4. IAM Server (`awslabs-iam`)
**Gestão de identidade e acesso**

- Criar/modificar usuários IAM
- Gerenciar roles e políticas
- Configurar permissões
- Auditoria de acesso

**Exemplo de uso**:
```
Claude: Crie um usuário IAM chamado 'deploy-bot' com permissões de S3 ReadWrite
```

### 5. DynamoDB Server (`awslabs-dynamodb`)
**Operações em bancos NoSQL**

- Queries e Scans
- PutItem, GetItem, UpdateItem
- Batch operations
- Gestão de índices

**Exemplo de uso**:
```
Claude: Crie uma tabela DynamoDB chamada 'products' com chave primária 'productId'
```

### 6. Lambda Server (`awslabs-lambda`)
**Funções serverless**

- Criar/atualizar funções Lambda
- Invocar funções
- Gerenciar triggers
- Configurar environment variables

**Exemplo de uso**:
```
Claude: Crie uma função Lambda em Python que processa mensagens do SQS
```

### 7. AWS Documentation Server (`awslabs-docs`)
**Documentação offline**

- Acesso rápido a best practices
- Exemplos de código
- Referência de APIs
- Guias de arquitetura

**Exemplo de uso**:
```
Claude: Mostre-me as melhores práticas para configurar VPC multi-AZ
```

---

## 🚀 Como Usar

### Comandos via Claude Code CLI

Uma vez configurado, você pode usar linguagem natural para gerenciar AWS:

#### Exemplos Práticos para Este Projeto

```bash
# 1. Criar infraestrutura básica
Claude: Crie uma VPC com 2 subnets públicas e 2 privadas em us-east-1

# 2. Deploy dos bancos de dados
Claude: Crie 2 instâncias RDS PostgreSQL (t3.micro):
- servico-faturamento-db
- servico-estoque-db
Ambos em subnets privadas com backup automático

# 3. Deploy do RabbitMQ
Claude: Crie uma instância Amazon MQ (RabbitMQ) em subnet privada

# 4. Deploy dos serviços em ECS
Claude: Crie um cluster ECS Fargate e deploy os serviços:
- servico-faturamento (Go) - imagem: seu-repo/faturamento:latest
- servico-estoque (.NET) - imagem: seu-repo/estoque:latest
Configure Load Balancer e Auto Scaling

# 5. Deploy do frontend
Claude: Hospede o Angular SPA no S3 com CloudFront e HTTPS

# 6. Configurar observabilidade
Claude: Configure CloudWatch Logs e métricas para todos os serviços

# 7. Configurar segurança
Claude: Crie Security Groups permitindo:
- Frontend: HTTPS público
- Load Balancer: HTTP/HTTPS
- Serviços: apenas entre si e com RDS/RabbitMQ
- RDS/RabbitMQ: apenas dos serviços
```

#### Exemplos Gerais

```bash
# Listar recursos
Claude: Liste todas as instâncias EC2 na minha conta

# Criar bucket S3
Claude: Crie um bucket S3 chamado 'my-project-assets' com versionamento

# Atualizar Security Group
Claude: Adicione regra para permitir SSH (porta 22) do meu IP

# Verificar custos
Claude: Mostre-me os recursos mais caros da minha conta AWS

# Backup
Claude: Crie um snapshot do volume EBS vol-12345678

# Monitoramento
Claude: Crie um alarme CloudWatch se CPU > 80% por 5 minutos

# IAM
Claude: Mostre-me todas as políticas IAM anexadas ao usuário 'developer'
```

### Modo Read-Only (Seguro para Aprendizado)

Se você quiser explorar sem risco de criar recursos:

1. **Editar .mcp.json**:
   ```json
   "awslabs-api": {
     "command": "uvx",
     "args": ["awslabs.aws-api-mcp-server@latest"],
     "env": {
       "AWS_PROFILE": "default",
       "AWS_REGION": "us-east-1",
       "READ_OPERATIONS_ONLY": "true"
     }
   }
   ```

2. **Usar comandos de consulta**:
   ```
   Claude: Liste todos os recursos EC2
   Claude: Mostre-me as configurações do RDS instance X
   Claude: Qual é o custo estimado da minha infraestrutura?
   ```

---

## 🐛 Troubleshooting

### Problema: "AWS CLI not found"

**Causa**: AWS CLI não está instalado ou não está no PATH

**Solução**:
```bash
# Verificar instalação
which aws

# Se não encontrado, instalar conforme seção "Instalação do AWS CLI"

# Verificar PATH
echo $PATH

# Adicionar ao PATH (se necessário)
export PATH=$PATH:/usr/local/bin
```

### Problema: "UnauthorizedOperation" ou "Access Denied"

**Causa**: Credenciais AWS incorretas ou sem permissões

**Solução**:
```bash
# 1. Verificar credenciais
aws sts get-caller-identity --profile default

# 2. Se erro, reconfigurar
aws configure --profile default

# 3. Verificar permissões IAM no Console AWS
# Seu usuário precisa de permissões adequadas (ex: PowerUserAccess)
```

### Problema: "MCP Server failed to start"

**Causa**: Dependências Python não instaladas

**Solução**:
```bash
# Instalar/atualizar uvx
pip install --upgrade uv

# Limpar cache do uvx
uvx --cache-clear

# Reinstalar servidor MCP
uvx awslabs.core-mcp-server@latest --version
```

### Problema: "Rate limit exceeded"

**Causa**: Muitas chamadas à API AWS em curto período

**Solução**:
```bash
# Aguardar alguns minutos

# Ou aumentar o retry backoff no código
# (AWS SDK já faz isso automaticamente)
```

### Problema: Logs muito verbosos

**Causa**: Nível de log está em DEBUG

**Solução**:
```bash
# Editar .mcp.json
"FASTMCP_LOG_LEVEL": "ERROR"  # Trocar de DEBUG para ERROR
```

### Problema: Região incorreta

**Causa**: Recursos estão em região diferente da configurada

**Solução**:
```bash
# Verificar região configurada
aws configure get region --profile default

# Alterar região no .mcp.json
"AWS_REGION": "us-east-1"  # Trocar para sua região

# Ou especificar região no comando
aws ec2 describe-instances --region sa-east-1
```

---

## 🔒 Segurança

### ✅ Boas Práticas

#### 1. Nunca commite credenciais
```bash
# .env está no .gitignore
# Verificar antes de commit
git status

# Se acidentalmente adicionou, remover do histórico
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all
```

#### 2. Use IAM Users específicos
```bash
# NÃO use root account!
# Crie um usuário IAM dedicado para desenvolvimento

# No Console AWS:
# IAM → Users → Add users → "claude-code-dev"
# Anexar política: PowerUserAccess (ou personalizada)
```

#### 3. Princípio do menor privilégio
```json
// Exemplo de política IAM customizada (mínima)
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ec2:CreateTags",
        "s3:ListBucket",
        "s3:GetObject",
        "rds:Describe*",
        "cloudwatch:GetMetricStatistics"
      ],
      "Resource": "*"
    }
  ]
}
```

#### 4. Use MFA (Multi-Factor Authentication)
```bash
# Habilitar MFA no Console AWS
# IAM → Users → Seu usuário → Security credentials → MFA
```

#### 5. Rotacione credenciais regularmente
```bash
# A cada 90 dias, criar novas Access Keys

# No Console AWS:
# IAM → Users → Seu usuário → Security credentials
# Create access key → Deactivate old key

# Atualizar .env com novas credenciais
```

#### 6. Use AWS Organizations para ambientes separados
```bash
# Conta AWS separada para:
# - Desenvolvimento
# - Staging
# - Produção

# Não misturar ambientes na mesma conta!
```

#### 7. Monitore atividades suspeitas
```bash
# Habilitar AWS CloudTrail
# Console AWS → CloudTrail → Create trail

# Configurar alertas para ações sensíveis:
# - Criação de usuários IAM
# - Modificação de Security Groups
# - Acesso a buckets S3 sensíveis
```

### 🚨 O que NUNCA fazer

❌ Commitar credenciais no Git
❌ Compartilhar Access Keys por email/Slack
❌ Usar root account para desenvolvimento
❌ Dar permissões `*:*` (admin total)
❌ Expor buckets S3 publicamente sem necessidade
❌ Desabilitar encriptação de dados sensíveis
❌ Ignorar alertas de segurança da AWS

---

## 📚 Recursos Adicionais

### Documentação Oficial

- [AWS MCP Servers](https://awslabs.github.io/mcp/)
- [AWS MCP GitHub](https://github.com/awslabs/mcp)
- [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp)
- [AWS CLI Documentation](https://docs.aws.amazon.com/cli/)
- [AWS Best Practices](https://aws.amazon.com/architecture/well-architected/)

### Tutoriais e Guias

- [AWS Free Tier](https://aws.amazon.com/free/) - Recursos gratuitos por 12 meses
- [AWS Pricing Calculator](https://calculator.aws/) - Estimar custos
- [AWS Architecture Center](https://aws.amazon.com/architecture/) - Patterns e exemplos
- [AWS re:Post](https://repost.aws/) - Comunidade Q&A

### Suporte

- **Issues do projeto**: [GitHub Issues](https://github.com/seu-usuario/emissao_nfe/issues)
- **AWS Support**: [AWS Support Center](https://console.aws.amazon.com/support/)
- **Claude Code**: [Claude Code Documentation](https://code.claude.com/docs/)

---

## 📝 Checklist de Configuração

Use este checklist para garantir que tudo está configurado corretamente:

- [ ] Node.js 18+ instalado (`node --version`)
- [ ] Python 3.11+ instalado (`python3 --version`)
- [ ] uvx instalado (`uvx --version`)
- [ ] AWS CLI v2 instalado (`aws --version`)
- [ ] Credenciais AWS configuradas (`aws configure`)
- [ ] Teste de credenciais OK (`aws sts get-caller-identity`)
- [ ] Arquivo `.mcp.json` presente na raiz do projeto
- [ ] Arquivo `.env` criado a partir de `.env.example`
- [ ] Região AWS correta no `.mcp.json` e `.env`
- [ ] MCP Servers listados (`claude mcp list`)
- [ ] `.env` está no `.gitignore`
- [ ] Testado comando básico (ex: "Claude: Liste buckets S3")

---

## 🎯 Próximos Passos

Agora que o AWS MCP está configurado, você pode:

1. **Explorar recursos existentes**:
   ```
   Claude: Liste todos os recursos AWS na minha conta
   ```

2. **Criar infraestrutura de teste**:
   ```
   Claude: Crie um ambiente de desenvolvimento com VPC, EC2 e RDS
   ```

3. **Automatizar deploy**:
   ```
   Claude: Crie um pipeline de CI/CD para este projeto usando CodePipeline
   ```

4. **Configurar monitoramento**:
   ```
   Claude: Configure CloudWatch com alertas para erros e alta latência
   ```

5. **Implementar segurança avançada**:
   ```
   Claude: Configure AWS WAF e Shield para proteção DDoS
   ```

---

## ✨ Exemplos de Casos de Uso Reais

### Caso 1: Setup Completo da Infraestrutura

```
Claude: Configure a infraestrutura AWS completa para este projeto:

1. VPC multi-AZ com subnets públicas e privadas
2. Application Load Balancer para os serviços
3. ECS Fargate cluster com:
   - Serviço de Faturamento (Go)
   - Serviço de Estoque (.NET)
4. RDS PostgreSQL multi-AZ para cada serviço
5. Amazon MQ (RabbitMQ) para mensageria
6. S3 + CloudFront para o frontend Angular
7. CloudWatch Logs e métricas
8. IAM roles com mínimo privilégio
9. Security Groups com regras restritivas

Região: sa-east-1 (São Paulo)
Ambiente: Production
```

### Caso 2: Migração de Docker Compose para AWS

```
Claude: Analise meu docker-compose.yml e crie a infraestrutura AWS equivalente:

- Converta os serviços para ECS Fargate
- Configure RDS no lugar dos containers PostgreSQL
- Use Amazon MQ no lugar do RabbitMQ local
- Configure networking e service discovery
- Mantenha as mesmas variáveis de ambiente
- Configure backups automáticos
```

### Caso 3: Monitoramento e Alertas

```
Claude: Configure monitoramento completo:

1. CloudWatch Logs para todos os serviços
2. Métricas customizadas:
   - Tempo de processamento de notas fiscais
   - Taxa de sucesso/falha de reservas de estoque
   - Tamanho das filas RabbitMQ
3. Alarmes:
   - CPU > 80% por 5 minutos
   - Memória > 90%
   - Taxa de erro > 5%
   - Latência p99 > 2 segundos
4. SNS topic para notificações por email
```

---

**Desenvolvido por**: Lucas Antunes Ferreira
**Projeto**: Viasoft Korp ERP - Sistema de Emissão NFe
**Data**: Janeiro 2026
**Versão**: 1.0.0

---

🚀 **Dica Final**: Comece explorando com comandos simples de consulta (read-only) antes de criar recursos. Isso te ajudará a se familiarizar com o MCP sem custos ou riscos!
