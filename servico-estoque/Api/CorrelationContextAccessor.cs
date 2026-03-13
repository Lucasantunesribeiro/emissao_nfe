using System.Threading;

namespace ServicoEstoque.Api;

public interface ICorrelationContextAccessor
{
    string? CorrelationId { get; set; }
}

public sealed class CorrelationContextAccessor : ICorrelationContextAccessor
{
    private static readonly AsyncLocal<string?> CurrentCorrelationId = new();

    public string? CorrelationId
    {
        get => CurrentCorrelationId.Value;
        set => CurrentCorrelationId.Value = value;
    }
}
