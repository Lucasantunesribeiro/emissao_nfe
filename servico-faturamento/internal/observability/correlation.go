package observability

import (
	"encoding/json"
	"strings"

	"github.com/google/uuid"
)

const CorrelationIDHeader = "X-Correlation-Id"

func HeaderValue(headers map[string]string, key string) string {
	if value, ok := headers[strings.ToLower(key)]; ok {
		return value
	}
	if value, ok := headers[key]; ok {
		return value
	}
	return ""
}

func GetOrCreateCorrelationID(headers map[string]string) string {
	if correlationID := strings.TrimSpace(HeaderValue(headers, CorrelationIDHeader)); correlationID != "" {
		return correlationID
	}
	return uuid.NewString()
}

func CorrelationIDFromJSONDetail(detail json.RawMessage) string {
	if len(detail) == 0 {
		return ""
	}

	var payload map[string]any
	if err := json.Unmarshal(detail, &payload); err != nil {
		return ""
	}

	if correlationID, ok := payload["correlationId"].(string); ok {
		return correlationID
	}

	return ""
}

func InjectCorrelationID(rawJSON string, correlationID string) string {
	if strings.TrimSpace(correlationID) == "" || strings.TrimSpace(rawJSON) == "" {
		return rawJSON
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &payload); err != nil {
		return rawJSON
	}

	if _, exists := payload["correlationId"]; !exists {
		payload["correlationId"] = correlationID
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return rawJSON
	}

	return string(normalized)
}

func SourceFromEventType(eventType string) string {
	parts := strings.SplitN(eventType, ".", 2)
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "nfe.unknown"
	}
	return "nfe." + strings.ToLower(parts[0])
}
