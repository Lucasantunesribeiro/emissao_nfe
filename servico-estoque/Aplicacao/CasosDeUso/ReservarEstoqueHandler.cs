using System.Linq;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Aplicacao.CasosDeUso;

public sealed class ReservarEstoqueHandler
{
    private readonly ContextoBancoDados _ctx;
    private readonly ILogger<ReservarEstoqueHandler> _logger;

    public ReservarEstoqueHandler(ContextoBancoDados ctx, ILogger<ReservarEstoqueHandler> logger)
    {
        _ctx = ctx;
        _logger = logger;
    }

    public async Task<Resultado<ReservaEstoque>> Executar(
        ReservarEstoqueCommand cmd,
        bool simularFalha = false,
        CancellationToken ct = default)
    {
        await using var tx = await _ctx.Database.BeginTransactionAsync(ct);

        try
        {
            var produto = await _ctx.Produtos.FindAsync(new object[] { cmd.ProdutoId }, ct);
            if (produto is null)
                return Resultado<ReservaEstoque>.Falha("Produto nao encontrado");

            _logger.LogInformation("[ReservarEstoque] Iniciando debito de estoque: Produto={ProdutoId}, Quantidade={Quantidade}", cmd.ProdutoId, cmd.Quantidade);
            var resultDebito = produto.DebitarEstoque(cmd.Quantidade);
            if (resultDebito.Falhou)
            {
                _logger.LogWarning("[ReservarEstoque] Debito rejeitado para Produto={ProdutoId}: {Motivo}", cmd.ProdutoId, resultDebito.Mensagem);

                var eventoRejeicao = new EventoOutbox
                {
                    TipoEvento = "Estoque.ReservaRejeitada",
                    IdAgregado = cmd.NotaId,
                    Payload = JsonSerializer.Serialize(new
                    {
                        notaId = cmd.NotaId,
                        motivo = resultDebito.Mensagem
                    }),
                    DataOcorrencia = DateTime.UtcNow
                };
                _ctx.EventosOutbox.Add(eventoRejeicao);
                _logger.LogInformation("[ReservarEstoque] Salvando evento de rejeicao antes do commit");
                await _ctx.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);

                return Resultado<ReservaEstoque>.Falha(resultDebito.Mensagem!);
            }
            _logger.LogInformation("[ReservarEstoque] Debito aplicado com sucesso, saldo atual do produto: {Saldo}", produto.Saldo);

            var reserva = new ReservaEstoque
            {
                Id = Guid.NewGuid(),
                NotaId = cmd.NotaId,
                ProdutoId = cmd.ProdutoId,
                Quantidade = cmd.Quantidade,
                Status = "RESERVADO",
                DataCriacao = DateTime.UtcNow
            };
            _ctx.ReservasEstoque.Add(reserva);
            _logger.LogInformation("[ReservarEstoque] Reserva registrada: {ReservaId}", reserva.Id);

            var evento = new EventoOutbox
            {
                TipoEvento = "Estoque.Reservado",
                IdAgregado = cmd.NotaId,
                Payload = JsonSerializer.Serialize(new
                {
                    notaId = cmd.NotaId,
                    itens = new[]
                    {
                        new { produtoId = cmd.ProdutoId, quantidade = cmd.Quantidade }
                    }
                }),
                DataOcorrencia = DateTime.UtcNow
            };
            _ctx.EventosOutbox.Add(evento);
            _logger.LogInformation("[ReservarEstoque] Evento de sucesso preparado para Nota={NotaId}", cmd.NotaId);

            if (simularFalha)
            {
                _logger.LogWarning("[ReservarEstoque] X-Demo-Fail detectado - lancando excecao antes de SaveChanges");
                throw new InvalidOperationException("Falha simulada");
            }

            _logger.LogInformation("[ReservarEstoque] Persistindo alteracoes...");
            await _ctx.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            _logger.LogInformation("[ReservarEstoque] Reserva criada com sucesso: {ReservaId}", reserva.Id);
            return Resultado<ReservaEstoque>.Sucesso(reserva);
        }
        catch (DbUpdateConcurrencyException ex)
        {
            await tx.RollbackAsync(ct);
            _ctx.ChangeTracker.Clear();
            _logger.LogWarning(ex, "[ReservarEstoque] Conflito de concorrencia ao reservar estoque");
            await PublicarRejeicaoAsync(cmd.NotaId, "Conflito de concorrencia", ct);
            return Resultado<ReservaEstoque>.Falha("Produto modificado. Tente novamente.");
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(ct);
            _ctx.ChangeTracker.Clear();
            _logger.LogError(ex, "[ReservarEstoque] Erro ao processar reserva para NotaId={NotaId}", cmd.NotaId);
            await PublicarRejeicaoAsync(cmd.NotaId, ex.Message, ct);
            return Resultado<ReservaEstoque>.Falha($"Erro ao processar reserva: {ex.Message}");
        }
    }

    public async Task<Resultado> ExecutarLote(
        ReservarEstoqueLoteCommand cmd,
        bool simularFalha = false,
        CancellationToken ct = default)
    {
        if (cmd.Itens is null || cmd.Itens.Count == 0)
        {
            return Resultado.Falha("Nenhum item informado para reserva de estoque.");
        }

        await using var tx = await _ctx.Database.BeginTransactionAsync(ct);
        try
        {
            foreach (var item in cmd.Itens)
            {
                var produto = await _ctx.Produtos
                    .AsTracking()
                    .FirstOrDefaultAsync(p => p.Id == item.ProdutoId, ct);

                if (produto is null)
                {
                    throw new InvalidOperationException($"Produto {item.ProdutoId} nao encontrado.");
                }

                var resultadoDebito = produto.DebitarEstoque(item.Quantidade);
                if (resultadoDebito.Falhou)
                {
                    await tx.RollbackAsync(ct);
                    await PublicarRejeicaoAsync(cmd.NotaId, resultadoDebito.Mensagem!, ct);
                    return Resultado.Falha(resultadoDebito.Mensagem!);
                }

                var reserva = new ReservaEstoque
                {
                    Id = Guid.NewGuid(),
                    NotaId = cmd.NotaId,
                    ProdutoId = item.ProdutoId,
                    Quantidade = item.Quantidade,
                    Status = "RESERVADO",
                    DataCriacao = DateTime.UtcNow
                };
                _ctx.ReservasEstoque.Add(reserva);
            }

            if (simularFalha)
            {
                _logger.LogWarning("[ReservarEstoque] Falha simulada em lote para NotaId={NotaId}", cmd.NotaId);
                throw new InvalidOperationException("Falha simulada");
            }

            await _ctx.SaveChangesAsync(ct);

            var eventoSucesso = new EventoOutbox
            {
                TipoEvento = "Estoque.Reservado",
                IdAgregado = cmd.NotaId,
                Payload = JsonSerializer.Serialize(new
                {
                    notaId = cmd.NotaId,
                    itens = cmd.Itens.Select(i => new { produtoId = i.ProdutoId, quantidade = i.Quantidade })
                }),
                DataOcorrencia = DateTime.UtcNow
            };

            _ctx.EventosOutbox.Add(eventoSucesso);
            await _ctx.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            _logger.LogInformation("[ReservarEstoque] Reserva em lote criada com sucesso para NotaId={NotaId}", cmd.NotaId);
            return Resultado.Sucesso();
        }
        catch (DbUpdateConcurrencyException ex)
        {
            await tx.RollbackAsync(ct);
            _ctx.ChangeTracker.Clear();
            _logger.LogWarning(ex, "[ReservarEstoque] Conflito de concorrencia ao reservar lote");
            await PublicarRejeicaoAsync(cmd.NotaId, "Conflito de concorrencia", ct);
            return Resultado.Falha("Produto modificado. Tente novamente.");
        }
        catch (Exception ex)
        {
            await tx.RollbackAsync(ct);
            _ctx.ChangeTracker.Clear();
            _logger.LogError(ex, "[ReservarEstoque] Erro ao processar lote para NotaId={NotaId}", cmd.NotaId);
            await PublicarRejeicaoAsync(cmd.NotaId, ex.Message, ct);
            return Resultado.Falha($"Erro ao processar reserva: {ex.Message}");
        }
    }

    private async Task PublicarRejeicaoAsync(Guid notaId, string motivo, CancellationToken ct)
    {
        await using var tx = await _ctx.Database.BeginTransactionAsync(ct);
        try
        {
            var evt = new EventoOutbox
            {
                TipoEvento = "Estoque.ReservaRejeitada",
                IdAgregado = notaId,
                Payload = JsonSerializer.Serialize(new
                {
                    notaId,
                    motivo
                }),
                DataOcorrencia = DateTime.UtcNow
            };

            _ctx.EventosOutbox.Add(evt);
            await _ctx.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception saveEx)
        {
            _logger.LogError(saveEx, "[ReservarEstoque] Falha ao publicar evento de rejeicao para NotaId={NotaId}", notaId);
            await tx.RollbackAsync(ct);
        }
    }
}
