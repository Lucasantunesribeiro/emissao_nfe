package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"servico-faturamento/internal/config"
	"servico-faturamento/internal/consumidor"
	"servico-faturamento/internal/health"
	"servico-faturamento/internal/logger"
	"servico-faturamento/internal/manipulador"
	"servico-faturamento/internal/publicador"

	"github.com/gin-gonic/gin"
)

func main() {
	// Inicializar logging estruturado JSON
	logger.Init()

	slog.Info("Iniciando serviço de faturamento...")

	db, err := config.InicializarDB()
	if err != nil {
		slog.Error("Erro ao inicializar DB", "erro", err.Error())
		os.Exit(1)
	}

	sqlDB, _ := db.DB()
	defer sqlDB.Close()

	handlers := &manipulador.Handlers{DB: db}

	if err := publicador.IniciarPublicador(db); err != nil {
		slog.Error("Erro ao iniciar publicador outbox", "erro", err.Error())
		os.Exit(1)
	}

	if err := consumidor.IniciarConsumidor(db, handlers); err != nil {
		slog.Error("ERRO CRÍTICO: Falha ao iniciar consumidor RabbitMQ", "erro", err.Error())
		os.Exit(1)
	}
	slog.Info("Consumidor RabbitMQ iniciado com sucesso")

	// Configurar GIN mode
	if os.Getenv("ENVIRONMENT") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()

	r.Use(func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	})

	// Health check robusto
	r.GET("/health", gin.WrapH(health.Handler(db)))

	v1 := r.Group("/api/v1")
	{
		v1.GET("/health", gin.WrapH(health.Handler(db)))
		v1.POST("/notas", handlers.CriarNota)
		v1.GET("/notas", handlers.ListarNotas)
		v1.GET("/notas/:id", handlers.BuscarNota)
		v1.POST("/notas/:id/itens", handlers.AdicionarItem)
		v1.POST("/notas/:id/imprimir", handlers.ImprimirNota)

		v1.GET("/solicitacoes-impressao/:id", handlers.ConsultarStatusImpressao)
	}

	// Servidor HTTP com graceful shutdown
	srv := &http.Server{
		Addr:    ":8080",
		Handler: r,
	}

	// Canal para sinais de shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	// Iniciar servidor em goroutine
	go func() {
		slog.Info("Servidor Faturamento iniciado", "porta", "8080")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("Erro ao iniciar servidor", "erro", err.Error())
			os.Exit(1)
		}
	}()

	// Aguardar sinal de shutdown
	<-quit
	slog.Info("Recebido sinal de shutdown, encerrando gracefully...")

	// Timeout de 10s para shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("Erro no graceful shutdown", "erro", err.Error())
		os.Exit(1)
	}

	slog.Info("Servidor encerrado com sucesso")
}
