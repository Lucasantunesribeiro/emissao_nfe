package config

import (
	"fmt"
	"log/slog"
	"os"

	"servico-faturamento/internal/dominio"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func InicializarDB() (*gorm.DB, error) {
	dsn := buildDSN()

	config := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent), // usar slog
	}

	db, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		return nil, fmt.Errorf("falha ao conectar DB: %w", err)
	}

	// Configurar schema search_path se especificado
	if schema := os.Getenv("DB_SCHEMA"); schema != "" {
		slog.Info("Configurando search_path", "schema", schema)
		if err := db.Exec(fmt.Sprintf("SET search_path TO %s", schema)).Error; err != nil {
			return nil, fmt.Errorf("falha ao configurar search_path: %w", err)
		}
	}

	slog.Info("Conexão com PostgreSQL estabelecida")

	err = db.AutoMigrate(
		&dominio.NotaFiscal{},
		&dominio.ItemNota{},
		&dominio.SolicitacaoImpressao{},
		&dominio.EventoOutbox{},
		&dominio.MensagemProcessada{},
	)
	if err != nil {
		return nil, fmt.Errorf("erro ao executar migrations: %w", err)
	}

	slog.Info("Migrations aplicadas com sucesso")

	return db, nil
}

func buildDSN() string {
	// Prioridade 1: DATABASE_URL completo
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}

	// Prioridade 2: componentes individuais (12-factor para ECS)
	host := getEnv("DB_HOST", "postgres-faturamento")
	port := getEnv("DB_PORT", "5432")
	user := getEnv("DB_USER", "admin")
	password := getEnv("DB_PASSWORD", "admin123")
	dbname := getEnv("DB_NAME", "faturamento")
	sslmode := getEnv("DB_SSLMODE", "disable")

	// Schema será configurado via SET search_path separadamente
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		host, port, user, password, dbname, sslmode,
	)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
