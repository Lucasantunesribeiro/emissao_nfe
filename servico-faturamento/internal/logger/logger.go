package logger

import (
	"log/slog"
	"os"
	"strings"
)

var Log *slog.Logger

func Init() {
	logLevel := parseLogLevel(os.Getenv("LOG_LEVEL"))

	handler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: logLevel,
		ReplaceAttr: func(groups []string, a slog.Attr) slog.Attr {
			// Renomear campos para padronização
			if a.Key == slog.TimeKey {
				a.Key = "timestamp"
			}
			if a.Key == slog.LevelKey {
				a.Key = "level"
			}
			if a.Key == slog.MessageKey {
				a.Key = "message"
			}
			return a
		},
	})

	Log = slog.New(handler).With(
		slog.String("service", "faturamento"),
		slog.String("environment", os.Getenv("ENVIRONMENT")),
	)

	slog.SetDefault(Log)
}

func parseLogLevel(level string) slog.Level {
	switch strings.ToUpper(level) {
	case "DEBUG":
		return slog.LevelDebug
	case "INFO":
		return slog.LevelInfo
	case "WARN":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
