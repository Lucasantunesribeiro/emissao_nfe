using System.Security.Cryptography;
using System.Text;

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

    /// <summary>
    /// Id deterministico da reserva de um produto para uma nota.
    /// A mesma (nota, produto) sempre gera o mesmo Id; como a reserva e gravada
    /// com attribute_not_exists(PK), um retry da mesma requisicao nao debita o
    /// estoque de novo (idempotencia por nota+produto).
    /// </summary>
    public static Guid GerarId(Guid notaId, Guid produtoId)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes($"reserva-estoque:{notaId:N}:{produtoId:N}"));
        var bytes = hash.AsSpan(0, 16).ToArray();
        // Marca como UUID versao 8 (definido pela aplicacao), variante RFC 4122.
        bytes[7] = (byte)((bytes[7] & 0x0F) | 0x80);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes);
    }
}
