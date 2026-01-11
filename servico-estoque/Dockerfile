FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS base
WORKDIR /app
EXPOSE 8080

FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# copiar csproj e restaurar dependências
COPY ["ServicoEstoque.csproj", "./"]
RUN dotnet restore

# copiar código fonte e buildar
COPY . .
RUN dotnet build "ServicoEstoque.csproj" -c Release -o /app/build

FROM build AS publish
RUN dotnet publish "ServicoEstoque.csproj" -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "ServicoEstoque.dll"]