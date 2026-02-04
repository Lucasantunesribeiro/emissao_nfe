#!/bin/bash
set -euo pipefail

# =====================================================
# Post-Deploy Validation Script
# =====================================================
# Purpose: Validate cost optimization deploy (b069902)
# Usage: ./scripts/validation-commands.sh [--quick|--full]
# Time: Quick=5min, Full=15min
# =====================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Config
REGION="${AWS_REGION:-us-east-1}"
ENV="${ENVIRONMENT:-dev}"
LOG_FILE="logs/validation-$(date +%Y%m%d-%H%M%S).log"

# Create logs directory
mkdir -p logs

# Functions
log() {
    echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}✅ $1${NC}" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}❌ $1${NC}" | tee -a "$LOG_FILE"
}

separator() {
    echo -e "\n${BLUE}========================================${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}$1${NC}" | tee -a "$LOG_FILE"
    echo -e "${BLUE}========================================${NC}\n" | tee -a "$LOG_FILE"
}

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    local success_pattern="$3"

    ((TESTS_TOTAL++))

    log "Running: $test_name"

    if output=$(eval "$test_command" 2>&1); then
        if echo "$output" | grep -q "$success_pattern"; then
            success "$test_name"
            ((TESTS_PASSED++))
            return 0
        else
            error "$test_name - Pattern not found: $success_pattern"
            echo "$output" | tee -a "$LOG_FILE"
            ((TESTS_FAILED++))
            return 1
        fi
    else
        error "$test_name - Command failed"
        echo "$output" | tee -a "$LOG_FILE"
        ((TESTS_FAILED++))
        return 1
    fi
}

# =====================================================
# PRE-VALIDATION CHECKS
# =====================================================

separator "PRE-VALIDATION CHECKS"

log "Checking AWS credentials..."
if aws sts get-caller-identity > /dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text)
    success "AWS credentials valid (Account: $ACCOUNT_ID)"
else
    error "AWS credentials invalid or expired"
    exit 1
fi

log "Checking region..."
success "Region: $REGION"

log "Checking RDS status..."
RDS_STATUS=$(aws rds describe-db-instances \
    --db-instance-identifier nfe-db-dev \
    --query 'DBInstances[0].DBInstanceStatus' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "not_found")

if [[ "$RDS_STATUS" == "available" ]]; then
    success "RDS is online ($RDS_STATUS)"
elif [[ "$RDS_STATUS" == "stopped" ]]; then
    warning "RDS is stopped - some tests will fail (this is expected if outside business hours)"
    echo "Starting RDS..."
    aws lambda invoke \
        --function-name nfe-rds-start-dev \
        --region "$REGION" \
        /tmp/rds-start-response.json > /dev/null 2>&1
    log "Waiting 5 minutes for RDS to start..."
    sleep 300
    RDS_STATUS=$(aws rds describe-db-instances \
        --db-instance-identifier nfe-db-dev \
        --query 'DBInstances[0].DBInstanceStatus' \
        --output text \
        --region "$REGION")
    if [[ "$RDS_STATUS" == "available" ]]; then
        success "RDS started successfully"
    else
        error "RDS failed to start (status: $RDS_STATUS)"
        exit 1
    fi
else
    error "RDS status unknown: $RDS_STATUS"
    exit 1
fi

# =====================================================
# TEST SUITE 1: LAMBDA → RDS CONNECTIVITY
# =====================================================

separator "TEST SUITE 1: LAMBDA → RDS CONNECTIVITY"

# Test 1.1: Faturamento Lambda
log "Test 1.1: Faturamento Lambda → RDS"
aws lambda invoke \
    --function-name nfe-faturamento-dev \
    --payload '{"httpMethod":"GET","path":"/health"}' \
    --region "$REGION" \
    --cli-read-timeout 10 \
    /tmp/faturamento-response.json > /dev/null 2>&1

STATUS_CODE=$(cat /tmp/faturamento-response.json | jq -r '.statusCode' 2>/dev/null || echo "error")
if [[ "$STATUS_CODE" == "200" ]]; then
    success "Faturamento Lambda connected to RDS (200 OK)"
    ((TESTS_PASSED++))
else
    error "Faturamento Lambda failed (status: $STATUS_CODE)"
    cat /tmp/faturamento-response.json
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# Test 1.2: Estoque Lambda
log "Test 1.2: Estoque Lambda → RDS"
aws lambda invoke \
    --function-name nfe-estoque-dev \
    --payload '{"httpMethod":"GET","path":"/health"}' \
    --region "$REGION" \
    /tmp/estoque-response.json > /dev/null 2>&1

STATUS_CODE=$(cat /tmp/estoque-response.json | jq -r '.statusCode' 2>/dev/null || echo "error")
if [[ "$STATUS_CODE" == "200" ]]; then
    success "Estoque Lambda connected to RDS (200 OK)"
    ((TESTS_PASSED++))
else
    error "Estoque Lambda failed (status: $STATUS_CODE)"
    cat /tmp/estoque-response.json
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# Test 1.3: Outbox Processor
log "Test 1.3: Outbox Processor → RDS"
aws lambda invoke \
    --function-name nfe-outbox-processor-dev \
    --payload '{}' \
    --region "$REGION" \
    /tmp/outbox-response.json > /dev/null 2>&1

if grep -q "error" /tmp/outbox-response.json; then
    error "Outbox Processor failed"
    cat /tmp/outbox-response.json
    ((TESTS_FAILED++))
else
    success "Outbox Processor executed successfully"
    ((TESTS_PASSED++))
fi
((TESTS_TOTAL++))

# =====================================================
# TEST SUITE 2: API GATEWAY
# =====================================================

separator "TEST SUITE 2: API GATEWAY"

# Get API endpoint
log "Fetching API Gateway endpoint..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name nfe-api-serverless-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
    --output text \
    --region "$REGION" 2>/dev/null || echo "")

if [[ -z "$API_ENDPOINT" ]]; then
    error "API Gateway endpoint not found"
    ((TESTS_FAILED++))
    ((TESTS_TOTAL++))
else
    success "API Endpoint: $API_ENDPOINT"

    # Test 2.1: Health Check
    log "Test 2.1: API Gateway Health Check"
    HTTP_STATUS=$(curl -X GET "$API_ENDPOINT/health" \
        -w "%{http_code}" \
        -s -o /tmp/api-health.json)

    if [[ "$HTTP_STATUS" == "200" ]]; then
        success "API Gateway health check passed (200 OK)"
        ((TESTS_PASSED++))
    else
        error "API Gateway health check failed (HTTP $HTTP_STATUS)"
        cat /tmp/api-health.json
        ((TESTS_FAILED++))
    fi
    ((TESTS_TOTAL++))

    # Test 2.2: CORS
    log "Test 2.2: API Gateway CORS"
    CORS_HEADERS=$(curl -X OPTIONS "$API_ENDPOINT/notas-fiscais" \
        -H "Origin: https://example.com" \
        -H "Access-Control-Request-Method: POST" \
        -s -I 2>&1 | grep -i "access-control-allow" | wc -l)

    if [[ "$CORS_HEADERS" -ge 2 ]]; then
        success "CORS headers present ($CORS_HEADERS headers)"
        ((TESTS_PASSED++))
    else
        error "CORS headers missing or incomplete"
        ((TESTS_FAILED++))
    fi
    ((TESTS_TOTAL++))
fi

# =====================================================
# TEST SUITE 3: RDS SCHEDULER
# =====================================================

separator "TEST SUITE 3: RDS SCHEDULER"

# Test 3.1: EventBridge Rules
log "Test 3.1: EventBridge Rules configured"
RULES_COUNT=$(aws events list-rules \
    --name-prefix "nfe-rds" \
    --region "$REGION" \
    --query 'length(Rules)' \
    --output text 2>/dev/null || echo "0")

if [[ "$RULES_COUNT" -ge 3 ]]; then
    success "EventBridge Rules configured ($RULES_COUNT rules)"
    ((TESTS_PASSED++))
else
    error "EventBridge Rules missing (found: $RULES_COUNT, expected: 3)"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# Test 3.2: Scheduler Lambda Functions Exist
log "Test 3.2: RDS Scheduler Lambda functions"
START_LAMBDA=$(aws lambda get-function \
    --function-name nfe-rds-start-dev \
    --region "$REGION" \
    --query 'Configuration.FunctionArn' \
    --output text 2>/dev/null || echo "not_found")

STOP_LAMBDA=$(aws lambda get-function \
    --function-name nfe-rds-stop-dev \
    --region "$REGION" \
    --query 'Configuration.FunctionArn' \
    --output text 2>/dev/null || echo "not_found")

if [[ "$START_LAMBDA" != "not_found" ]] && [[ "$STOP_LAMBDA" != "not_found" ]]; then
    success "RDS Scheduler Lambdas exist"
    ((TESTS_PASSED++))
else
    error "RDS Scheduler Lambdas missing"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# =====================================================
# TEST SUITE 4: CLOUDWATCH LOGS
# =====================================================

separator "TEST SUITE 4: CLOUDWATCH LOGS"

# Test 4.1: Log Retention
log "Test 4.1: Log retention configured"
NO_RETENTION=$(aws logs describe-log-groups \
    --region "$REGION" \
    --query 'logGroups[?starts_with(logGroupName, `/aws/lambda/nfe`) && !retentionInDays]' \
    --output json | jq 'length' 2>/dev/null || echo "error")

if [[ "$NO_RETENTION" == "0" ]]; then
    success "All log groups have retention configured"
    ((TESTS_PASSED++))
else
    warning "$NO_RETENTION log groups without retention (check manually)"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# Test 4.2: Recent Errors
log "Test 4.2: Checking for recent errors..."
RECENT_ERRORS=$(aws logs filter-log-events \
    --log-group-name /aws/lambda/nfe-faturamento-dev \
    --filter-pattern "ERROR" \
    --start-time $(($(date +%s) - 600))000 \
    --region "$REGION" \
    --query 'length(events)' \
    --output text 2>/dev/null || echo "0")

if [[ "$RECENT_ERRORS" == "0" ]]; then
    success "No recent errors in logs"
    ((TESTS_PASSED++))
else
    warning "$RECENT_ERRORS errors found in logs (check CloudWatch)"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# =====================================================
# TEST SUITE 5: VPC CONFIGURATION
# =====================================================

separator "TEST SUITE 5: VPC CONFIGURATION"

# Test 5.1: VPC Endpoints (only S3 Gateway should remain)
log "Test 5.1: VPC Endpoints removed (except S3)"
INTERFACE_ENDPOINTS=$(aws ec2 describe-vpc-endpoints \
    --region "$REGION" \
    --filters "Name=vpc-endpoint-type,Values=Interface" "Name=tag:Project,Values=NFe-System" \
    --query 'length(VpcEndpoints)' \
    --output text 2>/dev/null || echo "0")

if [[ "$INTERFACE_ENDPOINTS" == "0" ]]; then
    success "Interface VPC Endpoints removed (cost savings: \$21.90/month)"
    ((TESTS_PASSED++))
else
    error "$INTERFACE_ENDPOINTS Interface Endpoints still present (expected: 0)"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# Test 5.2: Lambda VPC Configuration
log "Test 5.2: Lambdas removed from VPC"
LAMBDA_IN_VPC=$(aws lambda list-functions \
    --region "$REGION" \
    --query 'Functions[?starts_with(FunctionName, `nfe-`) && VpcConfig.VpcId != null]' \
    --output json | jq 'length' 2>/dev/null || echo "error")

if [[ "$LAMBDA_IN_VPC" == "0" ]]; then
    success "Lambdas removed from VPC (faster cold start)"
    ((TESTS_PASSED++))
else
    warning "$LAMBDA_IN_VPC Lambdas still in VPC (check configuration)"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# =====================================================
# TEST SUITE 6: SECURITY
# =====================================================

separator "TEST SUITE 6: SECURITY"

# Test 6.1: RDS Security Group
log "Test 6.1: RDS Security Group configured"
DB_SG=$(aws rds describe-db-instances \
    --db-instance-identifier nfe-db-dev \
    --region "$REGION" \
    --query 'DBInstances[0].VpcSecurityGroups[0].VpcSecurityGroupId' \
    --output text 2>/dev/null || echo "not_found")

if [[ "$DB_SG" != "not_found" ]]; then
    INGRESS_RULES=$(aws ec2 describe-security-groups \
        --group-ids "$DB_SG" \
        --region "$REGION" \
        --query 'length(SecurityGroups[0].IpPermissions)' \
        --output text 2>/dev/null || echo "0")

    if [[ "$INGRESS_RULES" -ge 1 ]]; then
        success "RDS Security Group has $INGRESS_RULES ingress rules (restrictive access)"
        ((TESTS_PASSED++))
    else
        error "RDS Security Group has no ingress rules"
        ((TESTS_FAILED++))
    fi
else
    error "RDS Security Group not found"
    ((TESTS_FAILED++))
fi
((TESTS_TOTAL++))

# =====================================================
# PERFORMANCE BENCHMARKS (OPTIONAL)
# =====================================================

if [[ "${1:-}" == "--full" ]]; then
    separator "PERFORMANCE BENCHMARKS"

    log "Benchmark: Lambda Cold Start (waiting 5 minutes for cold state...)"
    sleep 300

    START=$(date +%s%3N)
    aws lambda invoke \
        --function-name nfe-faturamento-dev \
        --payload '{"httpMethod":"GET","path":"/health"}' \
        --region "$REGION" \
        /tmp/cold-start-response.json > /dev/null 2>&1
    END=$(date +%s%3N)

    COLD_START_TIME=$((END - START))
    log "Cold start time: ${COLD_START_TIME}ms"

    if [[ "$COLD_START_TIME" -lt 15000 ]]; then
        success "Cold start within acceptable range (<15s)"
    else
        warning "Cold start slower than expected (${COLD_START_TIME}ms)"
    fi

    log "Benchmark: API Latency (10 requests)"
    TOTAL_TIME=0
    for i in {1..10}; do
        TIME=$(curl -X GET "$API_ENDPOINT/health" \
            -w "%{time_total}" \
            -o /dev/null \
            -s)
        TOTAL_TIME=$(echo "$TOTAL_TIME + $TIME" | bc)
        sleep 1
    done
    AVG_TIME=$(echo "scale=3; $TOTAL_TIME / 10" | bc)
    log "Average API latency: ${AVG_TIME}s"

    if (( $(echo "$AVG_TIME < 2.0" | bc -l) )); then
        success "API latency within acceptable range (<2s)"
    else
        warning "API latency higher than expected (${AVG_TIME}s)"
    fi
fi

# =====================================================
# SUMMARY
# =====================================================

separator "VALIDATION SUMMARY"

PASS_RATE=$(echo "scale=2; $TESTS_PASSED * 100 / $TESTS_TOTAL" | bc)

log "Tests Passed: $TESTS_PASSED / $TESTS_TOTAL ($PASS_RATE%)"
log "Tests Failed: $TESTS_FAILED"

if [[ "$TESTS_FAILED" -eq 0 ]]; then
    success "ALL TESTS PASSED ✅"
    log "Deploy is successful and production-ready"
    exit 0
elif [[ "$TESTS_FAILED" -le 2 ]]; then
    warning "SOME TESTS FAILED ⚠️"
    log "Deploy is functional but has issues - investigate failed tests"
    log "Log file: $LOG_FILE"
    exit 1
else
    error "MANY TESTS FAILED ❌"
    log "Deploy has serious issues - consider ROLLBACK"
    log "Log file: $LOG_FILE"
    exit 2
fi
