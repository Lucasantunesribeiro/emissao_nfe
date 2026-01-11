namespace ServicoEstoque.Aplicacao.CasosDeUso;

public record ReservarEstoqueCommand(
    Guid NotaId,
    Guid ProdutoId,
    int Quantidade
);

public record ReservarEstoqueLoteCommand(
    Guid NotaId,
    IReadOnlyCollection<ReservarEstoqueItem> Itens
);

public record ReservarEstoqueItem(
    Guid ProdutoId,
    int Quantidade
);
