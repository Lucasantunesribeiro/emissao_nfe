using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using System.Linq;
using System.Text.Json.Serialization;
using Amazon.Lambda.Serialization.SystemTextJson;
using Microsoft.AspNetCore.Http.Json;
using Amazon.DynamoDBv2;
using Serilog;
using Serilog.Events;
using ServicoEstoque.Api;
using ServicoEstoque.Api.DTOs;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

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

// DynamoDB Configuration
var mainTableName = Environment.GetEnvironmentVariable("DYNAMODB_TABLE_NAME");
var eventsTableName = Environment.GetEnvironmentVariable("DYNAMODB_EVENTS_TABLE_NAME");

if (string.IsNullOrEmpty(mainTableName) || string.IsNullOrEmpty(eventsTableName))
{
    Log.Fatal("SECURITY: DYNAMODB_TABLE_NAME and DYNAMODB_EVENTS_TABLE_NAME are required.");
    throw new InvalidOperationException("DynamoDB table names are required. Configure via environment variables.");
}

// Register AWS DynamoDB client
builder.Services.AddSingleton<IAmazonDynamoDB>(sp => new AmazonDynamoDBClient());

// Register DynamoDB repositories
builder.Services.AddScoped<IRepositorioProdutos>(sp =>
    new RepositorioDynamoDBProdutos(
        sp.GetRequiredService<IAmazonDynamoDB>(),
        mainTableName,
        sp.GetRequiredService<ILogger<RepositorioDynamoDBProdutos>>()));

builder.Services.AddScoped<IRepositorioReservas>(sp =>
    new RepositorioDynamoDBReservas(
        sp.GetRequiredService<IAmazonDynamoDB>(),
        mainTableName,
        sp.GetRequiredService<ILogger<RepositorioDynamoDBReservas>>()));

builder.Services.AddScoped<IRepositorioEventos>(sp =>
    new RepositorioDynamoDBEventos(
        sp.GetRequiredService<IAmazonDynamoDB>(),
        eventsTableName,
        sp.GetRequiredService<ILogger<RepositorioDynamoDBEventos>>()));

builder.Services.AddScoped<ReservarEstoqueHandler>();

// EventBridge mode - no RabbitMQ background services needed
Log.Information("Using EventBridge for event publishing (serverless mode)");

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

app.MapGet("/api/v1/produtos", async (IRepositorioProdutos repo, ILogger<Program> logger) =>
{
    try
    {
        var produtos = await repo.ListarProdutosAtivosAsync();
        return Results.Ok(produtos.Select(p => new ProdutoResponse(
            p.Id,
            p.Sku,
            p.Nome,
            p.Saldo,
            p.Ativo,
            p.DataCriacao,
            p.Versao)));
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Erro ao listar produtos");
        return Results.Json(
            new ApiErroResponse("Erro ao listar produtos"),
            AppJsonSerializerContext.Default.ApiErroResponse,
            statusCode: 500);
    }
});

app.MapGet("/api/v1/produtos/{id:guid}", async (Guid id, IRepositorioProdutos repo) =>
{
    var produto = await repo.BuscarPorIdAsync(id);

    return produto is null
        ? Results.NotFound(new ApiErroResponse("Produto nao encontrado"))
        : Results.Ok(new ProdutoResponse(
            produto.Id,
            produto.Sku,
            produto.Nome,
            produto.Saldo,
            produto.Ativo,
            produto.DataCriacao,
            produto.Versao));
});

app.MapPost("/api/v1/produtos", async (CriarProdutoRequest request, IRepositorioProdutos repo, ILogger<Program> logger) =>
{
    if (!TryValidate(request, out var errors))
        return Results.ValidationProblem(errors);

    var skuExiste = await repo.BuscarPorSkuAsync(request.Sku);

    if (skuExiste != null)
        return Results.BadRequest(new ApiErroResponse("SKU ja cadastrado"));

    var produto = new Produto(request.Sku, request.Nome, request.Saldo);

    await repo.SalvarProdutoAsync(produto);

    logger.LogInformation("Produto criado: {Sku}", produto.Sku);

    return Results.Created($"/api/v1/produtos/{produto.Id}", new ProdutoResponse(
        produto.Id,
        produto.Sku,
        produto.Nome,
        produto.Saldo,
        produto.Ativo,
        produto.DataCriacao,
        produto.Versao));
});

// DynamoDB-based system - no migration endpoints needed

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
