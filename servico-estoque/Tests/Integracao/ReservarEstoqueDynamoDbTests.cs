using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.Runtime;
using Microsoft.Extensions.Logging.Abstractions;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Api;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;
using Xunit;

namespace ServicoEstoque.Tests.Integracao;

public sealed class ReservarEstoqueDynamoDbTests : IClassFixture<DynamoDbLocalFixture>
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly DynamoDbLocalFixture _fixture;

    public ReservarEstoqueDynamoDbTests(DynamoDbLocalFixture fixture)
    {
        _fixture = fixture;
    }

    [Fact]
    public async Task Executar_ComDynamoDbLocal_DevePersistirReservaProdutoEEventoOutbox()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-001", "Produto Integracao", 10);
        var notaId = Guid.NewGuid();
        const string correlationId = "it-correlation-success";

        await context.RepositorioProdutos.SalvarProdutoAsync(produto);

        context.CorrelationAccessor.CorrelationId = correlationId;

        var resultado = await context.Handler.Executar(
            new ReservarEstoqueCommand(notaId, produto.Id, 3));

        Assert.True(resultado.EhSucesso);
        Assert.NotNull(resultado.Dados);

        var produtoAtualizado = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        var reservas = await context.RepositorioReservas.ListarPorNotaAsync(notaId);
        var eventos = await context.ListarEventosPorAgregadoAsync(notaId);

        Assert.NotNull(produtoAtualizado);
        Assert.Equal(7, produtoAtualizado!.Saldo);
        Assert.Equal((uint)1, produtoAtualizado.Versao);

        var reserva = Assert.Single(reservas);
        Assert.Equal(produto.Id, reserva.ProdutoId);
        Assert.Equal(3, reserva.Quantidade);
        Assert.Equal("RESERVADO", reserva.Status);

        var evento = Assert.Single(eventos);
        Assert.Equal("Estoque.Reservado", evento["tipo_evento"].S);
        Assert.Equal(notaId.ToString(), evento["id_agregado"].S);
        Assert.Equal(correlationId, evento["correlation_id"].S);

        var payload = JsonSerializer.Deserialize<EventoReservaSucessoPayload>(evento["payload"].S, JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal(notaId, payload!.NotaId);
        Assert.Equal(correlationId, payload.CorrelationId);
        Assert.Single(payload.Itens);
        Assert.Equal(produto.Id, payload.Itens[0].ProdutoId);
        Assert.Equal(3, payload.Itens[0].Quantidade);
    }

    [Fact]
    public async Task Executar_ComSaldoInsuficiente_DevePersistirRejeicaoSemCriarReserva()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-002", "Produto Integracao", 2);
        var notaId = Guid.NewGuid();
        const string correlationId = "it-correlation-rejection";

        await context.RepositorioProdutos.SalvarProdutoAsync(produto);

        context.CorrelationAccessor.CorrelationId = correlationId;

        var resultado = await context.Handler.Executar(
            new ReservarEstoqueCommand(notaId, produto.Id, 5));

        Assert.True(resultado.Falhou);
        Assert.Contains("Saldo insuficiente", resultado.Mensagem, StringComparison.OrdinalIgnoreCase);

        var produtoPersistido = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        var reservas = await context.RepositorioReservas.ListarPorNotaAsync(notaId);
        var eventos = await context.ListarEventosPorAgregadoAsync(notaId);

        Assert.NotNull(produtoPersistido);
        Assert.Equal(2, produtoPersistido!.Saldo);
        Assert.Empty(reservas);

        var evento = Assert.Single(eventos);
        Assert.Equal("Estoque.ReservaRejeitada", evento["tipo_evento"].S);
        Assert.Equal(notaId.ToString(), evento["id_agregado"].S);
        Assert.Equal(correlationId, evento["correlation_id"].S);

        var payload = JsonSerializer.Deserialize<EventoReservaRejeitadaPayload>(evento["payload"].S, JsonOptions);
        Assert.NotNull(payload);
        Assert.Equal(notaId, payload!.NotaId);
        Assert.Equal(correlationId, payload.CorrelationId);
    }
    [Fact]
    public async Task AtualizarProduto_AposBaixaFeitaPeloConsumerGo_DeveDetectarConflitoDeVersao()
    {
        // Contrato entre servicos: o consumer Go (servico-faturamento) debita
        // `saldo` e incrementa `versao` na mesma linha PRODUTO#<id>. Sem o
        // incremento, esta escrita do .NET com dados lidos antes da baixa
        // sobrescreveria o saldo (lost update).
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-003", "Produto Concorrencia", 10);
        await context.RepositorioProdutos.SalvarProdutoAsync(produto);

        var lidoPeloDotNet = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.NotNull(lidoPeloDotNet);

        // Mesma expressao usada por servico-faturamento/internal/repositorio/reserva_estoque.go
        await context.Client.UpdateItemAsync(new UpdateItemRequest
        {
            TableName = context.ProdutosTableName,
            Key = new Dictionary<string, AttributeValue>
            {
                ["PK"] = new AttributeValue($"PRODUTO#{produto.Id}"),
                ["SK"] = new AttributeValue("#METADATA")
            },
            UpdateExpression = "SET saldo = saldo - :qty ADD versao :um",
            ConditionExpression = "attribute_exists(PK) AND saldo >= :qty AND (attribute_not_exists(ativo) OR ativo = :ativo)",
            ExpressionAttributeValues = new Dictionary<string, AttributeValue>
            {
                [":qty"] = new AttributeValue { N = "4" },
                [":um"] = new AttributeValue { N = "1" },
                [":ativo"] = new AttributeValue { BOOL = true }
            }
        });

        Assert.True(lidoPeloDotNet!.DebitarEstoque(1).EhSucesso);
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(
            () => context.RepositorioProdutos.AtualizarProdutoAsync(lidoPeloDotNet));
        Assert.Contains("Versão desatualizada", ex.Message);

        var atual = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.Equal(6, atual!.Saldo);
        Assert.Equal((uint)1, atual.Versao);
    }

    [Fact]
    public async Task Executar_RetryDaMesmaReserva_DebitaUmaUnicaVez()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-004", "Produto Retry", 10);
        await context.RepositorioProdutos.SalvarProdutoAsync(produto);
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), produto.Id, 3);

        var primeira = await context.Handler.Executar(cmd);
        var retry = await context.Handler.Executar(cmd);

        Assert.True(primeira.EhSucesso);
        Assert.True(retry.EhSucesso);
        Assert.Equal(primeira.Dados!.Id, retry.Dados!.Id);

        var atual = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.Equal(7, atual!.Saldo);
        Assert.Single(await context.RepositorioReservas.ListarPorNotaAsync(cmd.NotaId));
        var evento = Assert.Single(await context.ListarEventosPorAgregadoAsync(cmd.NotaId));
        Assert.Equal("Estoque.Reservado", evento["tipo_evento"].S);
    }

    [Fact]
    public async Task Executar_MesmaNotaEProdutoComOutraQuantidade_NaoDebitaDeNovo()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-005", "Produto Quantidade", 10);
        await context.RepositorioProdutos.SalvarProdutoAsync(produto);
        var notaId = Guid.NewGuid();

        Assert.True((await context.Handler.Executar(new ReservarEstoqueCommand(notaId, produto.Id, 3))).EhSucesso);
        var divergente = await context.Handler.Executar(new ReservarEstoqueCommand(notaId, produto.Id, 5));

        Assert.True(divergente.Falhou);
        var atual = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.Equal(7, atual!.Saldo);
    }

    [Fact]
    public async Task Executar_RequisicoesIdenticasConcorrentes_NuncaDebitamMaisDeUmaVez()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-006", "Produto Concorrente", 10);
        await context.RepositorioProdutos.SalvarProdutoAsync(produto);
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), produto.Id, 4);

        var resultados = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => context.Handler.Executar(cmd)));

        Assert.Contains(resultados, r => r.EhSucesso);
        var atual = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.Equal(6, atual!.Saldo);
        Assert.Single(await context.RepositorioReservas.ListarPorNotaAsync(cmd.NotaId));
        Assert.Single(
            await context.ListarEventosPorAgregadoAsync(cmd.NotaId),
            e => e["tipo_evento"].S == "Estoque.Reservado");
    }

    [Fact]
    public async Task Executar_ComDemoFail_NaoDebitaNemGravaReserva()
    {
        await using var context = await _fixture.CreateContextAsync();

        var produto = new Produto("SKU-IT-007", "Produto Demo", 10);
        await context.RepositorioProdutos.SalvarProdutoAsync(produto);
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), produto.Id, 2);

        var resultado = await context.Handler.Executar(cmd, simularFalha: true);

        Assert.True(resultado.Falhou);
        var atual = await context.RepositorioProdutos.BuscarPorIdAsync(produto.Id);
        Assert.Equal(10, atual!.Saldo);
        Assert.Empty(await context.RepositorioReservas.ListarPorNotaAsync(cmd.NotaId));
        var evento = Assert.Single(await context.ListarEventosPorAgregadoAsync(cmd.NotaId));
        Assert.Equal("Estoque.ReservaRejeitada", evento["tipo_evento"].S);
    }

    [Fact]
    public async Task SalvarEventoOutbox_DoisEventosNoMesmoSegundo_NaoSobrescreve()
    {
        await using var context = await _fixture.CreateContextAsync();
        var repoEventos = new RepositorioDynamoDBEventos(
            context.Client, context.EventosTableName, NullLogger<RepositorioDynamoDBEventos>.Instance);
        var notaA = Guid.NewGuid();
        var notaB = Guid.NewGuid();

        foreach (var nota in new[] { notaA, notaB })
        {
            await repoEventos.SalvarEventoOutboxAsync(new EventoOutbox
            {
                TipoEvento = "Estoque.ReservaRejeitada",
                IdAgregado = nota,
                Payload = "{}",
                DataOcorrencia = DateTime.UtcNow
            });
        }

        Assert.Single(await context.ListarEventosPorAgregadoAsync(notaA));
        Assert.Single(await context.ListarEventosPorAgregadoAsync(notaB));
    }
}

public sealed class DynamoDbLocalFixture : IAsyncLifetime
{
    private const string DynamoDbLocalDownloadUrl = "https://d1ni2b6xgvw0s0.cloudfront.net/v2.x/dynamodb_local_latest.zip";
    private static readonly HttpClient HttpClient = new();

    private AmazonDynamoDBClient _client = null!;
    private Process _process = null!;
    private int _port;

    public async Task InitializeAsync()
    {
        _port = GetAvailablePort();
        var dynamoDbLocalDirectory = await EnsureDynamoDbLocalAsync();
        var jarPath = Path.Combine(dynamoDbLocalDirectory, "DynamoDBLocal.jar");
        var nativeLibraryPath = Path.Combine(dynamoDbLocalDirectory, "DynamoDBLocal_lib");

        _process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = "java",
                Arguments = $"-D\"java.library.path={nativeLibraryPath}\" -jar \"{jarPath}\" -sharedDb -inMemory -port {_port}",
                WorkingDirectory = dynamoDbLocalDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        if (!_process.Start())
        {
            throw new InvalidOperationException("Nao foi possivel iniciar o processo do DynamoDB Local.");
        }

        _client = new AmazonDynamoDBClient(
            new BasicAWSCredentials("test", "test"),
            new AmazonDynamoDBConfig
            {
                ServiceURL = $"http://127.0.0.1:{_port}",
                UseHttp = true
            });

        await AguardarDynamoDbDisponivelAsync();
    }

    public async Task DisposeAsync()
    {
        _client?.Dispose();

        try
        {
            if (_process is { HasExited: false })
            {
                _process.Kill(entireProcessTree: true);
                await _process.WaitForExitAsync();
            }

            _process?.Dispose();
        }
        catch
        {
            // Nada a fazer no cleanup de teste.
        }
    }

    public async Task<DynamoDbTestContext> CreateContextAsync(CancellationToken cancellationToken = default)
    {
        var produtosTableName = $"estoque-it-{Guid.NewGuid():N}";
        var eventosTableName = $"eventos-it-{Guid.NewGuid():N}";

        await CreateProdutosTableAsync(produtosTableName, cancellationToken);
        await CreateEventosTableAsync(eventosTableName, cancellationToken);

        var correlationAccessor = new CorrelationContextAccessor();
        var repoProdutos = new RepositorioDynamoDBProdutos(_client, produtosTableName, NullLogger<RepositorioDynamoDBProdutos>.Instance);
        var repoReservas = new RepositorioDynamoDBReservas(_client, produtosTableName, eventosTableName, NullLogger<RepositorioDynamoDBReservas>.Instance);
        var repoEventos = new RepositorioDynamoDBEventos(_client, eventosTableName, NullLogger<RepositorioDynamoDBEventos>.Instance);
        var handler = new ReservarEstoqueHandler(
            repoProdutos,
            repoReservas,
            repoEventos,
            NullLogger<ReservarEstoqueHandler>.Instance,
            correlationAccessor);

        return new DynamoDbTestContext(
            _client,
            produtosTableName,
            eventosTableName,
            repoProdutos,
            repoReservas,
            handler,
            correlationAccessor);
    }

    private async Task CreateProdutosTableAsync(string tableName, CancellationToken cancellationToken)
    {
        await _client.CreateTableAsync(
            new CreateTableRequest
            {
                TableName = tableName,
                BillingMode = BillingMode.PAY_PER_REQUEST,
                AttributeDefinitions = new List<AttributeDefinition>
                {
                    new("PK", ScalarAttributeType.S),
                    new("SK", ScalarAttributeType.S),
                    new("GSI1_PK", ScalarAttributeType.S),
                    new("GSI2_PK", ScalarAttributeType.S)
                },
                KeySchema = new List<KeySchemaElement>
                {
                    new("PK", KeyType.HASH),
                    new("SK", KeyType.RANGE)
                },
                GlobalSecondaryIndexes = new List<GlobalSecondaryIndex>
                {
                    new()
                    {
                        IndexName = "GSI1",
                        KeySchema = new List<KeySchemaElement>
                        {
                            new("GSI1_PK", KeyType.HASH)
                        },
                        Projection = new Projection { ProjectionType = ProjectionType.ALL }
                    },
                    new()
                    {
                        IndexName = "GSI2",
                        KeySchema = new List<KeySchemaElement>
                        {
                            new("GSI2_PK", KeyType.HASH)
                        },
                        Projection = new Projection { ProjectionType = ProjectionType.ALL }
                    }
                }
            },
            cancellationToken);

        await AguardarTabelaAtivaAsync(tableName, cancellationToken);
    }

    private async Task CreateEventosTableAsync(string tableName, CancellationToken cancellationToken)
    {
        await _client.CreateTableAsync(
            new CreateTableRequest
            {
                TableName = tableName,
                BillingMode = BillingMode.PAY_PER_REQUEST,
                AttributeDefinitions = new List<AttributeDefinition>
                {
                    new("PK", ScalarAttributeType.S),
                    new("SK", ScalarAttributeType.S)
                },
                KeySchema = new List<KeySchemaElement>
                {
                    new("PK", KeyType.HASH),
                    new("SK", KeyType.RANGE)
                }
            },
            cancellationToken);

        await AguardarTabelaAtivaAsync(tableName, cancellationToken);
    }

    private async Task AguardarTabelaAtivaAsync(string tableName, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 20; attempt++)
        {
            var response = await _client.DescribeTableAsync(new DescribeTableRequest
            {
                TableName = tableName
            }, cancellationToken);

            if (response.Table.TableStatus == TableStatus.ACTIVE)
            {
                return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), cancellationToken);
        }

        throw new TimeoutException($"Tabela {tableName} nao ficou ativa a tempo.");
    }

    private static async Task<string> EnsureDynamoDbLocalAsync()
    {
        var targetDirectory = Path.Combine(Path.GetTempPath(), "emissao-nfe", "tools", "dynamodb-local");
        var jarPath = Path.Combine(targetDirectory, "DynamoDBLocal.jar");

        if (File.Exists(jarPath))
        {
            return targetDirectory;
        }

        Directory.CreateDirectory(targetDirectory);

        var zipPath = Path.Combine(Path.GetTempPath(), $"dynamodb-local-{Guid.NewGuid():N}.zip");

        try
        {
            await using (var sourceStream = await HttpClient.GetStreamAsync(DynamoDbLocalDownloadUrl))
            await using (var destinationStream = File.Create(zipPath))
            {
                await sourceStream.CopyToAsync(destinationStream);
            }

            ZipFile.ExtractToDirectory(zipPath, targetDirectory, overwriteFiles: true);
            return targetDirectory;
        }
        finally
        {
            if (File.Exists(zipPath))
            {
                File.Delete(zipPath);
            }
        }
    }

    private static int GetAvailablePort()
    {
        using var listener = new TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        return ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
    }

    private async Task AguardarDynamoDbDisponivelAsync()
    {
        for (var attempt = 0; attempt < 30; attempt++)
        {
            if (_process.HasExited)
            {
                var stdOut = await _process.StandardOutput.ReadToEndAsync();
                var stdErr = await _process.StandardError.ReadToEndAsync();
                throw new InvalidOperationException(
                    $"DynamoDB Local foi encerrado prematuramente. Saida: {stdOut}. Erro: {stdErr}");
            }

            try
            {
                await _client.ListTablesAsync();
                return;
            }
            catch
            {
                await Task.Delay(TimeSpan.FromSeconds(1));
            }
        }

        var output = await _process.StandardOutput.ReadToEndAsync();
        var error = await _process.StandardError.ReadToEndAsync();
        throw new TimeoutException($"DynamoDB Local nao respondeu dentro do tempo esperado. Saida: {output}. Erro: {error}");
    }
}

public sealed class DynamoDbTestContext : IAsyncDisposable
{
    private readonly IAmazonDynamoDB _client;

    public DynamoDbTestContext(
        IAmazonDynamoDB client,
        string produtosTableName,
        string eventosTableName,
        RepositorioDynamoDBProdutos repositorioProdutos,
        RepositorioDynamoDBReservas repositorioReservas,
        ReservarEstoqueHandler handler,
        CorrelationContextAccessor correlationAccessor)
    {
        _client = client;
        ProdutosTableName = produtosTableName;
        EventosTableName = eventosTableName;
        RepositorioProdutos = repositorioProdutos;
        RepositorioReservas = repositorioReservas;
        Handler = handler;
        CorrelationAccessor = correlationAccessor;
    }

    public string ProdutosTableName { get; }
    public string EventosTableName { get; }
    public RepositorioDynamoDBProdutos RepositorioProdutos { get; }
    public RepositorioDynamoDBReservas RepositorioReservas { get; }
    public ReservarEstoqueHandler Handler { get; }
    public CorrelationContextAccessor CorrelationAccessor { get; }
    public IAmazonDynamoDB Client => _client;

    public async Task<List<Dictionary<string, AttributeValue>>> ListarEventosPorAgregadoAsync(Guid agregadoId, CancellationToken cancellationToken = default)
    {
        var response = await _client.ScanAsync(
            new ScanRequest
            {
                TableName = EventosTableName,
                FilterExpression = "id_agregado = :id",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":id"] = new(agregadoId.ToString())
                }
            },
            cancellationToken);

        return response.Items;
    }

    public async ValueTask DisposeAsync()
    {
        await _client.DeleteTableAsync(ProdutosTableName);
        await _client.DeleteTableAsync(EventosTableName);
    }
}
