namespace ServicoEstoque.Api;

public record ApiErroResponse(string Erro);

public record ApiMensagemResponse(string Message, string? Schema = null);

public record ReservaResponse(bool Sucesso, Guid? ReservaId = null, string? Mensagem = null, string? Erro = null);
