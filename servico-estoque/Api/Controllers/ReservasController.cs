using Microsoft.AspNetCore.Mvc;
using ServicoEstoque.Aplicacao.CasosDeUso;
using ServicoEstoque.Aplicacao.DTOs;

namespace ServicoEstoque.Api.Controllers;

[ApiController]
[Route("api/v1/reservas")]
public class ReservasController : ControllerBase
{
    private readonly ReservarEstoqueHandler _handler;
    private readonly ILogger<ReservasController> _logger;

    public ReservasController(ReservarEstoqueHandler handler, ILogger<ReservasController> logger)
    {
        _handler = handler;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult> Reservar([FromBody] ReservarEstoqueRequest request)
    {
        var demoFail = Request.Headers["X-Demo-Fail"].FirstOrDefault();
        bool simularFalha = demoFail?.Equals("true", StringComparison.OrdinalIgnoreCase) == true;

        _logger.LogInformation(
            "[ReservasController] Recebendo requisição: NotaId={NotaId}, ProdutoId={ProdutoId}, Quantidade={Quantidade}, X-Demo-Fail={Header}",
            request.NotaId,
            request.ProdutoId,
            request.Quantidade,
            demoFail ?? "<null>"
        );

        if (simularFalha)
            _logger.LogWarning("[ReservasController] Simulação de falha ativada via header X-Demo-Fail");
        else
            _logger.LogInformation("[ReservasController] X-Demo-Fail desativado (valor='{Header}')", demoFail ?? "<null>");

        var comando = new ReservarEstoqueCommand(
            request.NotaId,
            request.ProdutoId,
            request.Quantidade
        );
        _logger.LogInformation("[ReservasController] Enviando comando para handler. SimularFalha={SimularFalha}", simularFalha);

        var resultado = await _handler.Executar(comando, simularFalha);

        if (resultado.EhSucesso)
        {
            _logger.LogInformation(
                "Reserva OK: NotaId={NotaId}, ProdutoId={ProdutoId}, Qtd={Qtd}",
                request.NotaId, request.ProdutoId, request.Quantidade
            );

            return Ok(new
            {
                sucesso = true,
                reservaId = resultado.Dados!.Id,
                mensagem = "Reserva criada com sucesso"
            });
        }

        _logger.LogWarning("Falha ao reservar: {Erro}", resultado.Mensagem);

        return BadRequest(new
        {
            sucesso = false,
            mensagem = resultado.Mensagem
        });
    }
}