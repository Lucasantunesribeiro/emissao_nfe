using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServicoEstoque.Api;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
public class MigrationController : ControllerBase
{
    private readonly ContextoBancoDados _contexto;
    private readonly ILogger<MigrationController> _logger;
    private readonly IHostEnvironment _env;

    public MigrationController(ContextoBancoDados contexto, ILogger<MigrationController> logger, IHostEnvironment env)
    {
        _contexto = contexto;
        _logger = logger;
        _env = env;
    }

    [HttpPost("create-tables")]
    public async Task<IActionResult> CreateTables()
    {
        try
        {
            if (!DbInitAllowed())
            {
                return StatusCode(403, new ApiErroResponse("Database bootstrap desabilitado"));
            }

            _logger.LogInformation("Creating database tables...");

            // SQL para criar as tabelas no schema correto
            var sql = @"
                -- Tabela produtos
                CREATE TABLE IF NOT EXISTS produtos (
                    id UUID PRIMARY KEY,
                    sku VARCHAR(50) UNIQUE NOT NULL,
                    nome VARCHAR(200) NOT NULL,
                    saldo INT NOT NULL CHECK (saldo >= 0),
                    ativo BOOLEAN NOT NULL DEFAULT true,
                    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_produtos_sku ON produtos(sku);
                CREATE INDEX IF NOT EXISTS idx_produtos_ativo ON produtos(ativo);

                -- Tabela reservas_estoque
                CREATE TABLE IF NOT EXISTS reservas_estoque (
                    id UUID PRIMARY KEY,
                    nota_id UUID NOT NULL,
                    produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
                    quantidade INT NOT NULL CHECK (quantidade > 0),
                    status VARCHAR(20) NOT NULL CHECK (status IN ('RESERVADO', 'CANCELADO')),
                    data_criacao TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_reservas_nota_id ON reservas_estoque(nota_id);
                CREATE INDEX IF NOT EXISTS idx_reservas_produto_id ON reservas_estoque(produto_id);
                CREATE INDEX IF NOT EXISTS idx_reservas_status ON reservas_estoque(status);

                -- Tabela eventos_outbox
                CREATE TABLE IF NOT EXISTS eventos_outbox (
                    id BIGSERIAL PRIMARY KEY,
                    tipo_evento VARCHAR(100) NOT NULL,
                    id_agregado UUID NOT NULL,
                    payload JSONB NOT NULL,
                    data_ocorrencia TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    data_publicacao TIMESTAMPTZ,
                    tentativas_envio INT NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_outbox_pendentes
                    ON eventos_outbox (data_publicacao)
                    WHERE data_publicacao IS NULL;

                CREATE INDEX IF NOT EXISTS idx_outbox_tipo_evento ON eventos_outbox(tipo_evento);
                CREATE INDEX IF NOT EXISTS idx_outbox_id_agregado ON eventos_outbox(id_agregado);

                -- Tabela mensagens_processadas (idempotência RabbitMQ)
                CREATE TABLE IF NOT EXISTS mensagens_processadas (
                    id_mensagem VARCHAR(100) PRIMARY KEY,
                    data_processada TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_msg_data ON mensagens_processadas(data_processada DESC);

                -- Dados de exemplo
                INSERT INTO produtos (id, sku, nome, saldo, ativo, data_criacao) VALUES
                    (gen_random_uuid(), 'PROD-001', 'Produto Demo 1', 100, true, NOW()),
                    (gen_random_uuid(), 'PROD-002', 'Produto Demo 2', 50, true, NOW()),
                    (gen_random_uuid(), 'PROD-003', 'Produto Demo 3', 200, true, NOW())
                ON CONFLICT (sku) DO NOTHING;
            ";

            await _contexto.Database.ExecuteSqlRawAsync(sql);

            _logger.LogInformation("Database tables created successfully");

            return Ok(new ApiMensagemResponse(
                "Tables created successfully",
                Environment.GetEnvironmentVariable("DB_SCHEMA") ?? "public"));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error creating database tables");
            return StatusCode(500, new ApiErroResponse("Falha ao criar tabelas"));
        }
    }

    private bool DbInitAllowed()
    {
        if (_env.IsDevelopment())
            return true;

        var allow = Environment.GetEnvironmentVariable("ALLOW_DB_INIT");
        return string.Equals(allow, "true", StringComparison.OrdinalIgnoreCase);
    }
}
