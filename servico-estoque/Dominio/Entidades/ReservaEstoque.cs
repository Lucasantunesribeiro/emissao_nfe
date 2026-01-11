namespace ServicoEstoque.Dominio.Entidades;

public class ReservaEstoque
{
    public Guid Id { get; set; }
    public Guid NotaId { get; set; }
    public Guid ProdutoId { get; set; }
    public int Quantidade { get; set; }
    public string Status { get; set; } = null!; // RESERVADO, CANCELADO
    public DateTime DataCriacao { get; set; }

    public Produto? Produto { get; set; }
}