package health

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"gorm.io/gorm"
)

type HealthResponse struct {
	Status         string                   `json:"status"`
	Service        string                   `json:"service"`
	Environment    string                   `json:"environment"`
	Timestamp      string                   `json:"timestamp"`
	Checks         map[string]CheckResult   `json:"checks"`
	UptimeSeconds  int64                    `json:"uptime_seconds"`
}

type CheckResult struct {
	Status    string  `json:"status"`
	LatencyMs int64   `json:"latency_ms,omitempty"`
	Error     string  `json:"error,omitempty"`
}

var startTime = time.Now()

// Handler retorna HTTP handler para /health endpoint
func Handler(db *gorm.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()

		checks := make(map[string]CheckResult)

		// Check Database
		checks["database"] = checkDatabase(ctx, db)

		// Check RabbitMQ
		checks["rabbitmq"] = checkRabbitMQ(ctx)

		// Determinar status geral
		overallStatus := "healthy"
		for _, check := range checks {
			if check.Status == "fail" {
				overallStatus = "unhealthy"
				break
			}
		}

		response := HealthResponse{
			Status:        overallStatus,
			Service:       "faturamento",
			Environment:   getEnv("ENVIRONMENT", "development"),
			Timestamp:     time.Now().UTC().Format(time.RFC3339),
			Checks:        checks,
			UptimeSeconds: int64(time.Since(startTime).Seconds()),
		}

		statusCode := http.StatusOK
		if overallStatus == "unhealthy" {
			statusCode = http.StatusServiceUnavailable
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(statusCode)
		json.NewEncoder(w).Encode(response)
	}
}

func checkDatabase(ctx context.Context, db *gorm.DB) CheckResult {
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	start := time.Now()

	sqlDB, err := db.DB()
	if err != nil {
		return CheckResult{Status: "fail", Error: "failed to get sql.DB: " + err.Error()}
	}

	if err := sqlDB.PingContext(checkCtx); err != nil {
		return CheckResult{Status: "fail", Error: err.Error()}
	}

	return CheckResult{
		Status:    "ok",
		LatencyMs: time.Since(start).Milliseconds(),
	}
}

func checkRabbitMQ(ctx context.Context) CheckResult {
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	rabbitURL := getEnv("RABBITMQ_URL", "amqp://admin:admin123@rabbitmq:5672/")

	start := time.Now()

	// Channel para resultado assíncrono
	resultChan := make(chan error, 1)

	go func() {
		conn, err := amqp.Dial(rabbitURL)
		if err != nil {
			resultChan <- err
			return
		}
		conn.Close()
		resultChan <- nil
	}()

	select {
	case <-checkCtx.Done():
		return CheckResult{Status: "fail", Error: "timeout connecting to RabbitMQ"}
	case err := <-resultChan:
		if err != nil {
			return CheckResult{Status: "fail", Error: err.Error()}
		}
		return CheckResult{
			Status:    "ok",
			LatencyMs: time.Since(start).Milliseconds(),
		}
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
