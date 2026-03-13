using System.ComponentModel.DataAnnotations;

namespace ServicoEstoque.Dominio.Entidades;

public sealed class Produto
{
    private Produto() { }

    public Produto(string sku, string nome, int saldoInicial)
    {
        Id = Guid.NewGuid();
        Sku = sku ?? throw new ArgumentNullException(nameof(sku));
        Nome = nome ?? throw new ArgumentNullException(nameof(nome));
        Saldo = saldoInicial >= 0 ? saldoInicial : throw new ArgumentException("Saldo deve ser >= 0");
        DataCriacao = DateTime.UtcNow;
        Ativo = true;
    }

    public Guid Id { get; private set; }
    public string Sku { get; private set; } = null!;
    public string Nome { get; private set; } = null!;
    public int Saldo { get; private set; }
    public bool Ativo { get; private set; }
    public DateTime DataCriacao { get; private set; }

    [Timestamp]
    public uint Versao { get; private set; }

    public static Produto Rehydrate(
        Guid id,
        string sku,
        string nome,
        int saldo,
        bool ativo,
        DateTime dataCriacao,
        uint versao)
    {
        if (id == Guid.Empty) throw new ArgumentException("Id inválido.", nameof(id));
        if (string.IsNullOrWhiteSpace(sku)) throw new ArgumentException("SKU é obrigatório.", nameof(sku));
        if (string.IsNullOrWhiteSpace(nome)) throw new ArgumentException("Nome é obrigatório.", nameof(nome));
        if (saldo < 0) throw new ArgumentOutOfRangeException(nameof(saldo), "Saldo deve ser >= 0.");

        return new Produto
        {
            Id = id,
            Sku = sku,
            Nome = nome,
            Saldo = saldo,
            Ativo = ativo,
            DataCriacao = dataCriacao,
            Versao = versao,
        };
    }

    public Resultado DebitarEstoque(int qtd)
    {
        if (qtd <= 0)
            return Resultado.Falha("Quantidade deve ser positiva");

        if (!Ativo)
            return Resultado.Falha("Produto inativo");

        if (Saldo < qtd)
            return Resultado.Falha($"Saldo insuficiente. Disponível: {Saldo}, Solicitado: {qtd}");

        Saldo -= qtd;
        return Resultado.Sucesso();
    }

    public void AtualizarSaldo(int novoSaldo)
    {
        if (novoSaldo < 0) throw new InvalidOperationException("Saldo negativo");
        Saldo = novoSaldo;
    }

    public void Desativar() => Ativo = false;
    public void Ativar() => Ativo = true;
}

public class Resultado
{
    public bool EhSucesso { get; }
    public string? Mensagem { get; }
    public bool Falhou => !EhSucesso;

    private Resultado(bool sucesso, string? msg = null)
    {
        EhSucesso = sucesso;
        Mensagem = msg;
    }

    public static Resultado Sucesso() => new(true);
    public static Resultado Falha(string msg) => new(false, msg);
}

public class Resultado<T>
{
    public bool EhSucesso { get; }
    public T? Dados { get; }
    public string? Mensagem { get; }
    public bool Falhou => !EhSucesso;

    private Resultado(bool sucesso, T? dados, string? msg = null)
    {
        EhSucesso = sucesso;
        Dados = dados;
        Mensagem = msg;
    }

    public static Resultado<T> Sucesso(T dados) => new(true, dados);
    public static Resultado<T> Falha(string msg) => new(false, default, msg);
}
