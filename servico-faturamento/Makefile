.PHONY: help build run dev docker-up docker-down docker-logs test clean

help: ## Mostrar esta ajuda
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Compilar a aplicação
	go build -o servico-faturamento ./cmd/api

run: ## Executar a aplicação
	go run ./cmd/api/main.go

dev: ## Executar em modo desenvolvimento com hot reload (requer air)
	air

docker-up: ## Iniciar containers Docker
	docker-compose up -d

docker-down: ## Parar containers Docker
	docker-compose down

docker-logs: ## Ver logs dos containers
	docker-compose logs -f servico-faturamento

docker-rebuild: ## Rebuild e reiniciar containers
	docker-compose up -d --build

test: ## Executar testes
	go test -v -race -coverprofile=coverage.out ./...

test-coverage: test ## Executar testes e mostrar cobertura
	go tool cover -html=coverage.out

clean: ## Limpar binários e cache
	go clean
	rm -f servico-faturamento
	rm -f coverage.out

deps: ## Instalar dependências
	go mod download
	go mod tidy

fmt: ## Formatar código
	go fmt ./...

vet: ## Verificar código
	go vet ./...

lint: ## Executar linter (requer golangci-lint)
	golangci-lint run

.DEFAULT_GOAL := help