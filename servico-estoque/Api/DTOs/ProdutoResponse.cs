namespace ServicoEstoque.Api.DTOs;

public sealed record ProdutoResponse(
    Guid Id,
    string Sku,
    string Nome,
    int Saldo,
    bool Ativo,
    DateTime DataCriacao,
    uint Versao);
