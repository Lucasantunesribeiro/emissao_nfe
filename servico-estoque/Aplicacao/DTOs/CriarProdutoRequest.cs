namespace ServicoEstoque.Aplicacao.DTOs;

public record CriarProdutoRequest(
    string Sku,
    string Nome,
    int Saldo
);