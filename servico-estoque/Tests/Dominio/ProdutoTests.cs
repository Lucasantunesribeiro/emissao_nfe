using Xunit;
using ServicoEstoque.Dominio.Entidades;

namespace ServicoEstoque.Tests.Dominio;

public class ProdutoTests
{
    [Fact]
    public void Construtor_ComDadosValidos_CriaProduto()
    {
        var produto = new Produto("SKU-001", "Produto Teste", 100);

        Assert.Equal("SKU-001", produto.Sku);
        Assert.Equal("Produto Teste", produto.Nome);
        Assert.Equal(100, produto.Saldo);
        Assert.True(produto.Ativo);
        Assert.NotEqual(Guid.Empty, produto.Id);
    }

    [Fact]
    public void Construtor_ComSaldoNegativo_LancaExcecao()
    {
        Assert.Throws<ArgumentException>(() => new Produto("SKU-001", "Teste", -1));
    }

    [Fact]
    public void Construtor_ComSkuNulo_LancaExcecao()
    {
        Assert.Throws<ArgumentNullException>(() => new Produto(null!, "Teste", 10));
    }

    [Fact]
    public void DebitarEstoque_ComSaldoSuficiente_RetornaSucesso()
    {
        var produto = new Produto("SKU-001", "Produto", 50);

        var resultado = produto.DebitarEstoque(20);

        Assert.True(resultado.EhSucesso);
        Assert.Equal(30, produto.Saldo);
    }

    [Fact]
    public void DebitarEstoque_ComSaldoInsuficiente_RetornaFalha()
    {
        var produto = new Produto("SKU-001", "Produto", 10);

        var resultado = produto.DebitarEstoque(20);

        Assert.True(resultado.Falhou);
        Assert.Contains("insuficiente", resultado.Mensagem, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(10, produto.Saldo); // saldo não alterado
    }

    [Fact]
    public void DebitarEstoque_ComQuantidadeZero_RetornaFalha()
    {
        var produto = new Produto("SKU-001", "Produto", 50);

        var resultado = produto.DebitarEstoque(0);

        Assert.True(resultado.Falhou);
    }

    [Fact]
    public void DebitarEstoque_ComQuantidadeNegativa_RetornaFalha()
    {
        var produto = new Produto("SKU-001", "Produto", 50);

        var resultado = produto.DebitarEstoque(-5);

        Assert.True(resultado.Falhou);
    }

    [Fact]
    public void DebitarEstoque_ProdutoInativo_RetornaFalha()
    {
        var produto = new Produto("SKU-001", "Produto", 50);
        produto.Desativar();

        var resultado = produto.DebitarEstoque(10);

        Assert.True(resultado.Falhou);
        Assert.Contains("inativo", resultado.Mensagem, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void DebitarEstoque_ExatamenteOSaldo_RetornaSucesso()
    {
        var produto = new Produto("SKU-001", "Produto", 30);

        var resultado = produto.DebitarEstoque(30);

        Assert.True(resultado.EhSucesso);
        Assert.Equal(0, produto.Saldo);
    }

    [Fact]
    public void Desativar_Ativar_AlteraStatus()
    {
        var produto = new Produto("SKU-001", "Produto", 10);

        produto.Desativar();
        Assert.False(produto.Ativo);

        produto.Ativar();
        Assert.True(produto.Ativo);
    }

    [Fact]
    public void AtualizarSaldo_ComValorNegativo_LancaExcecao()
    {
        var produto = new Produto("SKU-001", "Produto", 10);

        Assert.Throws<InvalidOperationException>(() => produto.AtualizarSaldo(-1));
    }

    [Fact]
    public void Resultado_Sucesso_EhSucessoTrue()
    {
        var resultado = Resultado.Sucesso();
        Assert.True(resultado.EhSucesso);
        Assert.False(resultado.Falhou);
        Assert.Null(resultado.Mensagem);
    }

    [Fact]
    public void Resultado_Falha_FalhouTrue()
    {
        var resultado = Resultado.Falha("erro teste");
        Assert.False(resultado.EhSucesso);
        Assert.True(resultado.Falhou);
        Assert.Equal("erro teste", resultado.Mensagem);
    }
}
