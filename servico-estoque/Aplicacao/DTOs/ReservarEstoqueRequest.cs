using System.ComponentModel.DataAnnotations;

namespace ServicoEstoque.Aplicacao.DTOs;

public record ReservarEstoqueRequest(
    [property: Required] Guid NotaId,
    [property: Required] Guid ProdutoId,
    [property: Range(1, int.MaxValue)] int Quantidade
);
