using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Data;
using System.Data.Common;
using System.Linq;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Amazon.Lambda.Serialization.SystemTextJson;
using Microsoft.AspNetCore.Http.Json;
using Microsoft.EntityFrameworkCore;
using Serilog;
using Serilog.Events;
using ServicoEstoque.Api;
using ServicoEstoque.Api.DTOs;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Mensageria;
using ServicoEstoque.Infraestrutura.Persistencia;
// using ServicoEstoque.Infraestrutura.Persistencia.CompiledModel; // Comentado para .NET 8

var builder = WebApplication.CreateBuilder(args);
TouchEfAotMetadata();

// Adicionar suporte a AWS Lambda (RestApi = API Gateway REST)
builder.Services.AddAWSLambdaHosting(
    LambdaEventSource.RestApi,
    new SourceGeneratorLambdaJsonSerializer<LambdaJsonSerializerContext>()
);

// Configurar Serilog com JSON output (AOT-safe)
var logLevel = builder.Environment.IsDevelopment() ? LogEventLevel.Debug : LogEventLevel.Information;
Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Is(logLevel)
    .Enrich.WithProperty("service", "estoque")
    .Enrich.WithProperty("environment", builder.Environment.EnvironmentName)
    .WriteTo.Console(
        outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj} {Properties:j}{NewLine}{Exception}",
        formatProvider: null)
    .CreateLogger();

builder.Host.UseSerilog();

builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
    opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    opts.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var connStr = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");
if (string.IsNullOrEmpty(connStr))
{
    Log.Fatal("SECURITY: ConnectionStrings__DefaultConnection não configurada. Sistema não pode iniciar sem credenciais seguras.");
    throw new InvalidOperationException("ConnectionStrings__DefaultConnection é obrigatória. Configure via variáveis de ambiente ou Secrets Manager.");
}

var dbSchema = Environment.GetEnvironmentVariable("DB_SCHEMA") ?? "estoque";
var safeSchema = SanitizeSchema(dbSchema, "estoque");

builder.Services.AddDbContext<ContextoBancoDados>(opts =>
    opts.UseNpgsql(connStr, npgsql =>
    {
        npgsql.CommandTimeout(30);
        // Configurar search_path para o schema
        if (dbSchema != "public")
        {
            npgsql.MigrationsHistoryTable("__EFMigrationsHistory", dbSchema);
        }
    })
    // .UseModel(ContextoBancoDadosModel.Instance) // Comentado para .NET 8
);

// Configurar schema no OnModelCreating será necessário no ContextoBancoDados

builder.Services.AddScoped<ReservarEstoqueHandler>();

// RabbitMQ hosted services - desabilitar quando RABBITMQ_URL vazio ou "disabled" (Lambda/EventBridge)
var rabbitMqUrl = Environment.GetEnvironmentVariable("RABBITMQ_URL");
if (!string.IsNullOrEmpty(rabbitMqUrl) && rabbitMqUrl != "disabled")
{
    builder.Services.AddHostedService<PublicadorOutbox>();
    builder.Services.AddHostedService<ConsumidorEventos>();
    Log.Information("RabbitMQ enabled - Outbox and Consumer services registered");
}
else
{
    Log.Information("RabbitMQ disabled - Skipping Outbox and Consumer services (using EventBridge)");
}

builder.Services.AddCors(opts =>
{
    opts.AddDefaultPolicy(policy =>
    {
        // SECURITY: CORS restrito - nunca permite '*' em produção
        var corsOrigins = Environment.GetEnvironmentVariable("CORS_ORIGINS");
        if (!string.IsNullOrWhiteSpace(corsOrigins) && corsOrigins != "*")
        {
            var origins = corsOrigins
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            policy.WithOrigins(origins);
        }
        else
        {
            // SECURITY: Sem CORS_ORIGINS configurado - rejeitar todas as origens por segurança
            // Configure CORS_ORIGINS com os domínios autorizados (CloudFront, localhost dev, etc)
            Log.Warning("CORS_ORIGINS não configurado - CORS desabilitado por segurança");
            policy.WithOrigins(); // Nenhuma origem permitida
        }

        policy.AllowAnyHeader()
            .AllowAnyMethod();
    });
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();

var bootstrapSql = $@"
    CREATE SCHEMA IF NOT EXISTS {safeSchema};
    SET search_path TO {safeSchema};
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

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

app.MapGet("/api/v1/produtos", async (ContextoBancoDados ctx) =>
{
    var produtos = await ListarProdutosAsync(ctx);

    return Results.Ok(produtos);
});

app.MapGet("/api/v1/produtos/{id:guid}", (Guid id, ContextoBancoDados ctx) =>
{
    var produto = CompiledQueries.ProdutoPorId(ctx, id);

    return produto is null
        ? Results.NotFound(new ApiErroResponse("Produto nao encontrado"))
        : Results.Ok(produto);
});

app.MapPost("/api/v1/produtos", async (CriarProdutoRequest request, ContextoBancoDados ctx, ILogger<Program> logger) =>
{
    if (!TryValidate(request, out var errors))
        return Results.ValidationProblem(errors);

    var skuExiste = CompiledQueries.ProdutoSkuExiste(ctx, request.Sku);

    if (skuExiste)
        return Results.BadRequest(new ApiErroResponse("SKU ja cadastrado"));

    var produto = new Produto(request.Sku, request.Nome, request.Saldo);

    ctx.Produtos.Add(produto);
    await ctx.SaveChangesAsync();

    logger.LogInformation("Produto criado: {Sku}", produto.Sku);

    return Results.Created($"/api/v1/produtos/{produto.Id}", produto);
});

app.MapGet("/api/v1/produtos/init-db", async (ContextoBancoDados ctx, ILogger<Program> logger, IHostEnvironment env, HttpRequest request) =>
{
    // BLOQUEIO TOTAL EM PRODUÇÃO
    if (env.IsProduction())
    {
        logger.LogWarning("SECURITY: Tentativa de acesso a /init-db em PRODUÇÃO bloqueada de IP {RemoteIp}",
            request.HttpContext.Connection.RemoteIpAddress);
        return Results.Json(
            new ApiErroResponse("Endpoint desabilitado permanentemente em produção"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 403);
    }

    // EM DEV/STAGING: Requerer header secreto
    var adminSecret = request.Headers["X-Admin-Secret"].FirstOrDefault();
    var expectedSecret = Environment.GetEnvironmentVariable("ADMIN_INIT_SECRET");

    if (string.IsNullOrEmpty(expectedSecret))
    {
        logger.LogCritical("SECURITY: ADMIN_INIT_SECRET não configurado. Endpoint /init-db não pode ser usado.");
        return Results.Json(
            new ApiErroResponse("Endpoint não configurado corretamente"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 500);
    }

    if (adminSecret != expectedSecret)
    {
        logger.LogWarning("SECURITY: Tentativa não autorizada de /init-db de IP {RemoteIp} com secret inválido",
            request.HttpContext.Connection.RemoteIpAddress);
        return Results.Unauthorized();
    }

    // Validação de ALLOW_DB_INIT
    if (!DbInitAllowed(env))
    {
        return Results.Json(
            new ApiErroResponse("Database bootstrap desabilitado via ALLOW_DB_INIT"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 403);
    }

    try
    {
        logger.LogInformation("ADMIN: Creating database tables via /init-db endpoint by IP {RemoteIp}",
            request.HttpContext.Connection.RemoteIpAddress);
        await ctx.Database.ExecuteSqlRawAsync(bootstrapSql);
        logger.LogInformation("Database tables created successfully");

        return Results.Ok(new ApiMensagemResponse(
            "Tables created successfully",
            safeSchema));
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error creating database tables");
        return Results.Json(
            new ApiErroResponse("Falha ao criar tabelas"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 500);
    }
});

app.MapPost("/api/v1/migration/create-tables", async (ContextoBancoDados ctx, ILogger<Program> logger, IHostEnvironment env, HttpRequest request) =>
{
    // BLOQUEIO TOTAL EM PRODUÇÃO
    if (env.IsProduction())
    {
        logger.LogWarning("SECURITY: Tentativa de acesso a /migration/create-tables em PRODUÇÃO bloqueada de IP {RemoteIp}",
            request.HttpContext.Connection.RemoteIpAddress);
        return Results.Json(
            new ApiErroResponse("Endpoint desabilitado permanentemente em produção"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 403);
    }

    // EM DEV/STAGING: Requerer header secreto
    var adminSecret = request.Headers["X-Admin-Secret"].FirstOrDefault();
    var expectedSecret = Environment.GetEnvironmentVariable("ADMIN_INIT_SECRET");

    if (string.IsNullOrEmpty(expectedSecret))
    {
        logger.LogCritical("SECURITY: ADMIN_INIT_SECRET não configurado. Endpoint /migration/create-tables não pode ser usado.");
        return Results.Json(
            new ApiErroResponse("Endpoint não configurado corretamente"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 500);
    }

    if (adminSecret != expectedSecret)
    {
        logger.LogWarning("SECURITY: Tentativa não autorizada de /migration/create-tables de IP {RemoteIp} com secret inválido",
            request.HttpContext.Connection.RemoteIpAddress);
        return Results.Unauthorized();
    }

    if (!DbInitAllowed(env))
        return Results.Json(
            new ApiErroResponse("Database bootstrap desabilitado"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 403);

    try
    {
        logger.LogInformation("Creating database tables...");
        await ctx.Database.ExecuteSqlRawAsync(bootstrapSql);
        logger.LogInformation("Database tables created successfully");

        return Results.Ok(new ApiMensagemResponse(
            "Tables created successfully",
            safeSchema));
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Error creating database tables");
        return Results.Json(
            new ApiErroResponse("Falha ao criar tabelas"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 500);
    }
});

app.MapPost("/api/v1/reservas", async (
    HttpRequest httpRequest,
    ReservarEstoqueRequest request,
    ReservarEstoqueHandler handler,
    ILogger<Program> logger) =>
{
    if (!TryValidate(request, out var errors))
        return Results.ValidationProblem(errors);

    if (request.NotaId == Guid.Empty || request.ProdutoId == Guid.Empty)
        return Results.BadRequest(new ApiErroResponse("NotaId e ProdutoId sao obrigatorios"));

    var demoFail = httpRequest.Headers["X-Demo-Fail"].FirstOrDefault();
    var simularFalha = string.Equals(demoFail, "true", StringComparison.OrdinalIgnoreCase);

    logger.LogInformation(
        "[Reservas] Recebendo requisicao: NotaId={NotaId}, ProdutoId={ProdutoId}, Quantidade={Quantidade}, X-Demo-Fail={Header}",
        request.NotaId,
        request.ProdutoId,
        request.Quantidade,
        demoFail ?? "<null>");

    if (simularFalha)
        logger.LogWarning("[Reservas] Simulacao de falha ativada via header X-Demo-Fail");
    else
        logger.LogInformation("[Reservas] X-Demo-Fail desativado (valor='{Header}')", demoFail ?? "<null>");

    var comando = new ReservarEstoqueCommand(
        request.NotaId,
        request.ProdutoId,
        request.Quantidade);

    var resultado = await handler.Executar(comando, simularFalha);

    if (resultado.EhSucesso)
    {
        return Results.Ok(new ReservaResponse(
            true,
            ReservaId: resultado.Dados!.Id,
            Mensagem: "Reserva criada com sucesso"));
    }

    return Results.BadRequest(new ReservaResponse(
        false,
        Erro: resultado.Mensagem));
});

// Health check robusto
app.MapGet("/health", HealthCheckEndpoint.HandleHealthCheck);
app.MapGet("/api/v1/health", HealthCheckEndpoint.HandleHealthCheck);

static bool DbInitAllowed(IHostEnvironment env)
{
    if (env.IsDevelopment())
        return true;

    var allow = Environment.GetEnvironmentVariable("ALLOW_DB_INIT");
    return string.Equals(allow, "true", StringComparison.OrdinalIgnoreCase);
}

static bool TryValidate<T>(T model, out Dictionary<string, string[]> errors)
{
    var context = new ValidationContext(model!);
    var results = new List<ValidationResult>();

    if (Validator.TryValidateObject(model!, context, results, true))
    {
        errors = new Dictionary<string, string[]>();
        return true;
    }

    errors = results
        .GroupBy(result => result.MemberNames.FirstOrDefault() ?? string.Empty)
        .ToDictionary(
            group => group.Key,
            group => group
                .Select(result => result.ErrorMessage ?? "Invalid value")
                .ToArray());

    return false;
}

static void TouchEfAotMetadata()
{
    AotPreserve.Touch();
    _ = typeof(IQueryable<long>);
    _ = typeof(IOrderedQueryable<long>);
    _ = typeof(IQueryable<int>);
    _ = typeof(IQueryable<float>);
    _ = typeof(IQueryable<double>);
    _ = typeof(IQueryable<decimal>);
}

static string SanitizeSchema(string schema, string fallback)
{
    if (string.IsNullOrWhiteSpace(schema))
        return fallback;

    var trimmed = schema.Trim();
    return Regex.IsMatch(trimmed, "^[a-zA-Z0-9_]+$") ? trimmed : fallback;
}

static async Task<IEnumerable<ProdutoResponse>> ListarProdutosAsync(ContextoBancoDados ctx)
{
    var schema = ctx.Model.GetDefaultSchema() ?? "public";
    var tableName = $"{schema}.produtos";

    var produtos = new List<ProdutoResponse>();

    var connection = ctx.Database.GetDbConnection();

    if (connection.State != ConnectionState.Open)
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

    return produtos;
}

// Graceful shutdown
var lifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
lifetime.ApplicationStopping.Register(() =>
{
    Log.Information("Recebido sinal de shutdown, encerrando gracefully...");
});

try
{
    Log.Information("Servidor Estoque iniciado na porta 5000");
    app.Run();
}
catch (Exception ex)
{
    Log.Fatal(ex, "Aplicação encerrada inesperadamente");
}
finally
{
    Log.CloseAndFlush();
}
