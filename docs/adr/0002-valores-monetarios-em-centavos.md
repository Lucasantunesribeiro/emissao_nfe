# 0002 - Valores monetarios em centavos (int64)

- Status: aceita
- Data: 2026-11-03

## Contexto

O faturamento guardava `PrecoUnitario`, subtotal e total como `float64`. Em ponto flutuante binario `0.1 + 0.2 != 0.3`; somar itens e multiplicar por quantidade acumula erro de arredondamento e o total da nota pode divergir em centavos do que um calculo decimal daria. Para documento fiscal isso e inaceitavel.

## Decisao

`servico-faturamento/internal/dominio.Dinheiro` representa valores em centavos (`int64`):

- Entrada JSON: `precoUnitario` continua numerico no contrato, mas e lido com `json.Number` (texto literal) e convertido sem passar por `float64`. Mais de 2 casas decimais significativas retorna 400.
- DynamoDB: gravado como `N` decimal (`"10.50"`) e lido como texto (`attributevalue.Number`), compativel com itens antigos gravados com `%.2f`.
- Soma e multiplicacao detectam overflow; a entrada e limitada para que `preco * quantidade` caiba em `int64`.
- Formatacao brasileira (`R$ 1.234,50`) para o PDF.

## Consequencias

- Totais exatos e reproduziveis; testes em `dinheiro_test.go` e `notafiscal_test.go`.
- O contrato da API nao mudou para o frontend.
- Valores com mais de 2 casas sao rejeitados em vez de arredondados silenciosamente.
- O servico .NET nao lida com preco hoje; se passar a lidar, deve usar `decimal` ou centavos inteiros.
