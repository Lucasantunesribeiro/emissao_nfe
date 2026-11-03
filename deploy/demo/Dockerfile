# Imagem UNICA da demo gratuita (Render free web service ou qualquer host Docker).
#
# Roda num so container, sem nenhum servico AWS:
#   - DynamoDB Local em memoria (dados somem a cada restart/spin-down);
#   - API de estoque (.NET 8, Kestrel) em 127.0.0.1:8081;
#   - API de faturamento (Go) em modo HTTP na porta publica $PORT, que tambem
#     repassa /api/v1/produtos e /api/v1/reservas para o estoque, executa a
#     saga e o PDF de forma sincrona (ver servico-faturamento/cmd/lambda/http_demo.go).
#
# Ambiente fiscal: SEMPRE homologacao (tpAmb=2). Nao ha integracao SEFAZ.
#
#   docker build -f deploy/demo/Dockerfile -t nfe-demo .
#   docker run -p 8080:8080 nfe-demo

FROM golang:1.25-alpine AS go-build
WORKDIR /src
COPY servico-faturamento/go.mod servico-faturamento/go.sum ./
RUN go mod download
COPY servico-faturamento/cmd ./cmd
COPY servico-faturamento/internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/faturamento ./cmd/lambda

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet-build
WORKDIR /src
COPY servico-estoque/ServicoEstoque.csproj ./
RUN dotnet restore ServicoEstoque.csproj
COPY servico-estoque/ ./
RUN dotnet publish ServicoEstoque.csproj -c Release -o /out/estoque /p:UseAppHost=false

FROM amazon/dynamodb-local:2.5.2 AS ddb

FROM mcr.microsoft.com/dotnet/aspnet:8.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=ddb /home/dynamodblocal /opt/dynamodb-local
COPY --from=dotnet-build /out/estoque /app/estoque
COPY --from=go-build /out/faturamento /app/faturamento
COPY deploy/demo/start.sh /app/start.sh

ENV PORT=8080 \
    AWS_REGION=us-east-1 \
    AWS_ACCESS_KEY_ID=demo \
    AWS_SECRET_ACCESS_KEY=demo \
    AWS_ENDPOINT_URL_DYNAMODB=http://127.0.0.1:8000 \
    DYNAMODB_TABLE_NAME=nfe-main-demo \
    DYNAMODB_EVENTS_TABLE_NAME=nfe-events-demo \
    EVENT_BUS_NAME=nfe-events-demo \
    NFE_AMBIENTE=homologacao \
    DEMO_CRIAR_TABELAS=true \
    DEMO_SAGA_SINCRONA=true \
    DEMO_PDF_SINCRONO=true \
    ESTOQUE_INTERNAL_URL=http://127.0.0.1:8081 \
    ASPNETCORE_URLS=http://127.0.0.1:8081 \
    ASPNETCORE_ENVIRONMENT=Production \
    DOTNET_GCHeapHardLimit=0x6000000 \
    ENVIRONMENT=demo \
    LOG_LEVEL=info

RUN chmod +x /app/start.sh && chown -R $APP_UID /app /opt/dynamodb-local
USER $APP_UID
EXPOSE 8080
CMD ["/app/start.sh"]
