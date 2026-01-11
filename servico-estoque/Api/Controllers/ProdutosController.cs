using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Persistencia;

namespace ServicoEstoque.Api.Controllers;

[ApiController]
[Route("api/v1/produtos")]
public class ProdutosController : ControllerBase
{
    private readonly ContextoBancoDados _ctx;
    private readonly ILogger<ProdutosController> _logger;

    public ProdutosController(ContextoBancoDados ctx, ILogger<ProdutosController> logger)
    {
        _ctx = ctx;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult> Listar()
    {
        var produtos = await _ctx.Produtos
            .AsNoTracking()
            .Where(p => p.Ativo)
            .ToListAsync();

        return Ok(produtos);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult> Buscar(Guid id)
    {
        var produto = await _ctx.Produtos
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == id);

        if (produto == null)
            return NotFound(new { mensagem = "Produto não encontrado" });

        return Ok(produto);
    }

    [HttpPost]
    public async Task<ActionResult> Criar([FromBody] CriarProdutoRequest request)
    {
        var skuExiste = await _ctx.Produtos
            .AnyAsync(p => p.Sku == request.Sku);

        if (skuExiste)
            return BadRequest(new { mensagem = "SKU já cadastrado" });

        var produto = new Produto(request.Sku, request.Nome, request.Saldo);

        _ctx.Produtos.Add(produto);
        await _ctx.SaveChangesAsync();

        _logger.LogInformation("Produto criado: {Sku}", produto.Sku);

        return CreatedAtAction(nameof(Buscar), new { id = produto.Id }, produto);
    }
}