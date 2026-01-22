# Configurar Perfil aws-new

**Data:** 2026-01-19
**Objetivo:** Adicionar credenciais da conta AWS nova para migração

---

## 📋 PRÉ-REQUISITOS

Você precisa ter:

1. ✅ **AWS Account ID** da conta nova
2. ✅ **Access Key ID** de um usuário IAM com permissões de deploy
3. ✅ **Secret Access Key** correspondente

Se você ainda não criou um usuário IAM na conta nova, siga os passos abaixo primeiro.

---

## 🔐 CRIAR USUÁRIO IAM NA CONTA NOVA (se necessário)

1. Acesse o AWS Console da conta nova
2. Vá para IAM → Users → Create User
3. Nome sugerido: `nfe-migration-user`
4. Enable AWS Management Console access: ❌ Não (apenas programmatic access)
5. Attach policies directly:
   - ✅ `AdministratorAccess` (temporariamente, para deploy completo)
   - ⚠️ **Atenção:** Após a migração, reduzir permissões para least privilege
6. Create User
7. Copie o **Access Key ID** e **Secret Access Key** (você só verá uma vez!)

---

## ⚙️ CONFIGURAR PERFIL LOCALMENTE

### Opção 1: Editar arquivos manualmente (RECOMENDADO)

#### Passo 1: Editar ~/.aws/credentials

Abra o arquivo:
```bash
notepad ~/.aws/credentials
# ou no Linux/WSL:
nano ~/.aws/credentials
```

Adicione no final do arquivo:
```ini
[aws-new]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE  # ← Substitua pelo seu Access Key
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY  # ← Substitua
```

**⚠️ IMPORTANTE:** Nunca commite este arquivo ou compartilhe em chat!

#### Passo 2: Editar ~/.aws/config

Abra o arquivo:
```bash
notepad ~/.aws/config
# ou no Linux/WSL:
nano ~/.aws/config
```

Adicione no final do arquivo:
```ini
[profile aws-new]
region = us-east-1
output = json
```

#### Passo 3: Validar

Execute:
```bash
aws sts get-caller-identity --profile aws-new
```

Você deve ver:
```json
{
  "UserId": "AIDAXXXXXXXXXXXXXXXXX",
  "Account": "999999999999",  # ← Account ID da conta nova
  "Arn": "arn:aws:iam::999999999999:user/nfe-migration-user"
}
```

✅ Se aparecer o Account ID correto da conta nova, está configurado!

---

### Opção 2: Usar aws configure

```bash
aws configure --profile aws-new
```

Digite quando solicitado:
```
AWS Access Key ID: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key: wJalrXUtnFEMI/K7MDENG...
Default region name: us-east-1
Default output format: json
```

---

## 🔍 VALIDAR PERMISSÕES

Execute estes comandos para validar se o usuário tem as permissões necessárias:

```bash
# 1. Testar identidade
aws sts get-caller-identity --profile aws-new

# 2. Testar permissão de listar stacks (CloudFormation)
aws cloudformation list-stacks --profile aws-new --region us-east-1

# 3. Testar permissão de listar buckets (S3)
aws s3 ls --profile aws-new

# 4. Testar permissão de listar funções (Lambda)
aws lambda list-functions --profile aws-new --region us-east-1
```

Se TODOS os comandos acima funcionarem sem erro `AccessDenied`, as permissões estão OK!

---

## ✅ PRÓXIMO PASSO

Após configurar o perfil, **VOLTE AO CHAT** e me avise:

**Digite:** "Perfil aws-new configurado, pode continuar"

Eu vou:
1. Validar autenticação na conta nova
2. Criar o plano de migração detalhado (FASE 2)
3. Iniciar a migração quando você aprovar

---

## 🚨 TROUBLESHOOTING

### Erro: "Unable to locate credentials"
- Verifique se o arquivo `~/.aws/credentials` existe
- Verifique se o nome do perfil está correto: `[aws-new]`

### Erro: "An error occurred (AccessDenied)"
- O usuário IAM não tem as permissões necessárias
- Adicione `AdministratorAccess` temporariamente

### Erro: "Could not connect to the endpoint URL"
- Verifique a região em `~/.aws/config`
- Deve ser `us-east-1` (mesma região da aws-old)

---

## 📝 ANOTAÇÕES

**Account ID da aws-new:** _____________________ (anote aqui para referência)

**Usuário IAM criado:** _____________________ (ex: nfe-migration-user)

**Data de criação das credenciais:** _____________________ (para rotacionar depois)
