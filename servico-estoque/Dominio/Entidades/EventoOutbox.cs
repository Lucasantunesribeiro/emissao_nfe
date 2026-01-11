namespace ServicoEstoque.Dominio.Entidades;

public class EventoOutbox
{
    public long Id { get; set; }
    public string TipoEvento { get; set; } = null!;
    public Guid IdAgregado { get; set; }
    public string Payload { get; set; } = null!;
    public DateTime DataOcorrencia { get; set; }
    public DateTime? DataPublicacao { get; set; }
    public int TentativasEnvio { get; set; }
}