#!/bin/bash

# ================================================================
# NFe Infrastructure Deployment Script
# Author: DevOps Team
# Description: Wrapper script for CDK deployment with safety prompts
# ================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ================================================================
# FUNCTIONS
# ================================================================

print_header() {
    echo -e "${BLUE}================================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

check_prerequisites() {
    print_header "Checking Prerequisites"

    # Check AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI not found. Install: https://aws.amazon.com/cli/"
        exit 1
    fi
    print_success "AWS CLI installed"

    # Check CDK CLI
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK CLI not found. Install: npm install -g aws-cdk"
        exit 1
    fi
    print_success "AWS CDK CLI installed"

    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js not found. Install: https://nodejs.org/"
        exit 1
    fi
    print_success "Node.js installed ($(node --version))"

    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "AWS credentials not configured. Run: aws configure"
        exit 1
    fi

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    REGION=$(aws configure get region || echo "us-east-1")
    print_success "AWS credentials configured (Account: $ACCOUNT_ID, Region: $REGION)"
}

prompt_environment() {
    echo ""
    print_header "Select Environment"
    echo "1) dev   - Development (Single-AZ, no auto-scaling)"
    echo "2) prod  - Production (Multi-AZ, auto-scaling enabled)"
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

    print_success "Selected environment: $ENVIRONMENT"
}

confirm_deployment() {
    echo ""
    print_header "Deployment Confirmation"
    echo "Environment: ${YELLOW}$ENVIRONMENT${NC}"
    echo "Region: ${YELLOW}$REGION${NC}"
    echo "Account: ${YELLOW}$ACCOUNT_ID${NC}"
    echo ""
    print_warning "This will deploy the following stacks:"
    echo "  - Network Stack (VPC, Subnets, Security Groups)"
    echo "  - Secrets Stack (Secrets Manager)"
    echo "  - Database Stack (RDS PostgreSQL)"
    echo "  - Messaging Stack (Amazon MQ RabbitMQ)"
    echo "  - Compute Stack (ECS Fargate, ECR)"
    echo "  - Load Balancer Stack (ALB)"
    echo "  - Frontend Stack (S3 + CloudFront)"
    echo ""

    if [ "$ENVIRONMENT" = "prod" ]; then
        print_warning "PRODUCTION DEPLOYMENT - Resources will have deletion protection enabled!"
    fi

    echo ""
    read -p "Continue with deployment? [y/N]: " confirm

    if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
        print_error "Deployment cancelled by user."
        exit 0
    fi
}

bootstrap_cdk() {
    print_header "Bootstrapping CDK (if needed)"

    if aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION &> /dev/null; then
        print_success "CDK already bootstrapped"
    else
        print_warning "Bootstrapping CDK for the first time..."
        cdk bootstrap aws://$ACCOUNT_ID/$REGION
        print_success "CDK bootstrap complete"
    fi
}

install_dependencies() {
    print_header "Installing Dependencies"

    cd "$(dirname "$0")/../cdk"

    if [ ! -d "node_modules" ]; then
        npm install
        print_success "Dependencies installed"
    else
        print_success "Dependencies already installed"
    fi
}

build_project() {
    print_header "Building TypeScript Project"

    npm run build
    print_success "Build complete"
}

synth_stacks() {
    print_header "Synthesizing CloudFormation Templates"

    cdk synth --context environment=$ENVIRONMENT
    print_success "Synth complete"
}

deploy_stacks() {
    print_header "Deploying Stacks to AWS"

    if [ "$ENVIRONMENT" = "dev" ]; then
        cdk deploy --all --context environment=$ENVIRONMENT --require-approval never
    else
        cdk deploy --all --context environment=$ENVIRONMENT --require-approval broadening
    fi

    print_success "Deployment complete!"
}

show_outputs() {
    print_header "Deployment Outputs"

    echo ""
    echo "Retrieving stack outputs..."
    echo ""

    # Get important outputs
    ALB_DNS=$(aws cloudformation describe-stacks \
        --stack-name "nfe-loadbalancer-$ENVIRONMENT" \
        --query 'Stacks[0].Outputs[?OutputKey==`AlbDnsName`].OutputValue' \
        --output text 2>/dev/null || echo "N/A")

    CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
        --stack-name "nfe-frontend-$ENVIRONMENT" \
        --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
        --output text 2>/dev/null || echo "N/A")

    DB_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "nfe-database-$ENVIRONMENT" \
        --query 'Stacks[0].Outputs[?OutputKey==`DbEndpoint`].OutputValue' \
        --output text 2>/dev/null || echo "N/A")

    echo "🌐 ALB URL: ${GREEN}http://$ALB_DNS${NC}"
    echo "☁️  CloudFront URL: ${GREEN}$CLOUDFRONT_URL${NC}"
    echo "🗄️  Database Endpoint: ${GREEN}$DB_ENDPOINT${NC}"
    echo ""

    print_header "Next Steps"
    echo "1. Build and push Docker images to ECR:"
    echo "   ${YELLOW}./build-images.sh $ENVIRONMENT${NC}"
    echo ""
    echo "2. Create database schemas:"
    echo "   ${YELLOW}psql -h $DB_ENDPOINT -U nfeadmin -d nfe_db -f create-schemas.sql${NC}"
    echo ""
    echo "3. Update Secrets Manager with MQ endpoint:"
    echo "   ${YELLOW}aws secretsmanager put-secret-value --secret-id nfe/mq/url-$ENVIRONMENT --secret-string 'amqps://user:pass@endpoint:5671/'${NC}"
    echo ""
    echo "4. Deploy frontend to S3:"
    echo "   ${YELLOW}npm run build && aws s3 sync ./dist s3://nfe-frontend-$ENVIRONMENT-$ACCOUNT_ID/${NC}"
    echo ""
    print_success "Deployment successful! 🎉"
}

# ================================================================
# MAIN
# ================================================================

main() {
    check_prerequisites
    prompt_environment
    confirm_deployment
    bootstrap_cdk
    install_dependencies
    build_project
    synth_stacks
    deploy_stacks
    show_outputs
}

main "$@"
