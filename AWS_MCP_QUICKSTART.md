# AWS MCP - Quick Start 🚀

Guia rápido para configurar o AWS MCP e dar ao Claude Code CLI controle total da AWS.

## ⚡ Setup Rápido (5 minutos)

### 1. Instalar AWS CLI

```bash
# Linux/macOS
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verificar
aws --version
```

### 2. Configurar Credenciais AWS

```bash
# Configurar AWS Profile
aws configure --profile default

# Preencher:
# - AWS Access Key ID: [Sua chave]
# - AWS Secret Access Key: [Seu secret]
# - Default region: us-east-1 (ou sa-east-1 para São Paulo)
# - Output format: json

# Testar
aws sts get-caller-identity --profile default
```

### 3. Configurar Variáveis de Ambiente

```bash
# Copiar arquivo de exemplo
cp .env.example .env

# Editar (opcional - se não usar AWS Profile)
nano .env

# Definir variáveis no shell
export AWS_PROFILE=default
export AWS_REGION=us-east-1
```

### 4. Verificar Configuração

```bash
# O arquivo .mcp.json já está configurado!
# Verificar se está válido
cat .mcp.json | python3 -m json.tool

# Listar servidores MCP
claude mcp list

# Deve mostrar:
# - awslabs-core
# - awslabs-cfn
# - awslabs-api
# - awslabs-iam
# - awslabs-dynamodb
# - awslabs-lambda
# - awslabs-docs
```

### 5. Testar

```bash
# Abrir Claude Code CLI e testar
# Exemplos de comandos:

Claude: Liste todos os buckets S3 na minha conta

Claude: Mostre-me as instâncias EC2 em execução

Claude: Qual é a região configurada?
```

## 📦 Arquivos Criados

```
emissao_nfe/
├── .mcp.json              # Configuração dos servidores MCP (versionar)
├── .env.example           # Template de variáveis de ambiente
├── .env                   # Suas credenciais (NÃO versionar!)
├── AWS_MCP_QUICKSTART.md  # Este arquivo
└── docs/
    └── CONFIGURACAO_AWS_MCP.md  # Documentação completa
```

## 🎯 Próximos Passos

1. **Explorar recursos existentes**:
   ```
   Claude: Liste todos os recursos AWS na minha conta
   ```

2. **Criar ambiente de teste**:
   ```
   Claude: Crie uma VPC de teste com subnets públicas e privadas
   ```

3. **Deploy da infraestrutura do projeto**:
   ```
   Claude: Configure a infraestrutura AWS completa para este projeto de emissão de NFe
   ```

## 🔒 Segurança

- ✅ `.env` está no `.gitignore`
- ✅ Use IAM users específicos (não root)
- ✅ Princípio do menor privilégio
- ✅ Rotacione credenciais a cada 90 dias
- ✅ Habilite MFA no Console AWS

## 📚 Documentação Completa

Para guia detalhado, consulte: [`docs/CONFIGURACAO_AWS_MCP.md`](docs/CONFIGURACAO_AWS_MCP.md)

## 🆘 Troubleshooting

### Problema: "AWS CLI not found"
```bash
which aws
# Se vazio, reinstalar AWS CLI
```

### Problema: "Access Denied"
```bash
# Verificar credenciais
aws sts get-caller-identity

# Reconfigurar se necessário
aws configure --profile default
```

### Problema: "MCP Server failed to start"
```bash
# Verificar uvx instalado
uvx --version

# Instalar/atualizar
pip install --upgrade uv
```

## ✨ Exemplos de Uso

```bash
# Infraestrutura
Claude: Crie uma instância EC2 t3.micro com Ubuntu 22.04

# Bancos de dados
Claude: Crie um RDS PostgreSQL db.t3.micro

# Storage
Claude: Crie um bucket S3 com versionamento

# Serverless
Claude: Crie uma função Lambda em Python que processa S3 eventos

# Rede
Claude: Configure um Application Load Balancer

# IAM
Claude: Crie um usuário IAM com permissões S3 ReadWrite

# Monitoramento
Claude: Configure alarmes CloudWatch para CPU alta
```

## 🌎 Regiões AWS Comuns

- `us-east-1` - Norte da Virgínia (padrão, mais barato)
- `us-west-2` - Oregon
- `sa-east-1` - São Paulo 🇧🇷 (maior latência para Brasil)
- `eu-west-1` - Irlanda
- `ap-southeast-1` - Singapura

Para mudar a região, edite o `.mcp.json` e `.env`:
```json
"AWS_REGION": "sa-east-1"
```

## 💰 Dica de Custos

- Use [AWS Free Tier](https://aws.amazon.com/free/) para aprender
- Sempre termine recursos não usados
- Configure [AWS Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/) com alertas
- Use [AWS Pricing Calculator](https://calculator.aws/) para estimar custos

---

**Pronto!** 🎉 Agora você tem controle total da AWS via Claude Code CLI.

**Desenvolvido por**: Lucas Antunes Ferreira
**Projeto**: Viasoft Korp ERP - Sistema de Emissão NFe
