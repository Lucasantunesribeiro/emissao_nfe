using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Serilog;
using ServicoEstoque.Api;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Infraestrutura.Mensageria;
using ServicoEstoque.Infraestrutura.Persistencia;

var builder = WebApplication.CreateBuilder(args);

// Configurar Serilog com JSON output
Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(builder.Configuration)
    .Enrich.WithProperty("service", "estoque")
    .Enrich.WithProperty("environment", builder.Environment.EnvironmentName)
    .WriteTo.Console(
        outputTemplate: "[{Timestamp:HH:mm:ss} {Level:u3}] {Message:lj} {Properties:j}{NewLine}{Exception}",
        formatProvider: null)
    .CreateLogger();

builder.Host.UseSerilog();

builder.Services.AddControllers()
    .AddJsonOptions(opts =>
    {
        opts.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
        opts.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var connStr = Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
    ?? "Host=postgres-estoque;Database=estoque;Username=admin;Password=admin123";

var dbSchema = Environment.GetEnvironmentVariable("DB_SCHEMA") ?? "public";

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
);

// Configurar schema no OnModelCreating será necessário no ContextoBancoDados

builder.Services.AddScoped<ReservarEstoqueHandler>();

builder.Services.AddHostedService<PublicadorOutbox>();
builder.Services.AddHostedService<ConsumidorEventos>();

builder.Services.AddCors(opts =>
{
    opts.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:4200")
            .AllowAnyHeader()
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
app.UseAuthorization();
app.MapControllers();

// Health check robusto
app.MapGet("/health", HealthCheckEndpoint.HandleHealthCheck);
app.MapGet("/api/v1/health", HealthCheckEndpoint.HandleHealthCheck);

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