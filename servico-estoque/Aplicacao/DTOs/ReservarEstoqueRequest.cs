namespace ServicoEstoque.Aplicacao.DTOs;

public record ReservarEstoqueRequest(
    Guid NotaId,
    Guid ProdutoId,
    int Quantidade
);