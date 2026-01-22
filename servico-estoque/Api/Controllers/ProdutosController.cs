using System.Collections.Generic;
using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServicoEstoque.Api;
using ServicoEstoque.Api.DTOs;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Api.Controllers;

[ApiController]
[Route("api/v1/produtos")]
public class ProdutosController : ControllerBase
{
    private readonly ContextoBancoDados _ctx;
    private readonly ILogger<ProdutosController> _logger;
    private readonly IHostEnvironment _env;

    public ProdutosController(ContextoBancoDados ctx, ILogger<ProdutosController> logger, IHostEnvironment env)
    {
        _ctx = ctx;
        _logger = logger;
        _env = env;
    }

    [HttpGet("init-db")]
    public async Task<ActionResult> InitDatabase()
    {
        try
        {
            if (!DbInitAllowed())
            {
                return StatusCode(403, new ApiErroResponse("Database bootstrap desabilitado"));
            }

            _logger.LogInformation("Creating database tables...");

            var sql = @"
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

                CREATE TABLE IF NOT EXISTS eventos_outbox (
                    id BIGSERIAL PRIMARY KEY,
                    tipo_evento VARCHAR(100) NOT NULL,
                    id_agregado UUID NOT NULL,
                    payload JSONB NOT NULL,
                    data_ocorrencia TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    data_publicacao TIMESTAMPTZ,
                    tentativas_envio INT NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_outbox_pendentes ON eventos_outbox (data_publicacao) WHERE data_publicacao IS NULL;
                CREATE INDEX IF NOT EXISTS idx_outbox_tipo_evento ON eventos_outbox(tipo_evento);
                CREATE INDEX IF NOT EXISTS idx_outbox_id_agregado ON eventos_outbox(id_agregado);

                CREATE TABLE IF NOT EXISTS mensagens_processadas (
                    id_mensagem VARCHAR(100) PRIMARY KEY,
                    data_processada TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_msg_data ON mensagens_processadas(data_processada DESC);

                INSERT INTO produtos (id, sku, nome, saldo, ativo, data_criacao) VALUES
                    (gen_random_uuid(), 'PROD-001', 'Produto Demo 1', 100, true, NOW()),
                    (gen_random_uuid(), 'PROD-002', 'Produto Demo 2', 50, true, NOW()),
                    (gen_random_uuid(), 'PROD-003', 'Produto Demo 3', 200, true, NOW())
                ON CONFLICT (sku) DO NOTHING;
            ";

            await _ctx.Database.ExecuteSqlRawAsync(sql);
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

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ProdutoResponse>>> Listar()
    {
        var schema = _ctx.Model.GetDefaultSchema() ?? "public";
        var tableName = $"{schema}.produtos";

        var produtos = new List<ProdutoResponse>();

        var connection = _ctx.Database.GetDbConnection();

        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync();
        }

        await using DbCommand command = connection.CreateCommand();
        command.CommandText = $"""
            SELECT id, sku, nome, saldo, ativo, data_criacao, xmin
            FROM {tableName}
            WHERE ativo = TRUE
            ORDER BY data_criacao DESC
            """;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            produtos.Add(new ProdutoResponse(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetInt32(3),
                reader.GetBoolean(4),
                reader.GetFieldValue<DateTime>(5),
                reader.GetFieldValue<uint>(6)));
        }

        return Ok(produtos);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult> Buscar(Guid id)
    {
        var produto = await _ctx.Produtos
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        if (produto == null)
            return NotFound(new ApiErroResponse("Produto nao encontrado"));

        return Ok(produto);
    }

    [HttpPost]
    public async Task<ActionResult> Criar([FromBody] CriarProdutoRequest request)
    {
        if (!ModelState.IsValid)
            return ValidationProblem(ModelState);

        var skuExiste = await _ctx.Produtos
            .AnyAsync(p => p.Sku == request.Sku);

        if (skuExiste)
            return BadRequest(new ApiErroResponse("SKU ja cadastrado"));

        var produto = new Produto(request.Sku, request.Nome, request.Saldo);

        _ctx.Produtos.Add(produto);
        await _ctx.SaveChangesAsync();

        _logger.LogInformation("Produto criado: {Sku}", produto.Sku);

        return CreatedAtAction(nameof(Buscar), new { id = produto.Id }, produto);
    }

    private bool DbInitAllowed()
    {
        if (_env.IsDevelopment())
            return true;

        var allow = Environment.GetEnvironmentVariable("ALLOW_DB_INIT");
        return string.Equals(allow, "true", StringComparison.OrdinalIgnoreCase);
    }
}
