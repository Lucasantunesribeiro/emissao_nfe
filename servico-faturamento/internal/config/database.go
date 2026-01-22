package config

import (
	"fmt"
	"log/slog"
	"os"
	"regexp"

	"servico-faturamento/internal/dominio"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// SECURITY: Regex para validar identificadores SQL (prevenir SQL injection)
var sqlIdentifierRegex = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

// sanitizeSQLIdentifier valida que um identificador SQL contém apenas caracteres seguros
// Retorna erro se o identificador contiver caracteres perigosos
func sanitizeSQLIdentifier(identifier, fieldName string) (string, error) {
	if !sqlIdentifierRegex.MatchString(identifier) {
		return "", fmt.Errorf("SECURITY: %s inválido - apenas letras, números e underscore são permitidos", fieldName)
	}
	return identifier, nil
}

func InicializarDB() (*gorm.DB, error) {
	dsn := buildDSN()

	config := &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent), // usar slog
	}

	db, err := gorm.Open(postgres.Open(dsn), config)
	if err != nil {
		return nil, fmt.Errorf("falha ao conectar DB: %w", err)
	}

	// CRITICAL: Criar schema se não existir (antes de configurar search_path)
	if schema := os.Getenv("DB_SCHEMA"); schema != "" {
		slog.Info("Garantindo que schema existe", "schema", schema)

		// SECURITY: Validar nome do schema antes de usar em SQL
		safeSchema, err := sanitizeSQLIdentifier(schema, "DB_SCHEMA")
		if err != nil {
			return nil, err
		}

		// Criar schema se não existir
		createSchemaSQL := fmt.Sprintf("CREATE SCHEMA IF NOT EXISTS %s", safeSchema)
		if err := db.Exec(createSchemaSQL).Error; err != nil {
			return nil, fmt.Errorf("falha ao criar schema %s: %w", safeSchema, err)
		}

		// Grant permissions ao usuário atual
		dbUser := getEnv("DB_USER", "")
		if dbUser != "" {
			// SECURITY: Validar nome do usuário antes de usar em SQL
			safeUser, err := sanitizeSQLIdentifier(dbUser, "DB_USER")
			if err != nil {
				slog.Warn("Nome de usuário inválido, pulando GRANT", "error", err)
			} else {
				grantSQL := fmt.Sprintf("GRANT ALL PRIVILEGES ON SCHEMA %s TO %s", safeSchema, safeUser)
				if err := db.Exec(grantSQL).Error; err != nil {
					slog.Warn("Não foi possível conceder permissões no schema", "error", err, "schema", safeSchema, "user", safeUser)
					// Não falhar aqui - pode não ter permissão para GRANT mas schema já existe
				}
			}
		}

		// Configurar search_path
		slog.Info("Configurando search_path", "schema", safeSchema)
		if err := db.Exec(fmt.Sprintf("SET search_path TO %s", safeSchema)).Error; err != nil {
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
	host := getEnv("DB_HOST", "")
	port := getEnv("DB_PORT", "5432")
	user := getEnv("DB_USER", "")
	password := getEnv("DB_PASSWORD", "")
	dbname := getEnv("DB_NAME", "")
	sslmode := getEnv("DB_SSLMODE", "disable")

	// SECURITY: Validar credenciais obrigatórias
	if host == "" || user == "" || password == "" || dbname == "" {
		panic("SECURITY: DB credentials (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) são obrigatórias via variáveis de ambiente")
	}

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
