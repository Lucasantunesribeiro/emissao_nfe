using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Microsoft.Extensions.Logging;
using ServicoEstoque.Dominio.Entidades;

namespace ServicoEstoque.Infraestrutura.Persistencia;

public interface IRepositorioProdutos
{
    Task<Produto?> BuscarPorIdAsync(Guid id, CancellationToken ct = default);
    Task<Produto?> BuscarPorSkuAsync(string sku, CancellationToken ct = default);
    Task<List<Produto>> ListarProdutosAtivosAsync(CancellationToken ct = default);
    Task SalvarProdutoAsync(Produto produto, CancellationToken ct = default);
    Task AtualizarProdutoAsync(Produto produto, CancellationToken ct = default);
}

public interface IRepositorioReservas
{
    Task<ReservaEstoque?> BuscarPorIdAsync(Guid id, CancellationToken ct = default);
    Task<List<ReservaEstoque>> ListarPorNotaAsync(Guid notaId, CancellationToken ct = default);
    Task SalvarReservaAsync(ReservaEstoque reserva, CancellationToken ct = default);

    /// <summary>
    /// Grava, numa unica transacao DynamoDB, a reserva (condicionada a nao existir),
    /// a baixa do produto (condicionada a versao lida) e o evento de outbox.
    /// Retorna false, sem alterar nada, se a reserva com o mesmo Id ja existir.
    /// Lanca InvalidOperationException("Versão desatualizada ...") em conflito de versao.
    /// </summary>
    Task<bool> ReservarComBaixaAtomicaAsync(
        ReservaEstoque reserva,
        Produto produtoDebitado,
        EventoOutbox evento,
        CancellationToken ct = default);
}

public interface IRepositorioEventos
{
    Task SalvarEventoOutboxAsync(EventoOutbox evento, CancellationToken ct = default);
    Task MarcarMensagemProcessadaAsync(string idMensagem, CancellationToken ct = default);
    Task<bool> MensagemJaProcessadaAsync(string idMensagem, CancellationToken ct = default);
}

/// <summary>
/// Repositório DynamoDB para Produtos usando Single-Table Design
/// </summary>
public class RepositorioDynamoDBProdutos : IRepositorioProdutos
{
    private readonly IAmazonDynamoDB _client;
    private readonly string _tableName;
    private readonly ILogger<RepositorioDynamoDBProdutos> _logger;

    public RepositorioDynamoDBProdutos(
        IAmazonDynamoDB client,
        string tableName,
        ILogger<RepositorioDynamoDBProdutos> logger)
    {
        _client = client;
        _tableName = tableName;
        _logger = logger;
    }

    public async Task<Produto?> BuscarPorIdAsync(Guid id, CancellationToken ct = default)
    {
        var request = new GetItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue($"PRODUTO#{id}"),
                ["SK"] = new AttributeValue("#METADATA")
            }
        };

        var response = await _client.GetItemAsync(request, ct);

        if (!response.IsItemSet || response.Item.Count == 0)
        {
            _logger.LogDebug("[RepositorioDynamoDB] Produto {Id} não encontrado", id);
            return null;
        }

        return MapToProduto(response.Item);
    }

    public async Task<Produto?> BuscarPorSkuAsync(string sku, CancellationToken ct = default)
    {
        var request = new QueryRequest
        {
            TableName = _tableName,
            IndexName = "GSI1",
            KeyConditionExpression = "GSI1_PK = :pk",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":pk"] = new AttributeValue($"SKU#{sku}")
            }
        };

        var response = await _client.QueryAsync(request, ct);

        if (response.Items.Count == 0)
        {
            _logger.LogDebug("[RepositorioDynamoDB] Produto com SKU {Sku} não encontrado", sku);
            return null;
        }

        return MapToProduto(response.Items[0]);
    }

    public async Task<List<Produto>> ListarProdutosAtivosAsync(CancellationToken ct = default)
    {
        var request = new QueryRequest
        {
            TableName = _tableName,
            IndexName = "GSI2",
            KeyConditionExpression = "GSI2_PK = :pk",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":pk"] = new AttributeValue("STATUS#ATIVO")
            }
        };

        var response = await _client.QueryAsync(request, ct);
        var produtos = new List<Produto>();

        foreach (var item in response.Items)
        {
            produtos.Add(MapToProduto(item));
        }

        _logger.LogDebug("[RepositorioDynamoDB] Listados {Count} produtos ativos", produtos.Count);
        return produtos;
    }

    public async Task SalvarProdutoAsync(Produto produto, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new AttributeValue($"PRODUTO#{produto.Id}"),
            ["SK"] = new AttributeValue("#METADATA"),
            ["GSI1_PK"] = new AttributeValue($"SKU#{produto.Sku}"),
            ["GSI2_PK"] = new AttributeValue($"STATUS#{(produto.Ativo ? "ATIVO" : "INATIVO")}"),
            ["GSI2_SK"] = new AttributeValue(produto.DataCriacao.ToString("o")),
            ["entity_type"] = new AttributeValue("PRODUTO"),
            ["id"] = new AttributeValue(produto.Id.ToString()),
            ["sku"] = new AttributeValue(produto.Sku),
            ["nome"] = new AttributeValue(produto.Nome),
            ["saldo"] = new AttributeValue { N = produto.Saldo.ToString() },
            ["ativo"] = new AttributeValue { BOOL = produto.Ativo },
            ["data_criacao"] = new AttributeValue(produto.DataCriacao.ToString("o")),
            ["versao"] = new AttributeValue { N = produto.Versao.ToString() }
        };

        var request = new PutItemRequest
        {
            TableName = _tableName,
            Item = item,
            ConditionExpression = "attribute_not_exists(PK)" // Evita sobrescrever produto existente
        };

        try
        {
            await _client.PutItemAsync(request, ct);
            _logger.LogInformation("[RepositorioDynamoDB] Produto {Id} salvo com sucesso", produto.Id);
        }
        catch (ConditionalCheckFailedException)
        {
            throw new InvalidOperationException($"Produto com ID {produto.Id} já existe");
        }
    }

    /// <summary>
    /// Update otimista do produto: so aplica se `versao` ainda for a lida.
    /// Compartilhado entre AtualizarProdutoAsync e a transacao de reserva.
    /// </summary>
    internal static Update CriarUpdateProduto(string tableName, Produto produto) => new()
    {
        TableName = tableName,
        Key = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new AttributeValue($"PRODUTO#{produto.Id}"),
            ["SK"] = new AttributeValue("#METADATA")
        },
        ConditionExpression = "versao = :versao_antiga",
        UpdateExpression = "SET saldo = :saldo, ativo = :ativo, versao = :versao_nova, GSI2_PK = :status",
        ExpressionAttributeValues = new Dictionary<string, AttributeValue>
        {
            [":saldo"] = new AttributeValue { N = produto.Saldo.ToString() },
            [":ativo"] = new AttributeValue { BOOL = produto.Ativo },
            [":versao_antiga"] = new AttributeValue { N = produto.Versao.ToString() },
            [":versao_nova"] = new AttributeValue { N = (produto.Versao + 1).ToString() },
            [":status"] = new AttributeValue($"STATUS#{(produto.Ativo ? "ATIVO" : "INATIVO")}")
        }
    };

    public async Task AtualizarProdutoAsync(Produto produto, CancellationToken ct = default)
    {
        var update = CriarUpdateProduto(_tableName, produto);
        var request = new UpdateItemRequest
        {
            TableName = update.TableName,
            Key = update.Key,
            ConditionExpression = update.ConditionExpression,
            UpdateExpression = update.UpdateExpression,
            ExpressionAttributeValues = update.ExpressionAttributeValues
        };

        try
        {
            await _client.UpdateItemAsync(request, ct);
            _logger.LogInformation("[RepositorioDynamoDB] Produto {Id} atualizado. Saldo: {Saldo}, Versão: {Versao}",
                produto.Id, produto.Saldo, produto.Versao + 1);
        }
        catch (ConditionalCheckFailedException)
        {
            _logger.LogWarning("[RepositorioDynamoDB] Conflito de concorrência ao atualizar produto {Id}", produto.Id);
            throw new InvalidOperationException($"Versão desatualizada para produto {produto.Id} - conflito de concorrência detectado");
        }
    }

    private Produto MapToProduto(Dictionary<string, AttributeValue> item)
    {
        return Produto.Rehydrate(
            Guid.Parse(item["id"].S),
            item["sku"].S,
            item["nome"].S,
            int.Parse(item["saldo"].N),
            item["ativo"].BOOL,
            DateTime.Parse(item["data_criacao"].S),
            uint.Parse(item["versao"].N));
    }
}

/// <summary>
/// Repositório DynamoDB para Reservas de Estoque
/// </summary>
public class RepositorioDynamoDBReservas : IRepositorioReservas
{
    private readonly IAmazonDynamoDB _client;
    private readonly string _tableName;
    private readonly string _eventsTableName;
    private readonly ILogger<RepositorioDynamoDBReservas> _logger;

    public RepositorioDynamoDBReservas(
        IAmazonDynamoDB client,
        string tableName,
        ILogger<RepositorioDynamoDBReservas> logger)
        : this(client, tableName, string.Empty, logger)
    {
    }

    public RepositorioDynamoDBReservas(
        IAmazonDynamoDB client,
        string tableName,
        string eventsTableName,
        ILogger<RepositorioDynamoDBReservas> logger)
    {
        _client = client;
        _tableName = tableName;
        _eventsTableName = eventsTableName;
        _logger = logger;
    }

    public async Task<ReservaEstoque?> BuscarPorIdAsync(Guid id, CancellationToken ct = default)
    {
        var request = new GetItemRequest
        {
            TableName = _tableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue($"RESERVA#{id}"),
                ["SK"] = new AttributeValue("#METADATA")
            },
            // Leitura forte: usada na checagem de idempotencia logo apos um retry.
            ConsistentRead = true
        };

        var response = await _client.GetItemAsync(request, ct);

        if (!response.IsItemSet || response.Item.Count == 0)
            return null;

        return MapToReserva(response.Item);
    }

    public async Task<List<ReservaEstoque>> ListarPorNotaAsync(Guid notaId, CancellationToken ct = default)
    {
        var request = new QueryRequest
        {
            TableName = _tableName,
            IndexName = "GSI1",
            KeyConditionExpression = "GSI1_PK = :pk",
            FilterExpression = "entity_type = :entity_type",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":pk"] = new AttributeValue($"NOTA#{notaId}"),
                [":entity_type"] = new AttributeValue("RESERVA")
            }
        };

        var response = await _client.QueryAsync(request, ct);
        var reservas = new List<ReservaEstoque>();

        foreach (var item in response.Items)
        {
            reservas.Add(MapToReserva(item));
        }

        return reservas;
    }

    internal static Dictionary<string, AttributeValue> CriarItemReserva(ReservaEstoque reserva) => new()
    {
            ["PK"] = new AttributeValue($"RESERVA#{reserva.Id}"),
            ["SK"] = new AttributeValue("#METADATA"),
            ["GSI1_PK"] = new AttributeValue($"NOTA#{reserva.NotaId}"),
            ["GSI2_PK"] = new AttributeValue($"STATUS#{reserva.Status}"),
            ["GSI2_SK"] = new AttributeValue(reserva.DataCriacao.ToString("o")),
            ["entity_type"] = new AttributeValue("RESERVA"),
            ["id"] = new AttributeValue(reserva.Id.ToString()),
            ["nota_id"] = new AttributeValue(reserva.NotaId.ToString()),
            ["produto_id"] = new AttributeValue(reserva.ProdutoId.ToString()),
            ["quantidade"] = new AttributeValue { N = reserva.Quantidade.ToString() },
            ["status"] = new AttributeValue(reserva.Status),
            ["data_criacao"] = new AttributeValue(reserva.DataCriacao.ToString("o"))
    };

    public async Task SalvarReservaAsync(ReservaEstoque reserva, CancellationToken ct = default)
    {
        var request = new PutItemRequest
        {
            TableName = _tableName,
            Item = CriarItemReserva(reserva)
        };

        await _client.PutItemAsync(request, ct);
        _logger.LogInformation("[RepositorioDynamoDB] Reserva {Id} salva para nota {NotaId}", reserva.Id, reserva.NotaId);
    }

    public async Task<bool> ReservarComBaixaAtomicaAsync(
        ReservaEstoque reserva,
        Produto produtoDebitado,
        EventoOutbox evento,
        CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_eventsTableName))
            throw new InvalidOperationException("Tabela de eventos nao configurada para a reserva atomica.");

        var request = new TransactWriteItemsRequest
        {
            TransactItems =
            [
                // 0: reserva - Id deterministico por (nota, produto); existir = retry.
                new TransactWriteItem
                {
                    Put = new Put
                    {
                        TableName = _tableName,
                        Item = CriarItemReserva(reserva),
                        ConditionExpression = "attribute_not_exists(PK)"
                    }
                },
                // 1: baixa do produto com controle otimista de versao.
                new TransactWriteItem
                {
                    Update = RepositorioDynamoDBProdutos.CriarUpdateProduto(_tableName, produtoDebitado)
                },
                // 2: evento de outbox na mesma transacao (nada de evento sem baixa ou baixa sem evento).
                new TransactWriteItem
                {
                    Put = new Put
                    {
                        TableName = _eventsTableName,
                        Item = RepositorioDynamoDBEventos.CriarItemOutbox(evento)
                    }
                }
            ]
        };

        try
        {
            await _client.TransactWriteItemsAsync(request, ct);
            _logger.LogInformation("[RepositorioDynamoDB] Reserva {Id} gravada atomicamente para nota {NotaId}", reserva.Id, reserva.NotaId);
            return true;
        }
        catch (TransactionCanceledException ex)
        {
            var motivos = ex.CancellationReasons ?? [];
            if (motivos.Count > 0 && motivos[0].Code == "ConditionalCheckFailed")
            {
                _logger.LogInformation("[RepositorioDynamoDB] Reserva {Id} ja existia; nenhuma baixa aplicada", reserva.Id);
                return false;
            }

            if (motivos.Count > 1 && motivos[1].Code == "ConditionalCheckFailed")
            {
                throw new InvalidOperationException(
                    $"Versão desatualizada para produto {produtoDebitado.Id} - conflito de concorrência detectado", ex);
            }

            throw;
        }
    }

    private ReservaEstoque MapToReserva(Dictionary<string, AttributeValue> item)
    {
        return new ReservaEstoque
        {
            Id = Guid.Parse(item["id"].S),
            NotaId = Guid.Parse(item["nota_id"].S),
            ProdutoId = Guid.Parse(item["produto_id"].S),
            Quantidade = int.Parse(item["quantidade"].N),
            Status = item["status"].S,
            DataCriacao = DateTime.Parse(item["data_criacao"].S)
        };
    }
}

/// <summary>
/// Repositório DynamoDB para Eventos (Outbox + Idempotency)
/// </summary>
public class RepositorioDynamoDBEventos : IRepositorioEventos
{
    private readonly IAmazonDynamoDB _client;
    private readonly string _eventsTableName;
    private readonly ILogger<RepositorioDynamoDBEventos> _logger;

    public RepositorioDynamoDBEventos(
        IAmazonDynamoDB client,
        string eventsTableName,
        ILogger<RepositorioDynamoDBEventos> logger)
    {
        _client = client;
        _eventsTableName = eventsTableName;
        _logger = logger;
    }

    internal static Dictionary<string, AttributeValue> CriarItemOutbox(EventoOutbox evento)
    {
        var ttl = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();

        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new AttributeValue($"OUTBOX#{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}"),
            // SK unico por evento. Antes era evento.Id (sempre 0): dois eventos no
            // mesmo segundo tinham a mesma chave e o segundo sobrescrevia o primeiro.
            ["SK"] = new AttributeValue(Guid.NewGuid().ToString()),
            ["TTL"] = new AttributeValue { N = ttl.ToString() },
            ["tipo_evento"] = new AttributeValue(evento.TipoEvento),
            ["id_agregado"] = new AttributeValue(evento.IdAgregado.ToString()),
            ["payload"] = new AttributeValue(evento.Payload),
            ["data_ocorrencia"] = new AttributeValue(evento.DataOcorrencia.ToString("o")),
            ["tentativas_envio"] = new AttributeValue { N = evento.TentativasEnvio.ToString() }
        };

        if (evento.DataPublicacao.HasValue)
        {
            item["data_publicacao"] = new AttributeValue(evento.DataPublicacao.Value.ToString("o"));
        }

        if (!string.IsNullOrWhiteSpace(evento.CorrelationId))
        {
            item["correlation_id"] = new AttributeValue(evento.CorrelationId);
        }

        return item;
    }

    public async Task SalvarEventoOutboxAsync(EventoOutbox evento, CancellationToken ct = default)
    {
        var request = new PutItemRequest
        {
            TableName = _eventsTableName,
            Item = CriarItemOutbox(evento)
        };

        await _client.PutItemAsync(request, ct);
        _logger.LogInformation("[RepositorioDynamoDB] Evento {Tipo} salvo no outbox", evento.TipoEvento);
    }

    public async Task MarcarMensagemProcessadaAsync(string idMensagem, CancellationToken ct = default)
    {
        var ttl = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();

        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new AttributeValue($"IDEM#{idMensagem}"),
            ["SK"] = new AttributeValue("#METADATA"),
            ["TTL"] = new AttributeValue { N = ttl.ToString() },
            ["id_mensagem"] = new AttributeValue(idMensagem),
            ["data_processada"] = new AttributeValue(DateTime.UtcNow.ToString("o"))
        };

        var request = new PutItemRequest
        {
            TableName = _eventsTableName,
            Item = item,
            ConditionExpression = "attribute_not_exists(PK)"
        };

        try
        {
            await _client.PutItemAsync(request, ct);
            _logger.LogDebug("[RepositorioDynamoDB] Mensagem {Id} marcada como processada", idMensagem);
        }
        catch (ConditionalCheckFailedException)
        {
            _logger.LogWarning("[RepositorioDynamoDB] Mensagem {Id} já foi processada anteriormente", idMensagem);
        }
    }

    public async Task<bool> MensagemJaProcessadaAsync(string idMensagem, CancellationToken ct = default)
    {
        var request = new GetItemRequest
        {
            TableName = _eventsTableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue($"IDEM#{idMensagem}"),
                ["SK"] = new AttributeValue("#METADATA")
            }
        };

        var response = await _client.GetItemAsync(request, ct);
        return response.IsItemSet && response.Item.Count > 0;
    }
}
