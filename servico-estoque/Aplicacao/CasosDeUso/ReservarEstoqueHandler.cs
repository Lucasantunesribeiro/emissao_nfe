using System.Text.Json;
using Microsoft.Extensions.Logging;
using ServicoEstoque.Api;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Aplicacao.CasosDeUso;

public sealed class ReservarEstoqueHandler
{
    private readonly IRepositorioProdutos _repoProdutos;
    private readonly IRepositorioReservas _repoReservas;
    private readonly IRepositorioEventos _repoEventos;
    private readonly ILogger<ReservarEstoqueHandler> _logger;
    private readonly ICorrelationContextAccessor _correlationContextAccessor;

    public ReservarEstoqueHandler(
        IRepositorioProdutos repoProdutos,
        IRepositorioReservas repoReservas,
        IRepositorioEventos repoEventos,
        ILogger<ReservarEstoqueHandler> logger,
        ICorrelationContextAccessor correlationContextAccessor)
    {
        _repoProdutos = repoProdutos;
        _repoReservas = repoReservas;
        _repoEventos = repoEventos;
        _logger = logger;
        _correlationContextAccessor = correlationContextAccessor;
    }

    public async Task<Resultado<ReservaEstoque>> Executar(
        ReservarEstoqueCommand cmd,
        bool simularFalha = false,
        CancellationToken ct = default)
    {
        try
        {
            var produto = await _repoProdutos.BuscarPorIdAsync(cmd.ProdutoId, ct);
            if (produto is null)
                return Resultado<ReservaEstoque>.Falha("Produto nao encontrado");

            _logger.LogInformation("[ReservarEstoque] Iniciando debito de estoque: Produto={ProdutoId}, Quantidade={Quantidade}", cmd.ProdutoId, cmd.Quantidade);

            var resultDebito = produto.DebitarEstoque(cmd.Quantidade);
            if (resultDebito.Falhou)
            {
                _logger.LogWarning("[ReservarEstoque] Debito rejeitado para Produto={ProdutoId}: {Motivo}", cmd.ProdutoId, resultDebito.Mensagem);

                var payloadRejeicao = new EventoReservaRejeitadaPayload(
                    cmd.NotaId,
                    resultDebito.Mensagem ?? "Falha ao reservar estoque",
                    _correlationContextAccessor.CorrelationId);

                var eventoRejeicao = new EventoOutbox
                {
                    Id = 0,
                    TipoEvento = "Estoque.ReservaRejeitada",
                    IdAgregado = cmd.NotaId,
                    CorrelationId = _correlationContextAccessor.CorrelationId,
                    Payload = JsonSerializer.Serialize(
                        payloadRejeicao,
                        AppJsonSerializerContext.Default.EventoReservaRejeitadaPayload),
                    DataOcorrencia = DateTime.UtcNow
                };

                await _repoEventos.SalvarEventoOutboxAsync(eventoRejeicao, ct);
                _logger.LogInformation("[ReservarEstoque] Evento de rejeicao salvo");

                return Resultado<ReservaEstoque>.Falha(resultDebito.Mensagem!);
            }

            _logger.LogInformation("[ReservarEstoque] Debito aplicado com sucesso, saldo atual do produto: {Saldo}", produto.Saldo);

            // Update produto with new saldo
            await _repoProdutos.AtualizarProdutoAsync(produto, ct);

            var reserva = new ReservaEstoque
            {
                Id = Guid.NewGuid(),
                NotaId = cmd.NotaId,
                ProdutoId = cmd.ProdutoId,
                Quantidade = cmd.Quantidade,
                Status = "RESERVADO",
                DataCriacao = DateTime.UtcNow
            };

            await _repoReservas.SalvarReservaAsync(reserva, ct);
            _logger.LogInformation("[ReservarEstoque] Reserva registrada: {ReservaId}", reserva.Id);

            var itensPayload = new List<EventoReservaItemPayload>
            {
                new(cmd.ProdutoId, cmd.Quantidade)
            };

            var payloadSucesso = new EventoReservaSucessoPayload(
                cmd.NotaId,
                itensPayload,
                _correlationContextAccessor.CorrelationId);
            var evento = new EventoOutbox
            {
                Id = 0,
                TipoEvento = "Estoque.Reservado",
                IdAgregado = cmd.NotaId,
                CorrelationId = _correlationContextAccessor.CorrelationId,
                Payload = JsonSerializer.Serialize(
                    payloadSucesso,
                    AppJsonSerializerContext.Default.EventoReservaSucessoPayload),
                DataOcorrencia = DateTime.UtcNow
            };

            await _repoEventos.SalvarEventoOutboxAsync(evento, ct);
            _logger.LogInformation("[ReservarEstoque] Evento de sucesso preparado para Nota={NotaId}", cmd.NotaId);

            if (simularFalha)
            {
                _logger.LogWarning("[ReservarEstoque] X-Demo-Fail detectado - lancando excecao");
                throw new InvalidOperationException("Falha simulada");
            }

            _logger.LogInformation("[ReservarEstoque] Reserva criada com sucesso: {ReservaId}", reserva.Id);
            return Resultado<ReservaEstoque>.Sucesso(reserva);
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Versão desatualizada"))
        {
            _logger.LogWarning(ex, "[ReservarEstoque] Conflito de concorrencia ao reservar estoque");
            await PublicarRejeicaoAsync(cmd.NotaId, "Conflito de concorrencia", ct);
            return Resultado<ReservaEstoque>.Falha("Produto modificado. Tente novamente.");
        }
        catch (Exception ex)
        {
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

        try
        {
            foreach (var item in cmd.Itens)
            {
                var produto = await _repoProdutos.BuscarPorIdAsync(item.ProdutoId, ct);

                if (produto is null)
                {
                    throw new InvalidOperationException($"Produto {item.ProdutoId} nao encontrado.");
                }

                var resultadoDebito = produto.DebitarEstoque(item.Quantidade);
                if (resultadoDebito.Falhou)
                {
                    await PublicarRejeicaoAsync(cmd.NotaId, resultadoDebito.Mensagem!, ct);
                    return Resultado.Falha(resultadoDebito.Mensagem!);
                }

                await _repoProdutos.AtualizarProdutoAsync(produto, ct);

                var reserva = new ReservaEstoque
                {
                    Id = Guid.NewGuid(),
                    NotaId = cmd.NotaId,
                    ProdutoId = item.ProdutoId,
                    Quantidade = item.Quantidade,
                    Status = "RESERVADO",
                    DataCriacao = DateTime.UtcNow
                };

                await _repoReservas.SalvarReservaAsync(reserva, ct);
            }

            if (simularFalha)
            {
                _logger.LogWarning("[ReservarEstoque] Falha simulada em lote para NotaId={NotaId}", cmd.NotaId);
                throw new InvalidOperationException("Falha simulada");
            }

            var itensLote = cmd.Itens
                .Select(i => new EventoReservaItemPayload(i.ProdutoId, i.Quantidade))
                .ToList();
            var payloadLote = new EventoReservaSucessoPayload(cmd.NotaId, itensLote);
            payloadLote = payloadLote with { CorrelationId = _correlationContextAccessor.CorrelationId };

            var eventoSucesso = new EventoOutbox
            {
                Id = 0,
                TipoEvento = "Estoque.Reservado",
                IdAgregado = cmd.NotaId,
                CorrelationId = _correlationContextAccessor.CorrelationId,
                Payload = JsonSerializer.Serialize(
                    payloadLote,
                    AppJsonSerializerContext.Default.EventoReservaSucessoPayload),
                DataOcorrencia = DateTime.UtcNow
            };

            await _repoEventos.SalvarEventoOutboxAsync(eventoSucesso, ct);

            _logger.LogInformation("[ReservarEstoque] Reserva em lote criada com sucesso para NotaId={NotaId}", cmd.NotaId);
            return Resultado.Sucesso();
        }
        catch (InvalidOperationException ex) when (ex.Message.Contains("Versão desatualizada"))
        {
            _logger.LogWarning(ex, "[ReservarEstoque] Conflito de concorrencia ao reservar lote");
            await PublicarRejeicaoAsync(cmd.NotaId, "Conflito de concorrencia", ct);
            return Resultado.Falha("Produto modificado. Tente novamente.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[ReservarEstoque] Erro ao processar lote para NotaId={NotaId}", cmd.NotaId);
            await PublicarRejeicaoAsync(cmd.NotaId, ex.Message, ct);
            return Resultado.Falha($"Erro ao processar reserva: {ex.Message}");
        }
    }

    private async Task PublicarRejeicaoAsync(Guid notaId, string motivo, CancellationToken ct)
    {
        try
        {
            var payloadRejeicao = new EventoReservaRejeitadaPayload(
                notaId,
                motivo,
                _correlationContextAccessor.CorrelationId);
            var evt = new EventoOutbox
            {
                Id = 0,
                TipoEvento = "Estoque.ReservaRejeitada",
                IdAgregado = notaId,
                CorrelationId = _correlationContextAccessor.CorrelationId,
                Payload = JsonSerializer.Serialize(
                    payloadRejeicao,
                    AppJsonSerializerContext.Default.EventoReservaRejeitadaPayload),
                DataOcorrencia = DateTime.UtcNow
            };

            await _repoEventos.SalvarEventoOutboxAsync(evt, ct);
        }
        catch (Exception saveEx)
        {
            _logger.LogError(saveEx, "[ReservarEstoque] Falha ao publicar evento de rejeicao para NotaId={NotaId}", notaId);
        }
    }
}
