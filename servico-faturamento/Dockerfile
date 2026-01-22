FROM golang:1.23-alpine AS builder

WORKDIR /app

# copiar todo o código fonte primeiro
COPY . .

# gerar go.sum e baixar dependências
RUN go mod tidy
RUN go mod download

# build
RUN CGO_ENABLED=0 GOOS=linux go build -o /bin/servico-faturamento ./cmd/api

# final stage
FROM alpine:latest

RUN apk --no-cache add ca-certificates

# SECURITY: Cria usuário não-privilegiado para rodar a aplicação
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

WORKDIR /home/appuser

COPY --from=builder /bin/servico-faturamento .

# SECURITY: Muda dono dos arquivos para appuser
RUN chown -R appuser:appuser /home/appuser

# SECURITY: Executa como usuário não-root
USER appuser

EXPOSE 8080

CMD ["./servico-faturamento"]
