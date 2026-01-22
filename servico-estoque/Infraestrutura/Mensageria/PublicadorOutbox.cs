using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using RabbitMQ.Client;
using ServicoEstoque.Infraestrutura.Persistencia;
using System.Text;

namespace ServicoEstoque.Infraestrutura.Mensageria;

public class PublicadorOutbox : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<PublicadorOutbox> _logger;
    private readonly ConnectionFactory _factory;

    public PublicadorOutbox(IServiceProvider serviceProvider, ILogger<PublicadorOutbox> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;

        var host = Environment.GetEnvironmentVariable("RabbitMQ__Host") ?? "rabbitmq";
        var port = int.Parse(Environment.GetEnvironmentVariable("RabbitMQ__Port") ?? "5672");
        var useSsl = bool.Parse(Environment.GetEnvironmentVariable("RabbitMQ__UseSsl") ?? "false");

        _factory = new ConnectionFactory
        {
            HostName = host,
            Port = port,
            UserName = Environment.GetEnvironmentVariable("RabbitMQ__Username") ?? "admin",
            Password = Environment.GetEnvironmentVariable("RabbitMQ__Password") ?? "admin123",
            Ssl = useSsl ? new SslOption { Enabled = true, ServerName = host } : new SslOption()
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Publisher Outbox iniciado");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessarEventosPendentes(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Erro ao processar outbox");
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    private async Task ProcessarEventosPendentes(CancellationToken ct)
    {
        using var scope = _serviceProvider.CreateScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ContextoBancoDados>();

        var eventosPendentes = CompiledQueries.EventosOutboxPendentes(ctx);

        if (!eventosPendentes.Any())
            return;

        _logger.LogInformation("Processando {Count} eventos pendentes", eventosPendentes.Count);

        using var connection = _factory.CreateConnection();
        using var channel = connection.CreateModel();

        channel.ExchangeDeclare("estoque-eventos", ExchangeType.Topic, durable: true);

        foreach (var evento in eventosPendentes)
        {
            try
            {
                var body = Encoding.UTF8.GetBytes(evento.Payload);
                var props = channel.CreateBasicProperties();
                props.MessageId = evento.Id.ToString();
                props.Timestamp = new AmqpTimestamp(
                    ((DateTimeOffset)evento.DataOcorrencia).ToUnixTimeSeconds()
                );

                channel.BasicPublish(
                    exchange: "estoque-eventos",
                    routingKey: evento.TipoEvento,
                    basicProperties: props,
                    body: body
                );

                evento.DataPublicacao = DateTime.UtcNow;
                evento.TentativasEnvio++;

                _logger.LogInformation("Evento publicado: {TipoEvento} - {IdAgregado}",
                    evento.TipoEvento, evento.IdAgregado);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Falha ao publicar evento {EventoId}", evento.Id);
                evento.TentativasEnvio++;
            }
        }

        await ctx.SaveChangesAsync(ct);
    }
}
