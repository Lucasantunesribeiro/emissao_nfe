using System.Diagnostics;
using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.Model;

namespace ServicoEstoque.Api;

public record HealthCheckResponse(
    string Status,
    string Service,
    string Environment,
    string Timestamp,
    Dictionary<string, CheckResult> Checks,
    long UptimeSeconds
);

public record CheckResult(
    string Status,
    long? LatencyMs = null,
    string? Error = null
);

public static class HealthCheckEndpoint
{
    private static readonly DateTimeOffset StartTime = DateTimeOffset.UtcNow;

    public static async Task<IResult> HandleHealthCheck(
        IAmazonDynamoDB dynamoDb,
        IConfiguration configuration,
        IHostEnvironment env)
    {
        var checks = new Dictionary<string, CheckResult>();

        // Check DynamoDB
        checks["dynamodb"] = await CheckDynamoDB(dynamoDb, configuration);

        var overallStatus = checks.Values.Any(c => c.Status == "fail") ? "unhealthy" : "healthy";

        var response = new HealthCheckResponse(
            Status: overallStatus,
            Service: "estoque",
            Environment: env.EnvironmentName,
            Timestamp: DateTimeOffset.UtcNow.ToString("o"),
            Checks: checks,
            UptimeSeconds: (long)(DateTimeOffset.UtcNow - StartTime).TotalSeconds
        );

        return overallStatus == "healthy"
            ? Results.Ok(response)
            : Results.Json(response, statusCode: 503);
    }

    private static async Task<CheckResult> CheckDynamoDB(IAmazonDynamoDB dynamoDb, IConfiguration configuration)
    {
        try
        {
            var sw = Stopwatch.StartNew();
            var tableName = configuration["DYNAMODB_TABLE_NAME"] ?? Environment.GetEnvironmentVariable("DYNAMODB_TABLE_NAME");

            if (string.IsNullOrEmpty(tableName))
            {
                return new CheckResult("fail", Error: "DYNAMODB_TABLE_NAME not configured");
            }

            var request = new DescribeTableRequest
            {
                TableName = tableName
            };

            var response = await dynamoDb.DescribeTableAsync(request);
            sw.Stop();

            return response.Table.TableStatus == TableStatus.ACTIVE
                ? new CheckResult("pass", sw.ElapsedMilliseconds)
                : new CheckResult("fail", sw.ElapsedMilliseconds, $"Table status: {response.Table.TableStatus}");
        }
        catch (Exception ex)
        {
            return new CheckResult("fail", Error: ex.Message);
        }
    }
}
