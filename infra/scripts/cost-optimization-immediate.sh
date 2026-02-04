#!/bin/bash
# AWS Cost Optimization - IMMEDIATE ACTIONS
# Created: 2026-01-29
# Purpose: Reduce AWS costs by 78% ($39/month savings)

set -e

REGION="us-east-1"
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AWS COST OPTIMIZATION - IMMEDIATE ACTIONS${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Function to ask for confirmation
confirm() {
    read -p "$(echo -e ${YELLOW}$1 [y/N]:${NC}) " response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# ACTION 1: Stop EmailTriageAI EC2 Instance (Saving: $8.39/month)
echo -e "${YELLOW}ACTION 1: Stop EC2 Instance EmailTriageAI${NC}"
echo "Instance ID: i-01052b975ba194c38"
echo "Type: t3.micro"
echo "Potential Savings: $8.39/month"
echo ""

if confirm "Do you want to STOP this instance?"; then
    echo "Stopping instance i-01052b975ba194c38..."
    aws ec2 stop-instances --instance-ids i-01052b975ba194c38 --region $REGION
    echo -e "${GREEN}✓ Instance stopped${NC}"
    echo ""

    if confirm "Do you want to TERMINATE this instance permanently? (This cannot be undone)"; then
        echo -e "${RED}Terminating instance i-01052b975ba194c38...${NC}"
        aws ec2 terminate-instances --instance-ids i-01052b975ba194c38 --region $REGION
        echo -e "${GREEN}✓ Instance terminated${NC}"
        SAVING_EC2=8.39
    else
        echo -e "${YELLOW}Instance stopped but not terminated. Remember to start it manually if needed.${NC}"
        SAVING_EC2=8.39
    fi
else
    echo -e "${YELLOW}Skipping EC2 instance stop${NC}"
    SAVING_EC2=0
fi

echo ""
echo "=========================================="
echo ""

# ACTION 2: Check and delete duplicate VPC
echo -e "${YELLOW}ACTION 2: Check VPC vpc-0190508da1f74ce0d (Possible Duplicate)${NC}"
echo "VPC Name: nfe-vpc (old)"
echo "VPC ID: vpc-0190508da1f74ce0d"
echo ""

echo "Checking for resources in VPC..."
SUBNETS=$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=vpc-0190508da1f74ce0d" --region $REGION --query 'Subnets[*].SubnetId' --output text)
ENI=$(aws ec2 describe-network-interfaces --filters "Name=vpc-id,Values=vpc-0190508da1f74ce0d" --region $REGION --query 'NetworkInterfaces[*].NetworkInterfaceId' --output text)

if [ -z "$SUBNETS" ] && [ -z "$ENI" ]; then
    echo -e "${GREEN}VPC appears to be empty (no subnets or ENIs)${NC}"

    if confirm "Do you want to DELETE this VPC?"; then
        echo "Deleting VPC vpc-0190508da1f74ce0d..."
        aws ec2 delete-vpc --vpc-id vpc-0190508da1f74ce0d --region $REGION 2>/dev/null || echo -e "${RED}Failed to delete VPC. May have dependencies (IGW, Route Tables, etc.)${NC}"
        echo -e "${GREEN}✓ VPC deletion attempted${NC}"
    else
        echo -e "${YELLOW}Skipping VPC deletion${NC}"
    fi
else
    echo -e "${RED}VPC is NOT empty. Subnets: $SUBNETS | ENIs: $ENI${NC}"
    echo -e "${YELLOW}Manual cleanup required before deletion${NC}"
fi

echo ""
echo "=========================================="
echo ""

# ACTION 3: Delete VPC Interface Endpoints (Saving: $21.90/month)
echo -e "${YELLOW}ACTION 3: Delete VPC Interface Endpoints (DEV Environment Only)${NC}"
echo "Endpoints:"
echo "  - vpce-0a0aff9ce09d31a6e (SQS)           - $7.30/month"
echo "  - vpce-0398750a084ae4b6b (Secrets Mgr)   - $7.30/month"
echo "  - vpce-09fd8fb6127de41a9 (EventBridge)   - $7.30/month"
echo "Total Potential Savings: $21.90/month"
echo ""
echo -e "${RED}WARNING: This will affect Lambda connectivity!${NC}"
echo -e "${YELLOW}Lambdas in VPC will lose access to SQS, Secrets Manager, and EventBridge${NC}"
echo -e "${YELLOW}unless you implement NAT Gateway or move Lambdas out of VPC${NC}"
echo ""

if confirm "Do you want to DELETE these Interface Endpoints? (Recommended ONLY if CDK changes are ready)"; then
    echo "Deleting Interface Endpoints..."
    aws ec2 delete-vpc-endpoints \
        --vpc-endpoint-ids vpce-0a0aff9ce09d31a6e vpce-0398750a084ae4b6b vpce-09fd8fb6127de41a9 \
        --region $REGION
    echo -e "${GREEN}✓ Interface Endpoints deleted${NC}"
    echo -e "${YELLOW}IMPORTANT: Update CDK to move Lambdas out of VPC or add NAT Gateway${NC}"
    SAVING_ENDPOINTS=21.90
else
    echo -e "${YELLOW}Skipping VPC Endpoint deletion${NC}"
    echo -e "${YELLOW}Consider implementing CDK changes first (see COST_REPORT.md section 5)${NC}"
    SAVING_ENDPOINTS=0
fi

echo ""
echo "=========================================="
echo ""

# SUMMARY
echo -e "${GREEN}COST OPTIMIZATION SUMMARY${NC}"
echo "=========================================="
TOTAL_SAVING=$(echo "$SAVING_EC2 + $SAVING_ENDPOINTS" | bc)
echo -e "EC2 Savings:           ${GREEN}\$$SAVING_EC2/month${NC}"
echo -e "VPC Endpoint Savings:  ${GREEN}\$$SAVING_ENDPOINTS/month${NC}"
echo -e "----------------------------------------"
echo -e "TOTAL IMMEDIATE SAVINGS: ${GREEN}\$$TOTAL_SAVING/month${NC}"
echo ""
echo -e "${YELLOW}NEXT STEPS:${NC}"
echo "1. Implement RDS Start/Stop scheduler (additional $8.71/month savings)"
echo "2. Update CDK to move non-RDS Lambdas out of VPC"
echo "3. Deploy updated CDK stacks"
echo "4. Set up AWS Budgets alerts at $50/month threshold"
echo ""
echo "See COST_REPORT.md for detailed implementation guide."
echo ""
