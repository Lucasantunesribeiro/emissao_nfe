using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Infraestrutura.Mensageria;

/// <summary>
/// Consumidor de eventos do RabbitMQ para processar solicitacoes de reserva vindas do Faturamento
/// Implementa idempotencia e processamento transacional
/// </summary>
public class ConsumidorEventos : BackgroundService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ILogger<ConsumidorEventos> _logger;
    private IConnection? _conexao;
    private IModel? _canal;

    public ConsumidorEventos(IServiceProvider serviceProvider, ILogger<ConsumidorEventos> logger)
    {
        _serviceProvider = serviceProvider;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await InicializarConexao(stoppingToken);

        if (_canal is null)
        {
            _logger.LogError("Nao foi possivel estabelecer conexao com RabbitMQ apos varias tentativas");
            return;
        }

        ConfigurarConsumidor();

        _logger.LogInformation("Consumidor RabbitMQ iniciado, aguardando eventos...");

        await Task.Delay(Timeout.Infinite, stoppingToken);
    }

    private async Task InicializarConexao(CancellationToken ct)
    {
        var host = Environment.GetEnvironmentVariable("RabbitMQ__Host") ?? "rabbitmq";
        var port = int.Parse(Environment.GetEnvironmentVariable("RabbitMQ__Port") ?? "5672");
        var usuario = Environment.GetEnvironmentVariable("RabbitMQ__Username") ?? "admin";
        var senha = Environment.GetEnvironmentVariable("RabbitMQ__Password") ?? "admin123";
        var useSsl = bool.Parse(Environment.GetEnvironmentVariable("RabbitMQ__UseSsl") ?? "false");

        var factory = new ConnectionFactory
        {
            HostName = host,
            Port = port,
            UserName = usuario,
            Password = senha,
            AutomaticRecoveryEnabled = true,
            NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
            Ssl = useSsl ? new SslOption { Enabled = true, ServerName = host } : new SslOption()
        };

        for (int tentativa = 1; tentativa <= 30; tentativa++)
        {
            try
            {
                _logger.LogInformation("Tentativa {Tentativa}/30 de conexao com RabbitMQ ({Host})...", tentativa, host);
                _conexao = factory.CreateConnection();
                _canal = _conexao.CreateModel();

                _logger.LogInformation("Conectado ao RabbitMQ com sucesso");
                return;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Falha na tentativa {Tentativa}: {Erro}", tentativa, ex.Message);

                if (tentativa < 30)
                {
                    int delay = tentativa == 1 ? 3000 : 5000;
                    await Task.Delay(delay, ct);
                }
            }
        }

        _logger.LogCritical("FALHA CRITICA: Nao foi possivel conectar ao RabbitMQ apos 30 tentativas");
    }

    private void ConfigurarConsumidor()
    {
        if (_canal is null) return;

        _canal.ExchangeDeclare(
            exchange: "faturamento-eventos",
            type: ExchangeType.Topic,
            durable: true
        );

        var nomeFila = _canal.QueueDeclare(
            queue: "estoque-eventos",
            durable: true,
            exclusive: false,
            autoDelete: false,
            arguments: null
        ).QueueName;

        _canal.QueueBind(
            queue: nomeFila,
            exchange: "faturamento-eventos",
            routingKey: "Faturamento.ImpressaoSolicitada"
        );

        _logger.LogInformation("Escutando: Faturamento.ImpressaoSolicitada");

        _canal.BasicQos(prefetchSize: 0, prefetchCount: 1, global: false);

        var consumidor = new EventingBasicConsumer(_canal);
        consumidor.Received += async (modelo, args) =>
        {
            try
            {
                await ProcessarMensagem(args);
                _canal.BasicAck(deliveryTag: args.DeliveryTag, multiple: false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Erro ao processar mensagem {MsgId}", args.BasicProperties.MessageId);

                _canal.BasicNack(deliveryTag: args.DeliveryTag, multiple: false, requeue: false);
            }
        };

        _canal.BasicConsume(
            queue: nomeFila,
            autoAck: false,
            consumer: consumidor
        );
    }

    private async Task ProcessarMensagem(BasicDeliverEventArgs args)
    {
        using var escopo = _serviceProvider.CreateScope();
        var contexto = escopo.ServiceProvider.GetRequiredService<ContextoBancoDados>();
        var handler = escopo.ServiceProvider.GetRequiredService<ReservarEstoqueHandler>();

        // idempotencia: usar MessageId unico do RabbitMQ
        var idMensagem = args.BasicProperties.MessageId ?? $"delivery-{args.DeliveryTag}";

        // verificar se ja processamos essa msg (evita duplicacao em retry)
        var jaProcessada = await contexto.Set<MensagemProcessada>()
            .AnyAsync(m => m.IDMensagem == idMensagem);

        if (jaProcessada)
        {
            _logger.LogInformation("Mensagem {MsgId} ja foi processada anteriormente, ignorando", idMensagem);
            return;
        }

        // deserializar payload JSON
        var corpo = Encoding.UTF8.GetString(args.Body.ToArray());
        var evento = JsonSerializer.Deserialize<EventoSolicitacaoImpressao>(corpo, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });

        if (evento is null || evento.Itens is null || evento.Itens.Count == 0)
        {
            _logger.LogError("Falha ao deserializar evento ou evento sem itens: {Corpo}", corpo);
            return;
        }

        _logger.LogInformation(
            "Processando solicitacao de reserva para nota {NotaId} com {QtdItens} itens",
            evento.NotaId, evento.Itens.Count
        );

        // processar todos os itens em lote (transacao unica)
        var itensComando = evento.Itens
            .Select(i => new ReservarEstoqueItem(i.ProdutoId, i.Quantidade))
            .ToList();

        var lote = new ReservarEstoqueLoteCommand(evento.NotaId, itensComando);
        var resultadoLote = await handler.ExecutarLote(lote, simularFalha: false);

        // marcar mensagem como processada (idempotencia)
        contexto.MensagensProcessadas.Add(new MensagemProcessada
        {
            IDMensagem = idMensagem,
            DataProcessada = DateTime.UtcNow
        });
        await contexto.SaveChangesAsync();

        if (resultadoLote.Falhou)
        {
            _logger.LogWarning("Falha ao processar nota {NotaId}: {Motivo}", evento.NotaId, resultadoLote.Mensagem);
        }
        else
        {
            _logger.LogInformation("Todas as reservas processadas com sucesso para nota {NotaId}", evento.NotaId);
        }
    }

    public override void Dispose()
    {
        _canal?.Close();
        _conexao?.Close();
        base.Dispose();
    }
}

// DTOs internos para deserializar eventos (payload vem do Go)
internal record EventoSolicitacaoImpressao(
    Guid NotaId,
    List<ItemEventoImpressao> Itens
);

internal record ItemEventoImpressao(
    Guid ProdutoId,
    int Quantidade
);
