using Xunit;
using Microsoft.Extensions.Logging;
using Moq;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Tests.Aplicacao;

public class ReservarEstoqueHandlerTests
{
    private readonly Mock<IRepositorioProdutos> _repoProdutos = new();
    private readonly Mock<IRepositorioReservas> _repoReservas = new();
    private readonly Mock<IRepositorioEventos> _repoEventos = new();
    private readonly Mock<ILogger<ReservarEstoqueHandler>> _logger = new();

    private ReservarEstoqueHandler CriarHandler() => new(
        _repoProdutos.Object,
        _repoReservas.Object,
        _repoEventos.Object,
        _logger.Object);

    [Fact]
    public async Task Executar_ComProdutoESaldoSuficiente_RetornaSucesso()
    {
        var notaId = Guid.NewGuid();
        var produtoId = Guid.NewGuid();
        var produto = new Produto("SKU-001", "Produto Teste", 50);

        _repoProdutos.Setup(r => r.BuscarPorIdAsync(produtoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);
        _repoProdutos.Setup(r => r.AtualizarProdutoAsync(produto, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _repoReservas.Setup(r => r.SalvarReservaAsync(It.IsAny<ReservaEstoque>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _repoEventos.Setup(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var handler = CriarHandler();
        var cmd = new ReservarEstoqueCommand(notaId, produtoId, 10);

        var resultado = await handler.Executar(cmd);

        Assert.True(resultado.EhSucesso);
        Assert.NotNull(resultado.Dados);
        Assert.Equal(notaId, resultado.Dados!.NotaId);
        Assert.Equal(produtoId, resultado.Dados.ProdutoId);
        Assert.Equal("RESERVADO", resultado.Dados.Status);
    }

    [Fact]
    public async Task Executar_ComProdutoNaoEncontrado_RetornaFalha()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 10);
        _repoProdutos.Setup(r => r.BuscarPorIdAsync(cmd.ProdutoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Produto?)null);

        var resultado = await CriarHandler().Executar(cmd);

        Assert.True(resultado.Falhou);
        Assert.Contains("nao encontrado", resultado.Mensagem, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Executar_ComSaldoInsuficiente_RetornaFalhaESalvaEventoRejeicao()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 100);
        var produto = new Produto("SKU-001", "Produto", 5); // saldo 5, pedido 100

        _repoProdutos.Setup(r => r.BuscarPorIdAsync(cmd.ProdutoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);
        _repoEventos.Setup(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var resultado = await CriarHandler().Executar(cmd);

        Assert.True(resultado.Falhou);
        _repoEventos.Verify(r => r.SalvarEventoOutboxAsync(
            It.Is<EventoOutbox>(e => e.TipoEvento == "Estoque.ReservaRejeitada"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Executar_ComSucesso_SalvaEventoEstoqueReservado()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 5);
        var produto = new Produto("SKU-001", "Produto", 50);

        _repoProdutos.Setup(r => r.BuscarPorIdAsync(cmd.ProdutoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);
        _repoProdutos.Setup(r => r.AtualizarProdutoAsync(produto, It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _repoReservas.Setup(r => r.SalvarReservaAsync(It.IsAny<ReservaEstoque>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        _repoEventos.Setup(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        await CriarHandler().Executar(cmd);

        _repoEventos.Verify(r => r.SalvarEventoOutboxAsync(
            It.Is<EventoOutbox>(e => e.TipoEvento == "Estoque.Reservado"),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
