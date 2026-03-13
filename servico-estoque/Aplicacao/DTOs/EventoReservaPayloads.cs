using System;
using System.Collections.Generic;

namespace ServicoEstoque.Aplicacao.DTOs;

public record EventoReservaItemPayload(Guid ProdutoId, int Quantidade);

public record EventoReservaSucessoPayload(
    Guid NotaId,
    IReadOnlyList<EventoReservaItemPayload> Itens,
    string? CorrelationId = null);

public record EventoReservaRejeitadaPayload(
    Guid NotaId,
    string Motivo,
    string? CorrelationId = null);
