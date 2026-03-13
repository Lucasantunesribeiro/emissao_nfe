using ServicoEstoque.Dominio.Entidades;
using Xunit;

namespace ServicoEstoque.Tests.Infraestrutura;

public class ProdutoRehydrateTests
{
    [Fact]
    public void Rehydrate_ComDadosValidos_DeveReconstruirProdutoSemFormatterServices()
    {
        var id = Guid.NewGuid();
        var dataCriacao = DateTime.UtcNow.AddDays(-2);

        var produto = Produto.Rehydrate(
            id,
            "SKU-123",
            "Produto reidratado",
            15,
            true,
            dataCriacao,
            3);

        Assert.Equal(id, produto.Id);
        Assert.Equal("SKU-123", produto.Sku);
        Assert.Equal("Produto reidratado", produto.Nome);
        Assert.Equal(15, produto.Saldo);
        Assert.True(produto.Ativo);
        Assert.Equal(dataCriacao, produto.DataCriacao);
        Assert.Equal((uint)3, produto.Versao);
    }
}
