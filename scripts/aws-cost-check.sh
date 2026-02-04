#!/bin/bash
################################################################################
# AWS COST CHECK - Quick Resource Overview
#
# Lightweight script to quickly check AWS resources and estimated costs
# Always safe - NEVER makes any changes
#
# Usage: ./scripts/aws-cost-check.sh [--region REGION] [--profile PROFILE]
################################################################################

set -euo pipefail

# Configuration
REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-}"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# AWS CLI wrapper
aws_cmd() {
    if [[ -n "$AWS_PROFILE" ]]; then
        aws --profile "$AWS_PROFILE" --region "$REGION" "$@" 2>/dev/null
    else
        aws --region "$REGION" "$@" 2>/dev/null
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --region)
            REGION="$2"
            shift 2
            ;;
        --profile)
            AWS_PROFILE="$2"
            shift 2
            ;;
        --help)
            echo "Usage: $0 [--region REGION] [--profile PROFILE]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}           AWS COST CHECK - Resource Overview              ${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""

# Check credentials
echo -e "${BLUE}Checking AWS credentials...${NC}"
if ! aws_cmd sts get-caller-identity &>/dev/null; then
    echo -e "${RED}✗ AWS credentials not configured${NC}"
    echo "Run: aws configure"
    exit 1
fi

ACCOUNT=$(aws_cmd sts get-caller-identity --query 'Account' --output text)
echo -e "${GREEN}✓ Connected to account: $ACCOUNT${NC}"
echo -e "${GREEN}✓ Region: $REGION${NC}"
echo ""

TOTAL_MONTHLY_COST=0

# EC2 Instances
echo -e "${BOLD}━━━ EC2 Instances ━━━${NC}"
EC2_INSTANCES=$(aws_cmd ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running,stopped" \
    --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
    --output json || echo '[]')

EC2_COUNT=$(echo "$EC2_INSTANCES" | jq '. | length')
if [[ $EC2_COUNT -eq 0 ]]; then
    echo "No EC2 instances found"
else
    echo "$EC2_INSTANCES" | jq -r '.[] | "  • " + .[0] + " (" + .[1] + ") - " + .[2] + " - " + (.[3] // "no-name")'
    RUNNING_COUNT=$(echo "$EC2_INSTANCES" | jq '[.[] | select(.[1] == "running")] | length')
    if [[ $RUNNING_COUNT -gt 0 ]]; then
        EC2_COST=$(echo "$RUNNING_COUNT * 10" | bc)
        TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $EC2_COST" | bc)
        echo -e "  ${YELLOW}Est. cost: \$${EC2_COST}/month${NC}"
    fi
fi
echo ""

# RDS Instances
echo -e "${BOLD}━━━ RDS Instances ━━━${NC}"
RDS_INSTANCES=$(aws_cmd rds describe-db-instances \
    --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,DBInstanceClass,Engine]' \
    --output json || echo '[]')

RDS_COUNT=$(echo "$RDS_INSTANCES" | jq '. | length')
if [[ $RDS_COUNT -eq 0 ]]; then
    echo "No RDS instances found"
else
    echo "$RDS_INSTANCES" | jq -r '.[] | "  • " + .[0] + " (" + .[1] + ") - " + .[2] + " - " + .[3]'
    AVAILABLE_COUNT=$(echo "$RDS_INSTANCES" | jq '[.[] | select(.[1] == "available")] | length')
    if [[ $AVAILABLE_COUNT -gt 0 ]]; then
        RDS_COST=$(echo "$AVAILABLE_COUNT * 20" | bc)
        TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $RDS_COST" | bc)
        echo -e "  ${YELLOW}Est. cost: \$${RDS_COST}/month${NC}"
    fi
fi
echo ""

# VPC Endpoints
echo -e "${BOLD}━━━ VPC Interface Endpoints ━━━${NC}"
VPC_ENDPOINTS=$(aws_cmd ec2 describe-vpc-endpoints \
    --filters "Name=vpc-endpoint-type,Values=Interface" \
    --query 'VpcEndpoints[].[VpcEndpointId,ServiceName,State]' \
    --output json || echo '[]')

VPC_COUNT=$(echo "$VPC_ENDPOINTS" | jq '. | length')
if [[ $VPC_COUNT -eq 0 ]]; then
    echo "No VPC Interface Endpoints found"
else
    echo "$VPC_ENDPOINTS" | jq -r '.[] | "  • " + .[0] + " - " + (.[1] | split(".") | .[-1]) + " (" + .[2] + ")"'
    VPC_COST=$(echo "$VPC_COUNT * 7.3" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $VPC_COST" | bc)
    echo -e "  ${YELLOW}Est. cost: \$${VPC_COST}/month (\$7.30/endpoint)${NC}"
fi
echo ""

# EBS Volumes (orphans)
echo -e "${BOLD}━━━ EBS Volumes (Unattached) ━━━${NC}"
EBS_VOLUMES=$(aws_cmd ec2 describe-volumes \
    --filters "Name=status,Values=available" \
    --query 'Volumes[].[VolumeId,Size,VolumeType]' \
    --output json || echo '[]')

EBS_COUNT=$(echo "$EBS_VOLUMES" | jq '. | length')
if [[ $EBS_COUNT -eq 0 ]]; then
    echo "No orphan EBS volumes found"
else
    echo "$EBS_VOLUMES" | jq -r '.[] | "  • " + .[0] + " - " + (.[1]|tostring) + "GB " + .[2]'
    TOTAL_SIZE=$(echo "$EBS_VOLUMES" | jq '[.[][1]] | add // 0')
    EBS_COST=$(echo "$TOTAL_SIZE * 0.09" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $EBS_COST" | bc)
    echo -e "  ${YELLOW}Est. cost: \$${EBS_COST}/month${NC}"
fi
echo ""

# Elastic IPs (unattached)
echo -e "${BOLD}━━━ Elastic IPs (Unattached) ━━━${NC}"
ELASTIC_IPS=$(aws_cmd ec2 describe-addresses \
    --filters "Name=domain,Values=vpc" \
    --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
    --output json || echo '[]')

EIP_COUNT=$(echo "$ELASTIC_IPS" | jq '. | length')
if [[ $EIP_COUNT -eq 0 ]]; then
    echo "No unattached Elastic IPs found"
else
    echo "$ELASTIC_IPS" | jq -r '.[] | "  • " + .[0] + " (" + .[1] + ")"'
    EIP_COST=$(echo "$EIP_COUNT * 3.6" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $EIP_COST" | bc)
    echo -e "  ${YELLOW}Est. cost: \$${EIP_COST}/month (\$3.60/IP)${NC}"
fi
echo ""

# Load Balancers
echo -e "${BOLD}━━━ Load Balancers ━━━${NC}"
LOAD_BALANCERS=$(aws_cmd elbv2 describe-load-balancers \
    --query 'LoadBalancers[].[LoadBalancerName,Type,State.Code]' \
    --output json 2>/dev/null || echo '[]')

LB_COUNT=$(echo "$LOAD_BALANCERS" | jq '. | length')
if [[ $LB_COUNT -eq 0 ]]; then
    echo "No Application/Network Load Balancers found"
else
    echo "$LOAD_BALANCERS" | jq -r '.[] | "  • " + .[0] + " (" + .[1] + ") - " + .[2]'
    LB_COST=$(echo "$LB_COUNT * 20" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $LB_COST" | bc)
    echo -e "  ${YELLOW}Est. cost: \$${LB_COST}/month${NC}"
fi
echo ""

# NAT Gateways
echo -e "${BOLD}━━━ NAT Gateways ━━━${NC}"
NAT_GATEWAYS=$(aws_cmd ec2 describe-nat-gateways \
    --filter "Name=state,Values=available" \
    --query 'NatGateways[].[NatGatewayId,State]' \
    --output json || echo '[]')

NAT_COUNT=$(echo "$NAT_GATEWAYS" | jq '. | length')
if [[ $NAT_COUNT -eq 0 ]]; then
    echo "No NAT Gateways found"
else
    echo "$NAT_GATEWAYS" | jq -r '.[] | "  • " + .[0] + " (" + .[1] + ")"'
    NAT_COST=$(echo "$NAT_COUNT * 32" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $NAT_COST" | bc)
    echo -e "  ${RED}Est. cost: \$${NAT_COST}/month (\$32/gateway) - HIGH COST!${NC}"
fi
echo ""

# ECS Clusters
echo -e "${BOLD}━━━ ECS Clusters ━━━${NC}"
ECS_CLUSTERS=$(aws_cmd ecs list-clusters --query 'clusterArns[]' --output json || echo '[]')
ECS_COUNT=$(echo "$ECS_CLUSTERS" | jq '. | length')

if [[ $ECS_COUNT -eq 0 ]]; then
    echo "No ECS clusters found"
else
    echo "$ECS_CLUSTERS" | jq -r '.[] | "  • " + (. | split("/") | .[-1])'

    # Count running tasks
    TOTAL_TASKS=0
    echo "$ECS_CLUSTERS" | jq -r '.[]' | while read -r cluster_arn; do
        CLUSTER_NAME=$(basename "$cluster_arn")
        TASKS=$(aws_cmd ecs list-tasks --cluster "$CLUSTER_NAME" --query 'taskArns[]' --output json | jq '. | length')
        TOTAL_TASKS=$((TOTAL_TASKS + TASKS))
    done

    if [[ $TOTAL_TASKS -gt 0 ]]; then
        echo -e "  ${YELLOW}Running tasks may incur EC2/Fargate costs${NC}"
    fi
fi
echo ""

# Summary
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}                    COST SUMMARY                           ${NC}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Total Estimated Monthly Cost: ${YELLOW}\$$(printf "%.2f" $TOTAL_MONTHLY_COST)${NC}"
echo ""

if (( $(echo "$TOTAL_MONTHLY_COST > 30" | bc -l) )); then
    echo -e "${RED}⚠️  HIGH COST DETECTED${NC}"
    echo "Consider running the kill-switch to reduce costs:"
    echo "  ./scripts/aws-cost-kill-switch.sh --dry-run"
elif (( $(echo "$TOTAL_MONTHLY_COST > 10" | bc -l) )); then
    echo -e "${YELLOW}💰 Moderate costs detected${NC}"
    echo "You may want to optimize resources:"
    echo "  ./scripts/aws-cost-kill-switch.sh --dry-run"
else
    echo -e "${GREEN}✓ Costs are relatively low${NC}"
fi

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Note: These are rough estimates. Check AWS Cost Explorer for accurate costs."
echo "Data transfer, API calls, and other services not included in this estimate."
echo ""
