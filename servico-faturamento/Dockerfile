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

WORKDIR /root/

COPY --from=builder /bin/servico-faturamento .

EXPOSE 8080

CMD ["./servico-faturamento"]
