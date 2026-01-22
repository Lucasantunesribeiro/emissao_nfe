using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.EntityFrameworkCore;
using ServicoEstoque.Dominio.Entidades;

namespace ServicoEstoque.Infraestrutura.Persistencia;

internal static class CompiledQueries
{
    internal static readonly Func<ContextoBancoDados, List<Produto>> ProdutosAtivos =
        EF.CompileQuery((ContextoBancoDados ctx) =>
            ctx.Produtos.AsNoTracking().Where(p => p.Ativo).ToList());

    internal static readonly Func<ContextoBancoDados, Guid, Produto?> ProdutoPorId =
        EF.CompileQuery((ContextoBancoDados ctx, Guid id) =>
            ctx.Produtos.AsNoTracking().FirstOrDefault(p => p.Id == id));

    internal static readonly Func<ContextoBancoDados, string, bool> ProdutoSkuExiste =
        EF.CompileQuery((ContextoBancoDados ctx, string sku) =>
            ctx.Produtos.Any(p => p.Sku == sku));

    internal static readonly Func<ContextoBancoDados, Guid, Produto?> ProdutoPorIdTracking =
        EF.CompileQuery((ContextoBancoDados ctx, Guid id) =>
            ctx.Produtos.AsTracking().FirstOrDefault(p => p.Id == id));

    internal static readonly Func<ContextoBancoDados, string, bool> MensagemProcessadaExiste =
        EF.CompileQuery((ContextoBancoDados ctx, string idMensagem) =>
            ctx.Set<MensagemProcessada>().Any(m => m.IDMensagem == idMensagem));

    internal static readonly Func<ContextoBancoDados, List<EventoOutbox>> EventosOutboxPendentes =
        EF.CompileQuery((ContextoBancoDados ctx) =>
            ctx.EventosOutbox
                .Where(e => e.DataPublicacao == null && e.TentativasEnvio < 5)
                .OrderBy(e => e.DataOcorrencia)
                .Take(10)
                .ToList());
}
