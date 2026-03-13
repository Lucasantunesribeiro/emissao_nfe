using System.Text.Json;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;
using Amazon.EventBridge;
using Amazon.EventBridge.Model;
using Amazon.Lambda.Core;
using Amazon.Lambda.Serialization.SystemTextJson;

[assembly: LambdaSerializer(typeof(DefaultLambdaJsonSerializer))]

namespace ServicoEstoque.OutboxPublisher;

public sealed class Function
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly IAmazonDynamoDB _dynamoDb;
    private readonly IAmazonEventBridge _eventBridge;
    private readonly string _eventsTableName;
    private readonly string _eventBusName;

    public Function()
        : this(
            new AmazonDynamoDBClient(),
            new AmazonEventBridgeClient(),
            Environment.GetEnvironmentVariable("DYNAMODB_EVENTS_TABLE_NAME")
                ?? throw new InvalidOperationException("DYNAMODB_EVENTS_TABLE_NAME is required."),
            Environment.GetEnvironmentVariable("EVENT_BUS_NAME") ?? "nfe-events-dev")
    {
    }

    internal Function(
        IAmazonDynamoDB dynamoDb,
        IAmazonEventBridge eventBridge,
        string eventsTableName,
        string eventBusName)
    {
        _dynamoDb = dynamoDb;
        _eventBridge = eventBridge;
        _eventsTableName = eventsTableName;
        _eventBusName = eventBusName;
    }

    public async Task FunctionHandler(JsonElement input, ILambdaContext context)
    {
        if (!input.TryGetProperty("Records", out var records) || records.ValueKind != JsonValueKind.Array)
        {
            context.Logger.LogLine("No stream records found.");
            return;
        }

        foreach (var record in records.EnumerateArray())
        {
            var eventName = record.TryGetProperty("eventName", out var eventNameElement)
                ? eventNameElement.GetString()
                : null;

            if (eventName is not ("INSERT" or "MODIFY"))
            {
                continue;
            }

            if (!record.TryGetProperty("dynamodb", out var dynamodbElement) ||
                !dynamodbElement.TryGetProperty("NewImage", out var newImage))
            {
                continue;
            }

            var pk = GetStringAttribute(newImage, "PK");
            if (!pk.StartsWith("OUTBOX#", StringComparison.Ordinal))
            {
                continue;
            }

            if (HasAttribute(newImage, "data_publicacao") || HasAttribute(newImage, "DataPublicacao"))
            {
                continue;
            }

            var sk = GetStringAttribute(newImage, "SK");
            var eventType = GetStringAttribute(newImage, "tipo_evento");
            if (string.IsNullOrWhiteSpace(eventType))
            {
                eventType = GetStringAttribute(newImage, "TipoEvento");
            }

            var payload = GetStringAttribute(newImage, "payload");
            if (string.IsNullOrWhiteSpace(payload))
            {
                payload = GetStringAttribute(newImage, "Payload");
            }

            var correlationId = GetStringAttribute(newImage, "correlation_id");
            var normalizedPayload = NormalizePayload(payload, correlationId);
            var source = ResolveSource(eventType);

            context.Logger.LogLine($"Publishing outbox event {eventType} ({pk}/{sk}) correlationId={correlationId}");

            await _eventBridge.PutEventsAsync(new PutEventsRequest
            {
                Entries =
                [
                    new PutEventsRequestEntry
                    {
                        EventBusName = _eventBusName,
                        DetailType = eventType,
                        Source = source,
                        Detail = normalizedPayload,
                    }
                ]
            });

            await _dynamoDb.UpdateItemAsync(new UpdateItemRequest
            {
                TableName = _eventsTableName,
                Key = new Dictionary<string, AttributeValue>
                {
                    ["PK"] = new(pk),
                    ["SK"] = new(sk),
                },
                UpdateExpression = "SET data_publicacao = :now",
                ConditionExpression = "attribute_not_exists(data_publicacao) AND attribute_not_exists(DataPublicacao)",
                ExpressionAttributeValues = new Dictionary<string, AttributeValue>
                {
                    [":now"] = new(DateTime.UtcNow.ToString("O")),
                },
            });
        }
    }

    private static bool HasAttribute(JsonElement image, string key)
    {
        return image.TryGetProperty(key, out _);
    }

    private static string GetStringAttribute(JsonElement image, string key)
    {
        if (!image.TryGetProperty(key, out var attribute))
        {
            return string.Empty;
        }

        if (attribute.TryGetProperty("S", out var stringValue))
        {
            return stringValue.GetString() ?? string.Empty;
        }

        if (attribute.TryGetProperty("N", out var numberValue))
        {
            return numberValue.GetString() ?? string.Empty;
        }

        return string.Empty;
    }

    private static string NormalizePayload(string payload, string correlationId)
    {
        if (string.IsNullOrWhiteSpace(payload))
        {
            payload = "{}";
        }

        if (string.IsNullOrWhiteSpace(correlationId))
        {
            return payload;
        }

        try
        {
            var document = JsonSerializer.Deserialize<Dictionary<string, object?>>(payload, JsonOptions);
            if (document is null)
            {
                return payload;
            }

            document.TryAdd("correlationId", correlationId);
            return JsonSerializer.Serialize(document, JsonOptions);
        }
        catch (JsonException)
        {
            return payload;
        }
    }

    private static string ResolveSource(string eventType)
    {
        if (string.IsNullOrWhiteSpace(eventType))
        {
            return "nfe.unknown";
        }

        var domain = eventType.Split('.', 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return string.IsNullOrWhiteSpace(domain)
            ? "nfe.unknown"
            : $"nfe.{domain.ToLowerInvariant()}";
    }
}
