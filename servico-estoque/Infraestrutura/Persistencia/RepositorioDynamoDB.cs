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

    public async Task AtualizarProdutoAsync(Produto produto, CancellationToken ct = default)
    {
        var request = new UpdateItemRequest
        {
            TableName = _tableName,
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
        // Use reflection to create Produto bypassing constructor validation
        var produto = (Produto)System.Runtime.Serialization.FormatterServices.GetUninitializedObject(typeof(Produto));

        typeof(Produto).GetProperty("Id")!.SetValue(produto, Guid.Parse(item["id"].S));
        typeof(Produto).GetProperty("Sku")!.SetValue(produto, item["sku"].S);
        typeof(Produto).GetProperty("Nome")!.SetValue(produto, item["nome"].S);
        typeof(Produto).GetProperty("Saldo")!.SetValue(produto, int.Parse(item["saldo"].N));
        typeof(Produto).GetProperty("Ativo")!.SetValue(produto, item["ativo"].BOOL);
        typeof(Produto).GetProperty("DataCriacao")!.SetValue(produto, DateTime.Parse(item["data_criacao"].S));
        typeof(Produto).GetProperty("Versao")!.SetValue(produto, uint.Parse(item["versao"].N));

        return produto;
    }
}

/// <summary>
/// Repositório DynamoDB para Reservas de Estoque
/// </summary>
public class RepositorioDynamoDBReservas : IRepositorioReservas
{
    private readonly IAmazonDynamoDB _client;
    private readonly string _tableName;
    private readonly ILogger<RepositorioDynamoDBReservas> _logger;

    public RepositorioDynamoDBReservas(
        IAmazonDynamoDB client,
        string tableName,
        ILogger<RepositorioDynamoDBReservas> logger)
    {
        _client = client;
        _tableName = tableName;
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
            }
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

    public async Task SalvarReservaAsync(ReservaEstoque reserva, CancellationToken ct = default)
    {
        var item = new Dictionary<string, AttributeValue>
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

        var request = new PutItemRequest
        {
            TableName = _tableName,
            Item = item
        };

        await _client.PutItemAsync(request, ct);
        _logger.LogInformation("[RepositorioDynamoDB] Reserva {Id} salva para nota {NotaId}", reserva.Id, reserva.NotaId);
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

    public async Task SalvarEventoOutboxAsync(EventoOutbox evento, CancellationToken ct = default)
    {
        var ttl = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeSeconds();

        var item = new Dictionary<string, AttributeValue>
        {
            ["PK"] = new AttributeValue($"OUTBOX#{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}"),
            ["SK"] = new AttributeValue(evento.Id.ToString()),
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

        var request = new PutItemRequest
        {
            TableName = _eventsTableName,
            Item = item
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
