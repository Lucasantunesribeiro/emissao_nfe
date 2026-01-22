using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using RabbitMQ.Client;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Api;

public record HealthCheckResponse(
    string Status,
    string Service,
    string Environment,
    string Timestamp,
    Dictionary<string, CheckResult> Checks,
    long UptimeSeconds
);

public record CheckResult(
    string Status,
    long? LatencyMs = null,
    string? Error = null
);

public static class HealthCheckEndpoint
{
    private static readonly DateTimeOffset StartTime = DateTimeOffset.UtcNow;

    public static async Task<IResult> HandleHealthCheck(
        ContextoBancoDados contexto,
        IConfiguration configuration,
        IHostEnvironment env)
    {
        var checks = new Dictionary<string, CheckResult>();

        // Check Database
        checks["database"] = await CheckDatabase(contexto);

        // Check RabbitMQ
        checks["rabbitmq"] = CheckRabbitMQ(configuration);

        var overallStatus = checks.Values.Any(c => c.Status == "fail") ? "unhealthy" : "healthy";

        var response = new HealthCheckResponse(
            Status: overallStatus,
            Service: "estoque",
            Environment: env.EnvironmentName,
            Timestamp: DateTimeOffset.UtcNow.ToString("o"),
            Checks: checks,
            UptimeSeconds: (long)(DateTimeOffset.UtcNow - StartTime).TotalSeconds
        );

        var statusCode = overallStatus == "healthy" ? 200 : 503;
        return Results.Json(
            response,
            AppJsonSerializerContext.Default.HealthCheckResponse,
            statusCode: statusCode);
    }

    private static async Task<CheckResult> CheckDatabase(ContextoBancoDados contexto)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await contexto.Database.ExecuteSqlRawAsync("SELECT 1", cts.Token);
            sw.Stop();
            return new CheckResult("ok", LatencyMs: sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return new CheckResult("fail", Error: ex.Message);
        }
    }

    private static CheckResult CheckRabbitMQ(IConfiguration configuration)
    {
        // Se RABBITMQ_URL estiver vazio ou "disabled", pula verificação (Lambda/EventBridge)
        var rabbitMqUrl = Environment.GetEnvironmentVariable("RABBITMQ_URL");
        if (string.IsNullOrEmpty(rabbitMqUrl) || rabbitMqUrl == "disabled")
        {
            return new CheckResult("ok", Error: "rabbitmq disabled (using EventBridge)");
        }

        var sw = Stopwatch.StartNew();
        try
        {
            var factory = CreateRabbitMQFactory(configuration);

            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            using var conn = factory.CreateConnection();
            sw.Stop();

            return new CheckResult("ok", LatencyMs: sw.ElapsedMilliseconds);
        }
        catch (Exception ex)
        {
            return new CheckResult("fail", Error: ex.Message);
        }
    }

    private static ConnectionFactory CreateRabbitMQFactory(IConfiguration configuration)
    {
        var host = configuration["RabbitMQ__Host"];
        var port = int.Parse(configuration["RabbitMQ__Port"] ?? "5672");
        var username = configuration["RabbitMQ__Username"];
        var password = configuration["RabbitMQ__Password"];
        var useSsl = bool.Parse(configuration["RabbitMQ__UseSsl"] ?? "false");

        if (string.IsNullOrEmpty(host) || string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
        {
            throw new InvalidOperationException("SECURITY: RabbitMQ credentials (Host, Username, Password) são obrigatórias via variáveis de ambiente.");
        }

        return new ConnectionFactory
        {
            HostName = host,
            Port = port,
            UserName = username,
            Password = password,
            Ssl = useSsl ? new SslOption { Enabled = true, ServerName = host } : new SslOption()
        };
    }
}
