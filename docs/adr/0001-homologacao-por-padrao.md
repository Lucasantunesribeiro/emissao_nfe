# 0001 - Ambiente fiscal de homologacao por padrao

- Status: aceita
- Data: 2026-11-03

## Contexto

O leiaute da NF-e tem o campo `tpAmb` (1 = producao, 2 = homologacao). Um documento emitido em producao tem valor fiscal; um erro de configuracao (variavel ausente, valor digitado errado, copia de `.env` de outro ambiente) nao pode resultar em emissao real.

O projeto ainda nao integra com a SEFAZ, mas ja gera PDF de nota e expoe status de saude. Qualquer integracao futura precisa herdar um padrao seguro em vez de cada ponto decidir o ambiente.

## Decisao

`servico-faturamento/internal/fiscal.CarregarAmbiente` e a unica fonte do ambiente:

- `NFE_AMBIENTE` vazio, `homologacao` ou `2` resulta em homologacao (`tpAmb=2`).
- `producao` ou `1` so e aceito se `NFE_CONFIRMAR_PRODUCAO` for exatamente `EMITIR-NFE-COM-VALOR-FISCAL`. Sem a confirmacao, retorna `ErrProducaoNaoConfirmada`.
- Qualquer outro valor retorna `ErrAmbienteInvalido`.
- Em erro, o valor devolvido e sempre homologacao.

As Lambdas de API e de PDF chamam a funcao na inicializacao e falham (`panic` no cold start) se a configuracao for invalida. O PDF imprime "AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" fora de producao e `GET /health` informa `ambienteFiscal` e `tpAmb`.

## Consequencias

- Esquecer a variavel e seguro: o sistema fica em homologacao.
- Ir para producao exige duas variaveis coerentes; um valor como `prod` ou `production` derruba a Lambda em vez de emitir em producao silenciosamente.
- O CDK atual nao define `NFE_AMBIENTE`; os ambientes implantados operam em homologacao ate alguem decidir o contrario explicitamente.
- Testes em `internal/fiscal/ambiente_test.go` cobrem padrao, aliases, producao sem/com guarda e valores invalidos.
