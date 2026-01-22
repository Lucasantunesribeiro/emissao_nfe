#!/bin/bash

# ================================================================
# NFe Infrastructure Destroy Script
# Author: DevOps Team
# Description: Safe cleanup of CDK infrastructure with confirmations
# ================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================================${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

prompt_environment() {
    echo ""
    print_header "Select Environment to DESTROY"
    echo "1) dev   - Development"
    echo "2) prod  - Production"
    echo ""
    read -p "Enter choice [1 or 2]: " env_choice

    case $env_choice in
        1)
            ENVIRONMENT="dev"
            ;;
        2)
            ENVIRONMENT="prod"
            ;;
        *)
            print_error "Invalid choice. Exiting."
            exit 1
            ;;
    esac
}

confirm_destruction() {
    echo ""
    print_header "⚠️  DANGER ZONE ⚠️"
    echo ""
    echo "Environment: ${RED}$ENVIRONMENT${NC}"
    echo ""
    print_warning "This will PERMANENTLY DELETE the following resources:"
    echo "  - VPC and all networking components"
    echo "  - RDS PostgreSQL database (with all data!)"
    echo "  - Amazon MQ RabbitMQ broker"
    echo "  - ECS Fargate services and tasks"
    echo "  - Application Load Balancer"
    echo "  - S3 buckets (including frontend files)"
    echo "  - CloudFront distribution"
    echo "  - Secrets Manager secrets"
    echo "  - CloudWatch logs and alarms"
    echo ""

    if [ "$ENVIRONMENT" = "prod" ]; then
        echo -e "${RED}========================================${NC}"
        echo -e "${RED}  ⚠️  PRODUCTION DESTRUCTION WARNING ⚠️${NC}"
        echo -e "${RED}========================================${NC}"
        echo ""
        print_warning "You are about to destroy PRODUCTION infrastructure!"
        print_warning "This operation is IRREVERSIBLE!"
        echo ""
    fi

    # First confirmation
    read -p "Type 'DELETE' to confirm destruction: " confirm1

    if [ "$confirm1" != "DELETE" ]; then
        print_error "Destruction cancelled."
        exit 0
    fi

    # Second confirmation (for prod)
    if [ "$ENVIRONMENT" = "prod" ]; then
        echo ""
        read -p "Type the environment name '$ENVIRONMENT' to confirm: " confirm2

        if [ "$confirm2" != "$ENVIRONMENT" ]; then
            print_error "Destruction cancelled."
            exit 0
        fi
    fi

    # Final countdown
    echo ""
    print_warning "Destruction will begin in 10 seconds. Press Ctrl+C to cancel."
    for i in {10..1}; do
        echo -ne "${RED}$i...${NC} "
        sleep 1
    done
    echo ""
}

empty_s3_buckets() {
    print_header "Emptying S3 Buckets"

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

    # Frontend bucket
    FRONTEND_BUCKET="nfe-frontend-$ENVIRONMENT-$ACCOUNT_ID"
    if aws s3 ls "s3://$FRONTEND_BUCKET" 2>/dev/null; then
        print_warning "Emptying bucket: $FRONTEND_BUCKET"
        aws s3 rm "s3://$FRONTEND_BUCKET" --recursive
        print_success "Bucket emptied: $FRONTEND_BUCKET"
    fi

    # CloudFront logs bucket (prod only)
    if [ "$ENVIRONMENT" = "prod" ]; then
        LOGS_BUCKET="nfe-cloudfront-logs-$ENVIRONMENT-$ACCOUNT_ID"
        if aws s3 ls "s3://$LOGS_BUCKET" 2>/dev/null; then
            print_warning "Emptying bucket: $LOGS_BUCKET"
            aws s3 rm "s3://$LOGS_BUCKET" --recursive
            print_success "Bucket emptied: $LOGS_BUCKET"
        fi
    fi
}

disable_deletion_protection() {
    if [ "$ENVIRONMENT" = "prod" ]; then
        print_header "Disabling Deletion Protection (PROD)"

        # Disable RDS deletion protection
        DB_IDENTIFIER="nfe-db-$ENVIRONMENT"
        print_warning "Disabling deletion protection for RDS: $DB_IDENTIFIER"
        aws rds modify-db-instance \
            --db-instance-identifier "$DB_IDENTIFIER" \
            --no-deletion-protection \
            --apply-immediately \
            2>/dev/null || print_warning "RDS instance not found or already disabled"

        # Disable ALB deletion protection
        ALB_ARN=$(aws elbv2 describe-load-balancers \
            --names "nfe-alb-$ENVIRONMENT" \
            --query 'LoadBalancers[0].LoadBalancerArn' \
            --output text 2>/dev/null || echo "")

        if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
            print_warning "Disabling deletion protection for ALB"
            aws elbv2 modify-load-balancer-attributes \
                --load-balancer-arn "$ALB_ARN" \
                --attributes Key=deletion_protection.enabled,Value=false \
                2>/dev/null || print_warning "Failed to disable ALB deletion protection"
        fi

        print_success "Deletion protection disabled"
    fi
}

destroy_stacks() {
    print_header "Destroying CDK Stacks"

    cd "$(dirname "$0")/../cdk"

    cdk destroy --all --context environment=$ENVIRONMENT --force

    print_success "All stacks destroyed!"
}

cleanup_ecr_images() {
    print_header "Cleaning Up ECR Images"

    # ECR repositories são destruídos automaticamente pelo CDK
    # mas podemos forçar limpeza se necessário

    print_success "ECR cleanup complete"
}

show_summary() {
    print_header "Destruction Summary"

    echo ""
    print_success "Infrastructure for environment '$ENVIRONMENT' has been destroyed."
    echo ""
    echo "Cleaned up resources:"
    echo "  ✅ VPC and networking"
    echo "  ✅ RDS PostgreSQL database"
    echo "  ✅ Amazon MQ RabbitMQ broker"
    echo "  ✅ ECS Fargate services"
    echo "  ✅ Application Load Balancer"
    echo "  ✅ S3 buckets"
    echo "  ✅ CloudFront distribution"
    echo "  ✅ Secrets Manager secrets"
    echo "  ✅ CloudWatch resources"
    echo ""
    print_success "Destruction complete! 🗑️"
}

# ================================================================
# MAIN
# ================================================================

main() {
    prompt_environment
    confirm_destruction
    empty_s3_buckets
    disable_deletion_protection
    destroy_stacks
    cleanup_ecr_images
    show_summary
}

main "$@"
