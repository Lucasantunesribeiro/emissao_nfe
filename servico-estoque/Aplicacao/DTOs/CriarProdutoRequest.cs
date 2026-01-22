using System.ComponentModel.DataAnnotations;

namespace ServicoEstoque.Aplicacao.DTOs;

public record CriarProdutoRequest(
    [property: Required, StringLength(50, MinimumLength = 1)] string Sku,
    [property: Required, StringLength(200, MinimumLength = 2)] string Nome,
    [property: Range(0, int.MaxValue)] int Saldo
);
