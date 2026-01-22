using System.Collections.Generic;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using ServicoEstoque.Api.DTOs;
using ServicoEstoque.Aplicacao.DTOs;
using ServicoEstoque.Dominio.Entidades;
using ServicoEstoque.Infraestrutura.Mensageria;

namespace ServicoEstoque.Api;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    PropertyNameCaseInsensitive = true)]
[JsonSerializable(typeof(HealthCheckResponse))]
[JsonSerializable(typeof(CheckResult))]
[JsonSerializable(typeof(Dictionary<string, CheckResult>))]
[JsonSerializable(typeof(Produto))]
[JsonSerializable(typeof(List<Produto>))]
[JsonSerializable(typeof(ProdutoResponse))]
[JsonSerializable(typeof(List<ProdutoResponse>))]
[JsonSerializable(typeof(IEnumerable<ProdutoResponse>))]
[JsonSerializable(typeof(ApiErroResponse))]
[JsonSerializable(typeof(ApiMensagemResponse))]
[JsonSerializable(typeof(ReservaResponse))]
[JsonSerializable(typeof(CriarProdutoRequest))]
[JsonSerializable(typeof(ReservarEstoqueRequest))]
[JsonSerializable(typeof(ValidationProblemDetails))]
[JsonSerializable(typeof(ProblemDetails))]
[JsonSerializable(typeof(EventoSolicitacaoImpressao))]
[JsonSerializable(typeof(ItemEventoImpressao))]
[JsonSerializable(typeof(EventoReservaItemPayload))]
[JsonSerializable(typeof(EventoReservaSucessoPayload))]
[JsonSerializable(typeof(EventoReservaRejeitadaPayload))]
internal partial class AppJsonSerializerContext : JsonSerializerContext
{
}
