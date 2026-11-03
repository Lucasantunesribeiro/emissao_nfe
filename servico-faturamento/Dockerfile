# Imagem local de uma Lambda Go do servico-faturamento.
# Em producao as Lambdas sao publicadas como zip (runtime provided.al2023) pelo CDK;
# esta imagem serve para rodar/inspecionar localmente com o Runtime Interface
# Emulator (RIE) que ja vem na imagem base oficial da AWS.
#
#   docker build --build-arg LAMBDA=lambda -t nfe-faturamento .
#   docker run -p 9000:8080 --entrypoint /usr/local/bin/aws-lambda-rie nfe-faturamento ./bootstrap
#
# LAMBDA: lambda | lambda-pdf | lambda-estoque-consumer | lambda-outbox
ARG GO_VERSION=1.25

FROM golang:${GO_VERSION}-alpine AS builder
ARG LAMBDA=lambda
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -tags lambda.norpc -trimpath -ldflags="-s -w" \
      -o /out/bootstrap ./cmd/${LAMBDA}

FROM public.ecr.aws/lambda/provided:al2023
COPY --from=builder /out/bootstrap ./bootstrap
ENTRYPOINT ["./bootstrap"]
