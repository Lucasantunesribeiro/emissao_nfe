#!/usr/bin/env python3
"""
Lambda temporária para criar schemas no RDS
Executa uma vez e pode ser deletada
"""
import psycopg2
import os

def handler(event, context):
    # Obter credenciais do ambiente
    db_host = os.environ['DB_HOST']
    db_name = os.environ['DB_NAME']
    db_user = os.environ['DB_USER']
    db_password = os.environ['DB_PASSWORD']

    # SQL para criar schemas
    sql = """
    -- Criar schemas
    CREATE SCHEMA IF NOT EXISTS faturamento;
    CREATE SCHEMA IF NOT EXISTS estoque;

    -- Configurar search_path
    ALTER USER nfeadmin SET search_path TO faturamento, estoque, public;

    -- Grant permissions
    GRANT ALL PRIVILEGES ON SCHEMA faturamento TO nfeadmin;
    GRANT ALL PRIVILEGES ON SCHEMA estoque TO nfeadmin;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA faturamento TO nfeadmin;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA estoque TO nfeadmin;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA faturamento TO nfeadmin;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA estoque TO nfeadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA faturamento GRANT ALL PRIVILEGES ON TABLES TO nfeadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA estoque GRANT ALL PRIVILEGES ON TABLES TO nfeadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA faturamento GRANT ALL PRIVILEGES ON SEQUENCES TO nfeadmin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA estoque GRANT ALL PRIVILEGES ON SEQUENCES TO nfeadmin;
    """

    try:
        # Conectar ao RDS
        conn = psycopg2.connect(
            host=db_host,
            database=db_name,
            user=db_user,
            password=db_password,
            sslmode='require',
            connect_timeout=10
        )

        cur = conn.cursor()

        # Executar SQL
        cur.execute(sql)
        conn.commit()

        # Verificar schemas criados
        cur.execute("""
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name IN ('faturamento', 'estoque')
        """)
        schemas = cur.fetchall()

        cur.close()
        conn.close()

        return {
            'statusCode': 200,
            'body': {
                'message': 'Schemas criados com sucesso',
                'schemas': [s[0] for s in schemas]
            }
        }

    except Exception as e:
        print(f'Erro: {str(e)}')
        return {
            'statusCode': 500,
            'body': {
                'error': str(e)
            }
        }
