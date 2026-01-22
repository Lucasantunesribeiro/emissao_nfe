-- ================================================================
-- Script: Criação de Schemas e Usuários PostgreSQL
-- Database: nfe_db
-- Purpose: Criar schemas isolados para Faturamento e Estoque
-- ================================================================

-- Conectar ao database nfe_db antes de executar
-- psql -h <RDS_ENDPOINT> -U nfeadmin -d nfe_db

-- ================================================================
-- 1. CRIAR SCHEMAS
-- ================================================================

CREATE SCHEMA IF NOT EXISTS faturamento;
CREATE SCHEMA IF NOT EXISTS estoque;

-- ================================================================
-- 2. CRIAR USUÁRIOS (Opcional - se quiser usuários dedicados)
-- ================================================================

-- Usuário para serviço Faturamento
-- CREATE USER faturamento_user WITH PASSWORD 'senha_segura_faturamento';

-- Usuário para serviço Estoque
-- CREATE USER estoque_user WITH PASSWORD 'senha_segura_estoque';

-- ================================================================
-- 3. CONCEDER PERMISSÕES (se usuários dedicados forem criados)
-- ================================================================

-- Faturamento: acesso total ao schema faturamento
-- GRANT ALL PRIVILEGES ON SCHEMA faturamento TO faturamento_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA faturamento TO faturamento_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA faturamento TO faturamento_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA faturamento GRANT ALL PRIVILEGES ON TABLES TO faturamento_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA faturamento GRANT ALL PRIVILEGES ON SEQUENCES TO faturamento_user;

-- Estoque: acesso total ao schema estoque
-- GRANT ALL PRIVILEGES ON SCHEMA estoque TO estoque_user;
-- GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA estoque TO estoque_user;
-- GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA estoque TO estoque_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA estoque GRANT ALL PRIVILEGES ON TABLES TO estoque_user;
-- ALTER DEFAULT PRIVILEGES IN SCHEMA estoque GRANT ALL PRIVILEGES ON SEQUENCES TO estoque_user;

-- ================================================================
-- 4. CONFIGURAR SEARCH PATH DEFAULT (Opcional)
-- ================================================================

-- Para o usuário master (nfeadmin), permitir acesso a ambos schemas
ALTER USER nfeadmin SET search_path TO faturamento, estoque, public;

-- Se usuários dedicados:
-- ALTER USER faturamento_user SET search_path TO faturamento, public;
-- ALTER USER estoque_user SET search_path TO estoque, public;

-- ================================================================
-- 5. VERIFICAR SCHEMAS CRIADOS
-- ================================================================

SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('faturamento', 'estoque');

-- ================================================================
-- 6. INSTRUÇÕES DE EXECUÇÃO
-- ================================================================

-- Via AWS Systems Manager Session Manager (se habilitado):
-- aws ssm start-session --target <BASTION_INSTANCE_ID>
-- psql -h <RDS_ENDPOINT> -U nfeadmin -d nfe_db -f create-schemas.sql

-- Via Lambda Function (recomendado):
-- 1. Criar Lambda com VPC access (mesmas subnets do RDS)
-- 2. Runtime: Python 3.13 com psycopg2-binary layer
-- 3. Executar SQL via boto3 + psycopg2
-- 4. Trigger: manual ou CloudFormation Custom Resource

-- Via RDS Query Editor (se habilitado):
-- 1. Acessar RDS Console > Query Editor
-- 2. Conectar ao database nfe_db
-- 3. Executar SQL acima

-- ================================================================
-- NOTAS IMPORTANTES
-- ================================================================

-- 1. Schemas isolam tabelas logicamente na mesma instância RDS
-- 2. ECS tasks usam DB_SCHEMA env var para set search_path
-- 3. Migrations EF Core (.NET) e GORM (Go) respeitam schema configurado
-- 4. Executar este script APÓS deploy do DatabaseStack
-- 5. Atualizar Secrets Manager com connection strings corretas:
--    - faturamento: Search Path=faturamento
--    - estoque: Search Path=estoque

-- ================================================================
-- EXEMPLO CONNECTION STRINGS
-- ================================================================

-- Faturamento (GO - DATABASE_URL):
-- postgres://nfeadmin:senha@rds-endpoint:5432/nfe_db?sslmode=require&search_path=faturamento

-- Estoque (.NET - ConnectionString):
-- Host=rds-endpoint;Port=5432;Database=nfe_db;Username=nfeadmin;Password=senha;SSL Mode=Require;Search Path=estoque

-- ================================================================
-- ROLLBACK (se necessário)
-- ================================================================

-- DROP SCHEMA IF EXISTS faturamento CASCADE;
-- DROP SCHEMA IF EXISTS estoque CASCADE;
-- DROP USER IF EXISTS faturamento_user;
-- DROP USER IF EXISTS estoque_user;
