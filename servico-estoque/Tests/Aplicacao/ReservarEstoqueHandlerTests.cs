using Xunit;
using Microsoft.Extensions.Logging;
using Moq;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Api;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Tests.Aplicacao;

public class ReservarEstoqueHandlerTests
{
    private readonly Mock<IRepositorioProdutos> _repoProdutos = new();
    private readonly Mock<IRepositorioReservas> _repoReservas = new();
    private readonly Mock<IRepositorioEventos> _repoEventos = new();
    private readonly Mock<ILogger<ReservarEstoqueHandler>> _logger = new();
    private readonly Mock<ICorrelationContextAccessor> _correlationContextAccessor = new();

    private ReservarEstoqueHandler CriarHandler() => new(
        _repoProdutos.Object,
        _repoReservas.Object,
        _repoEventos.Object,
        _logger.Object,
        _correlationContextAccessor.Object);

    [Fact]
    public async Task Executar_ComProdutoESaldoSuficiente_RetornaSucesso()
    {
        var notaId = Guid.NewGuid();
        var produtoId = Guid.NewGuid();
        var produto = new Produto("SKU-001", "Produto Teste", 50);

        _repoProdutos.Setup(r => r.BuscarPorIdAsync(produtoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);
        ConfigurarReservaAtomica(criada: true);
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
        ConfigurarReservaAtomica(criada: true);
        _repoEventos.Setup(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        await CriarHandler().Executar(cmd);

        // O evento de sucesso vai na MESMA transacao da baixa, nao num Put separado.
        _repoReservas.Verify(r => r.ReservarComBaixaAtomicaAsync(
            It.Is<ReservaEstoque>(x => x.Id == ReservaEstoque.GerarId(cmd.NotaId, cmd.ProdutoId) && x.Quantidade == 5),
            It.Is<Produto>(p => p.Saldo == 45),
            It.Is<EventoOutbox>(e => e.TipoEvento == "Estoque.Reservado" && e.IdAgregado == cmd.NotaId),
            It.IsAny<CancellationToken>()), Times.Once);
        _repoEventos.Verify(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task Executar_ReservaJaExistenteMesmaQuantidade_RetornaSucessoSemNovaBaixa()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 3);
        var existente = ReservaExistente(cmd, 3);
        _repoReservas.Setup(r => r.BuscarPorIdAsync(existente.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existente);

        var resultado = await CriarHandler().Executar(cmd);

        Assert.True(resultado.EhSucesso);
        Assert.Equal(existente.Id, resultado.Dados!.Id);
        _repoProdutos.Verify(r => r.BuscarPorIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        VerificarNenhumaEscrita();
    }

    [Fact]
    public async Task Executar_ReservaJaExistenteOutraQuantidade_RetornaFalhaSemNovaBaixa()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 7);
        var existente = ReservaExistente(cmd, 3);
        _repoReservas.Setup(r => r.BuscarPorIdAsync(existente.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(existente);

        var resultado = await CriarHandler().Executar(cmd);

        Assert.True(resultado.Falhou);
        Assert.Contains("quantidade 3", resultado.Mensagem);
        VerificarNenhumaEscrita();
    }

    [Fact]
    public async Task Executar_CorridaComRequisicaoIdentica_DevolveReservaVencedora()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 2);
        var produto = new Produto("SKU-001", "Produto", 10);
        var vencedora = ReservaExistente(cmd, 2);
        _repoProdutos.Setup(r => r.BuscarPorIdAsync(cmd.ProdutoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);
        _repoReservas.SetupSequence(r => r.BuscarPorIdAsync(vencedora.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((ReservaEstoque?)null)
            .ReturnsAsync(vencedora);
        ConfigurarReservaAtomica(criada: false);

        var resultado = await CriarHandler().Executar(cmd);

        Assert.True(resultado.EhSucesso);
        Assert.Equal(vencedora.Id, resultado.Dados!.Id);
    }

    [Fact]
    public async Task Executar_ComDemoFail_NaoGravaNadaAlemDaRejeicao()
    {
        var cmd = new ReservarEstoqueCommand(Guid.NewGuid(), Guid.NewGuid(), 2);
        var produto = new Produto("SKU-001", "Produto", 10);
        _repoProdutos.Setup(r => r.BuscarPorIdAsync(cmd.ProdutoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(produto);

        var resultado = await CriarHandler().Executar(cmd, simularFalha: true);

        Assert.True(resultado.Falhou);
        _repoReservas.Verify(r => r.ReservarComBaixaAtomicaAsync(
            It.IsAny<ReservaEstoque>(), It.IsAny<Produto>(), It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()), Times.Never);
        _repoEventos.Verify(r => r.SalvarEventoOutboxAsync(
            It.Is<EventoOutbox>(e => e.TipoEvento == "Estoque.ReservaRejeitada"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public void GerarId_EhDeterministicoPorNotaEProduto()
    {
        var nota = Guid.NewGuid();
        var produto = Guid.NewGuid();

        Assert.Equal(ReservaEstoque.GerarId(nota, produto), ReservaEstoque.GerarId(nota, produto));
        Assert.NotEqual(ReservaEstoque.GerarId(nota, produto), ReservaEstoque.GerarId(nota, Guid.NewGuid()));
        Assert.NotEqual(ReservaEstoque.GerarId(nota, produto), ReservaEstoque.GerarId(Guid.NewGuid(), produto));
        Assert.NotEqual(ReservaEstoque.GerarId(nota, produto), ReservaEstoque.GerarId(produto, nota));
    }

    private void ConfigurarReservaAtomica(bool criada) =>
        _repoReservas.Setup(r => r.ReservarComBaixaAtomicaAsync(
                It.IsAny<ReservaEstoque>(), It.IsAny<Produto>(), It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(criada);

    private static ReservaEstoque ReservaExistente(ReservarEstoqueCommand cmd, int quantidade) => new()
    {
        Id = ReservaEstoque.GerarId(cmd.NotaId, cmd.ProdutoId),
        NotaId = cmd.NotaId,
        ProdutoId = cmd.ProdutoId,
        Quantidade = quantidade,
        Status = "RESERVADO",
        DataCriacao = DateTime.UtcNow
    };

    private void VerificarNenhumaEscrita()
    {
        _repoReservas.Verify(r => r.ReservarComBaixaAtomicaAsync(
            It.IsAny<ReservaEstoque>(), It.IsAny<Produto>(), It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()), Times.Never);
        _repoProdutos.Verify(r => r.AtualizarProdutoAsync(It.IsAny<Produto>(), It.IsAny<CancellationToken>()), Times.Never);
        _repoEventos.Verify(r => r.SalvarEventoOutboxAsync(It.IsAny<EventoOutbox>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
