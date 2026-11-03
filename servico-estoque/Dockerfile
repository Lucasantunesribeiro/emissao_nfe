# API de estoque (.NET 8). Fora da AWS Lambda, AddAWSLambdaHosting cai para o
# Kestrel, entao a mesma aplicacao atende HTTP na porta 8080.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

COPY ["ServicoEstoque.csproj", "./"]
RUN dotnet restore "ServicoEstoque.csproj"

COPY . .
RUN dotnet publish "ServicoEstoque.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080
COPY --from=build /app/publish .
# Usuario nao-root ja existente na imagem oficial (.NET 8+)
USER $APP_UID
ENTRYPOINT ["dotnet", "ServicoEstoque.dll"]
