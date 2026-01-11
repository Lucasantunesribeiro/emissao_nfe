-- Criação das tabelas do serviço Faturamento

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tabela notas_fiscais
CREATE TABLE IF NOT EXISTS notas_fiscais (
    id UUID PRIMARY KEY,
    numero VARCHAR(20) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL CHECK (status IN ('ABERTA', 'FECHADA', 'CANCELADA')),
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_fechada TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notas_numero ON notas_fiscais(numero);
CREATE INDEX IF NOT EXISTS idx_notas_status ON notas_fiscais(status);
CREATE INDEX IF NOT EXISTS idx_notas_data_criacao ON notas_fiscais(data_criacao DESC);

-- Tabela itens_nota
CREATE TABLE IF NOT EXISTS itens_nota (
    id UUID PRIMARY KEY,
    nota_id UUID NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
    produto_id UUID NOT NULL,
    quantidade INT NOT NULL CHECK (quantidade > 0),
    preco_unitario DECIMAL(10,2) NOT NULL CHECK (preco_unitario >= 0)
);

CREATE INDEX IF NOT EXISTS idx_itens_nota_id ON itens_nota(nota_id);
CREATE INDEX IF NOT EXISTS idx_itens_produto_id ON itens_nota(produto_id);

-- Tabela solicitacoes_impressao
CREATE TABLE IF NOT EXISTS solicitacoes_impressao (
    id UUID PRIMARY KEY,
    nota_id UUID NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL CHECK (status IN ('PENDENTE', 'CONCLUIDA', 'FALHOU')),
    mensagem_erro TEXT,
    chave_idempotencia VARCHAR(100) UNIQUE NOT NULL,
    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_conclusao TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_solicitacoes_nota_id ON solicitacoes_impressao(nota_id);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_status ON solicitacoes_impressao(status);
CREATE INDEX IF NOT EXISTS idx_solicitacoes_chave ON solicitacoes_impressao(chave_idempotencia);

-- Tabela eventos_outbox
CREATE TABLE IF NOT EXISTS eventos_outbox (
    id BIGSERIAL PRIMARY KEY,
    tipo_evento VARCHAR(100) NOT NULL,
    id_agregado UUID NOT NULL,
    payload JSONB NOT NULL,
    data_ocorrencia TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_publicacao TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_faturamento_outbox_pendentes 
    ON eventos_outbox (data_publicacao) 
    WHERE data_publicacao IS NULL;

CREATE INDEX IF NOT EXISTS idx_faturamento_outbox_tipo ON eventos_outbox(tipo_evento);

-- Tabela mensagens_processadas (idempotência RabbitMQ)
CREATE TABLE IF NOT EXISTS mensagens_processadas (
    id_mensagem VARCHAR(100) PRIMARY KEY,
    data_processada TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mensagens_data ON mensagens_processadas(data_processada DESC);

-- Dados de exemplo (opcional)
INSERT INTO notas_fiscais (id, numero, status, data_criacao) VALUES
    (gen_random_uuid(), 'NFE-DEMO-001', 'ABERTA', NOW()),
    (gen_random_uuid(), 'NFE-DEMO-002', 'ABERTA', NOW())
ON CONFLICT (numero) DO NOTHING;
