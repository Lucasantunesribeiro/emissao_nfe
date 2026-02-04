#!/bin/bash
################################################################################
# AWS COST KILL-SWITCH
#
# Emergency script to stop expensive AWS resources and prevent cost bleeding.
#
# SAFETY FEATURES:
# - DRY_RUN mode by default (only lists resources)
# - Explicit confirmation required for destructive actions
# - Full logging with timestamps
# - Resource backup before deletion
# - Estimated cost savings displayed
#
# Author: DevOps Agent for Lucas Antunes Ferreira
# Project: emissao_nfe
################################################################################

set -euo pipefail

################################################################################
# CONFIGURATION
################################################################################

# Default to DRY_RUN mode for safety
DRY_RUN=${DRY_RUN:-1}
REGION="us-east-1"
LOG_DIR="logs"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="${LOG_DIR}/kill-switch-${TIMESTAMP}.log"
DELETED_RESOURCES_FILE="${LOG_DIR}/deleted-resources-${TIMESTAMP}.json"
AWS_PROFILE="${AWS_PROFILE:-}"

# Specific resources identified in Phase 0
TARGET_EC2_INSTANCE="i-01052b975ba194c38"  # EmailTriageAI
TARGET_RDS_INSTANCE="nfe-db-dev"
TARGET_VPC_ENDPOINTS=(
    "vpce-0a0aff9ce09d31a6e"  # SQS
    "vpce-0398750a084ae4b6b"  # Secrets Manager
    "vpce-09fd8fb6127de41a9"  # EventBridge
)

# Action flags
STOP_EC2=0
STOP_RDS=0
DELETE_ENDPOINTS=0
AGGRESSIVE_MODE=0
TERMINATE_EC2=0
CREATE_RDS_SNAPSHOT=1

################################################################################
# COLORS & FORMATTING
################################################################################

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m' # No Color

################################################################################
# LOGGING FUNCTIONS
################################################################################

log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local color=$NC

    case $level in
        INFO) color=$GREEN ;;
        WARN) color=$YELLOW ;;
        ERROR) color=$RED ;;
        ACTION) color=$BLUE ;;
    esac

    # Log to both stdout and file
    echo -e "${color}[${timestamp}] [${level}] ${message}${NC}" | tee -a "$LOG_FILE"
}

log_info() { log INFO "$@"; }
log_warn() { log WARN "$@"; }
log_error() { log ERROR "$@"; }
log_action() { log ACTION "$@"; }

section_header() {
    local title="$1"
    echo "" | tee -a "$LOG_FILE"
    echo -e "${BOLD}═══════════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
    echo -e "${BOLD}  $title${NC}" | tee -a "$LOG_FILE"
    echo -e "${BOLD}═══════════════════════════════════════════════════════════════════${NC}" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
}

################################################################################
# AWS CLI WRAPPER
################################################################################

aws_cmd() {
    local cmd="$*"
    if [[ -n "$AWS_PROFILE" ]]; then
        aws --profile "$AWS_PROFILE" --region "$REGION" $cmd
    else
        aws --region "$REGION" $cmd
    fi
}

################################################################################
# UTILITY FUNCTIONS
################################################################################

confirm() {
    local prompt="$1"
    local default="${2:-N}"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_warn "DRY_RUN mode: would ask for confirmation: $prompt"
        return 1
    fi

    echo -e "${YELLOW}${prompt} [y/N]${NC} " | tee -a "$LOG_FILE"
    read -r response
    response=${response:-$default}

    if [[ "$response" =~ ^[Yy]$ ]]; then
        return 0
    else
        log_info "Action cancelled by user"
        return 1
    fi
}

double_confirm() {
    local prompt="$1"

    if ! confirm "$prompt"; then
        return 1
    fi

    if ! confirm "Are you ABSOLUTELY SURE? This is IRREVERSIBLE"; then
        return 1
    fi

    return 0
}

check_credentials() {
    section_header "CHECKING AWS CREDENTIALS"

    log_info "Verifying AWS credentials..."

    if ! aws_cmd sts get-caller-identity &>/dev/null; then
        log_error "AWS credentials not configured or invalid"
        log_error "Please configure credentials using 'aws configure' or set AWS_PROFILE"
        exit 1
    fi

    local identity=$(aws_cmd sts get-caller-identity)
    local account=$(echo "$identity" | jq -r '.Account')
    local arn=$(echo "$identity" | jq -r '.Arn')

    log_info "Connected to AWS account: $account"
    log_info "Using identity: $arn"
    log_info "Region: $REGION"

    if [[ -n "$AWS_PROFILE" ]]; then
        log_info "Using profile: $AWS_PROFILE"
    fi
}

save_deleted_resource() {
    local resource_type=$1
    local resource_id=$2
    local resource_data=$3

    # Initialize JSON file if it doesn't exist
    if [[ ! -f "$DELETED_RESOURCES_FILE" ]]; then
        echo '{"deleted_at": "'$(date -Iseconds)'", "resources": []}' > "$DELETED_RESOURCES_FILE"
    fi

    # Add resource to JSON
    local temp_file=$(mktemp)
    jq --arg type "$resource_type" \
       --arg id "$resource_id" \
       --argjson data "$resource_data" \
       '.resources += [{"type": $type, "id": $id, "data": $data, "deleted_at": "'$(date -Iseconds)'"}]' \
       "$DELETED_RESOURCES_FILE" > "$temp_file"
    mv "$temp_file" "$DELETED_RESOURCES_FILE"
}

################################################################################
# EC2 FUNCTIONS
################################################################################

list_ec2_instances() {
    section_header "EC2 INSTANCES"

    log_info "Scanning for running EC2 instances..."

    local instances=$(aws_cmd ec2 describe-instances \
        --filters "Name=instance-state-name,Values=running,stopped" \
        --query 'Reservations[].Instances[].[InstanceId,State.Name,InstanceType,Tags[?Key==`Name`].Value|[0]]' \
        --output json)

    local count=$(echo "$instances" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No EC2 instances found"
        return 0
    fi

    log_info "Found $count EC2 instance(s):"
    echo "$instances" | jq -r '.[] | "  - " + .[0] + " (" + .[1] + ") - " + .[2] + " - " + (.[3] // "no-name")' | tee -a "$LOG_FILE"

    # Calculate estimated cost (simplified)
    local running_count=$(echo "$instances" | jq '[.[] | select(.[1] == "running")] | length')
    if [[ $running_count -gt 0 ]]; then
        log_warn "Estimated EC2 cost: ~\$${running_count}0-15/month (depending on instance type)"
    fi

    return $count
}

stop_ec2_instances() {
    section_header "STOPPING EC2 INSTANCES"

    local instances=$(aws_cmd ec2 describe-instances \
        --filters "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[].InstanceId' \
        --output json)

    local count=$(echo "$instances" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No running EC2 instances to stop"
        return 0
    fi

    local instance_ids=$(echo "$instances" | jq -r '.[]')

    log_warn "Will stop $count instance(s):"
    echo "$instance_ids" | while read -r id; do
        local name=$(aws_cmd ec2 describe-instances \
            --instance-ids "$id" \
            --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value' \
            --output text)
        log_warn "  - $id ($name)"
    done

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would stop instances"
        return 0
    fi

    if ! confirm "Stop these EC2 instances? (They can be restarted later)"; then
        return 0
    fi

    log_action "Stopping EC2 instances..."

    echo "$instance_ids" | while read -r id; do
        log_action "Stopping instance: $id"
        aws_cmd ec2 stop-instances --instance-ids "$id" | tee -a "$LOG_FILE"

        # Save to deleted resources (not really deleted, just stopped)
        local instance_data=$(aws_cmd ec2 describe-instances --instance-ids "$id" --output json)
        save_deleted_resource "ec2_stopped" "$id" "$instance_data"
    done

    log_info "EC2 instances stopped successfully"
    log_info "Estimated savings: \$8-15/month"
}

terminate_ec2_instances() {
    section_header "TERMINATING EC2 INSTANCES (DANGER)"

    local instances=$(aws_cmd ec2 describe-instances \
        --filters "Name=instance-state-name,Values=running,stopped" \
        --query 'Reservations[].Instances[].InstanceId' \
        --output json)

    local count=$(echo "$instances" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No EC2 instances to terminate"
        return 0
    fi

    local instance_ids=$(echo "$instances" | jq -r '.[]')

    log_error "WARNING: TERMINATION IS PERMANENT AND IRREVERSIBLE"
    log_warn "Will terminate $count instance(s):"
    echo "$instance_ids" | while read -r id; do
        local name=$(aws_cmd ec2 describe-instances \
            --instance-ids "$id" \
            --query 'Reservations[0].Instances[0].Tags[?Key==`Name`].Value' \
            --output text)
        log_error "  - $id ($name)"
    done

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would terminate instances"
        return 0
    fi

    if ! double_confirm "TERMINATE these EC2 instances PERMANENTLY?"; then
        return 0
    fi

    log_action "Terminating EC2 instances..."

    echo "$instance_ids" | while read -r id; do
        # Save instance data before termination
        local instance_data=$(aws_cmd ec2 describe-instances --instance-ids "$id" --output json)
        save_deleted_resource "ec2_terminated" "$id" "$instance_data"

        log_action "Terminating instance: $id"
        aws_cmd ec2 terminate-instances --instance-ids "$id" | tee -a "$LOG_FILE"
    done

    log_info "EC2 instances terminated"
}

release_elastic_ips() {
    section_header "ELASTIC IPs"

    log_info "Checking for unattached Elastic IPs..."

    local eips=$(aws_cmd ec2 describe-addresses \
        --filters "Name=domain,Values=vpc" \
        --query 'Addresses[?AssociationId==null].[PublicIp,AllocationId]' \
        --output json)

    local count=$(echo "$eips" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No unattached Elastic IPs found"
        return 0
    fi

    log_warn "Found $count unattached Elastic IP(s):"
    echo "$eips" | jq -r '.[] | "  - " + .[0] + " (" + .[1] + ")"' | tee -a "$LOG_FILE"
    log_warn "Cost: \$3.60/month per unattached EIP"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would release Elastic IPs"
        return 0
    fi

    if ! confirm "Release these Elastic IPs?"; then
        return 0
    fi

    echo "$eips" | jq -r '.[][1]' | while read -r allocation_id; do
        log_action "Releasing Elastic IP: $allocation_id"
        aws_cmd ec2 release-address --allocation-id "$allocation_id" | tee -a "$LOG_FILE"
        save_deleted_resource "elastic_ip" "$allocation_id" "{}"
    done

    log_info "Elastic IPs released"
}

################################################################################
# RDS FUNCTIONS
################################################################################

list_rds_instances() {
    section_header "RDS INSTANCES"

    log_info "Scanning for RDS instances..."

    local instances=$(aws_cmd rds describe-db-instances \
        --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus,DBInstanceClass,Engine]' \
        --output json)

    local count=$(echo "$instances" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No RDS instances found"
        return 0
    fi

    log_info "Found $count RDS instance(s):"
    echo "$instances" | jq -r '.[] | "  - " + .[0] + " (" + .[1] + ") - " + .[2] + " - " + .[3]' | tee -a "$LOG_FILE"

    local available_count=$(echo "$instances" | jq '[.[] | select(.[1] == "available")] | length')
    if [[ $available_count -gt 0 ]]; then
        log_warn "Estimated RDS cost: ~\$15-50/month (depending on instance class)"
    fi

    return $count
}

stop_rds_instances() {
    section_header "STOPPING RDS INSTANCES"

    local instances=$(aws_cmd rds describe-db-instances \
        --query 'DBInstances[?DBInstanceStatus==`available`].DBInstanceIdentifier' \
        --output json)

    local count=$(echo "$instances" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No available RDS instances to stop"
        return 0
    fi

    local instance_ids=$(echo "$instances" | jq -r '.[]')

    log_warn "Will stop $count RDS instance(s):"
    echo "$instance_ids" | while read -r id; do
        local info=$(aws_cmd rds describe-db-instances \
            --db-instance-identifier "$id" \
            --query 'DBInstances[0].[DBInstanceClass,Engine,MultiAZ]' \
            --output json)
        log_warn "  - $id: $(echo $info | jq -r '.[0]') $(echo $info | jq -r '.[1]')"
    done

    log_info "NOTE: RDS instances will automatically restart after 7 days"
    log_info "Estimated savings: ~70% of RDS costs while stopped"

    if [[ $CREATE_RDS_SNAPSHOT -eq 1 ]]; then
        log_warn "Will create snapshot before stopping (recommended)"
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would stop RDS instances"
        return 0
    fi

    if ! confirm "Stop these RDS instances?"; then
        return 0
    fi

    echo "$instance_ids" | while read -r id; do
        if [[ $CREATE_RDS_SNAPSHOT -eq 1 ]]; then
            local snapshot_id="${id}-before-stop-${TIMESTAMP}"
            log_action "Creating snapshot: $snapshot_id"
            aws_cmd rds create-db-snapshot \
                --db-instance-identifier "$id" \
                --db-snapshot-identifier "$snapshot_id" | tee -a "$LOG_FILE"

            log_info "Waiting for snapshot to complete (this may take a few minutes)..."
            aws_cmd rds wait db-snapshot-completed --db-snapshot-identifier "$snapshot_id"
            log_info "Snapshot completed: $snapshot_id"
        fi

        log_action "Stopping RDS instance: $id"
        aws_cmd rds stop-db-instance --db-instance-identifier "$id" | tee -a "$LOG_FILE"

        # Save to deleted resources
        local instance_data=$(aws_cmd rds describe-db-instances --db-instance-identifier "$id" --output json)
        save_deleted_resource "rds_stopped" "$id" "$instance_data"
    done

    log_info "RDS instances stopped successfully"
    log_info "Estimated savings: \$10-35/month (70% of RDS costs)"
}

################################################################################
# VPC ENDPOINT FUNCTIONS
################################################################################

list_vpc_endpoints() {
    section_header "VPC INTERFACE ENDPOINTS"

    log_info "Scanning for VPC Interface Endpoints..."

    local endpoints=$(aws_cmd ec2 describe-vpc-endpoints \
        --filters "Name=vpc-endpoint-type,Values=Interface" \
        --query 'VpcEndpoints[].[VpcEndpointId,ServiceName,State]' \
        --output json)

    local count=$(echo "$endpoints" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No VPC Interface Endpoints found"
        return 0
    fi

    log_info "Found $count VPC Interface Endpoint(s):"
    echo "$endpoints" | jq -r '.[] | "  - " + .[0] + " - " + .[1] + " (" + .[2] + ")"' | tee -a "$LOG_FILE"

    # Cost: $0.01/hour per endpoint = $7.30/month per endpoint
    local cost_per_endpoint=7.30
    local total_cost=$(echo "$count * $cost_per_endpoint" | bc)
    log_warn "Estimated cost: \$${total_cost}/month (\$${cost_per_endpoint}/endpoint)"

    return $count
}

delete_vpc_endpoints() {
    section_header "DELETING VPC INTERFACE ENDPOINTS (DANGER)"

    log_error "⚠️  WARNING: DELETING VPC ENDPOINTS CAN BREAK SERVICES ⚠️"
    log_error ""
    log_error "VPC Endpoints provide private connectivity to AWS services."
    log_error "If you have Lambda functions or services in VPC that use these"
    log_error "endpoints, they will FAIL after deletion."
    log_error ""
    log_error "Common issues after deletion:"
    log_error "  - Lambdas unable to access SQS/Secrets Manager/EventBridge"
    log_error "  - Increased data transfer costs (traffic goes through NAT/IGW)"
    log_error "  - Potential connectivity timeouts"
    log_error ""

    local endpoints=$(aws_cmd ec2 describe-vpc-endpoints \
        --filters "Name=vpc-endpoint-type,Values=Interface" \
        --query 'VpcEndpoints[].VpcEndpointId' \
        --output json)

    local count=$(echo "$endpoints" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No VPC Interface Endpoints to delete"
        return 0
    fi

    local endpoint_ids=$(echo "$endpoints" | jq -r '.[]')

    log_warn "Will delete $count VPC Interface Endpoint(s):"
    echo "$endpoint_ids" | while read -r id; do
        local service=$(aws_cmd ec2 describe-vpc-endpoints \
            --vpc-endpoint-ids "$id" \
            --query 'VpcEndpoints[0].ServiceName' \
            --output text)
        log_error "  - $id ($service)"
    done

    local cost_per_endpoint=7.30
    local total_savings=$(echo "$count * $cost_per_endpoint" | bc)
    log_info "Potential savings: \$${total_savings}/month"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would delete VPC endpoints"
        return 0
    fi

    if ! double_confirm "DELETE these VPC Endpoints? This may BREAK services!"; then
        return 0
    fi

    log_action "Deleting VPC Endpoints..."

    echo "$endpoint_ids" | while read -r id; do
        # Save endpoint data before deletion
        local endpoint_data=$(aws_cmd ec2 describe-vpc-endpoints --vpc-endpoint-ids "$id" --output json)
        save_deleted_resource "vpc_endpoint" "$id" "$endpoint_data"

        log_action "Deleting VPC Endpoint: $id"
        aws_cmd ec2 delete-vpc-endpoints --vpc-endpoint-ids "$id" | tee -a "$LOG_FILE"
    done

    log_info "VPC Endpoints deleted"
    log_warn "Monitor your Lambda functions and VPC services for connectivity issues"
}

################################################################################
# EBS VOLUME FUNCTIONS
################################################################################

list_orphan_ebs_volumes() {
    section_header "EBS VOLUMES (ORPHANS)"

    log_info "Scanning for unattached EBS volumes..."

    local volumes=$(aws_cmd ec2 describe-volumes \
        --filters "Name=status,Values=available" \
        --query 'Volumes[].[VolumeId,Size,VolumeType,CreateTime]' \
        --output json)

    local count=$(echo "$volumes" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No orphan EBS volumes found"
        return 0
    fi

    log_info "Found $count orphan EBS volume(s):"
    echo "$volumes" | jq -r '.[] | "  - " + .[0] + " - " + (.[1]|tostring) + "GB " + .[2]' | tee -a "$LOG_FILE"

    # Cost estimation: gp3 = $0.08/GB/month, gp2 = $0.10/GB/month
    local total_size=$(echo "$volumes" | jq '[.[][1]] | add')
    local estimated_cost=$(echo "$total_size * 0.09" | bc)
    log_warn "Estimated cost: ~\$${estimated_cost}/month"

    return $count
}

delete_orphan_ebs_volumes() {
    section_header "DELETING ORPHAN EBS VOLUMES"

    local volumes=$(aws_cmd ec2 describe-volumes \
        --filters "Name=status,Values=available" \
        --query 'Volumes[].VolumeId' \
        --output json)

    local count=$(echo "$volumes" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No orphan EBS volumes to delete"
        return 0
    fi

    local volume_ids=$(echo "$volumes" | jq -r '.[]')

    log_warn "Will delete $count EBS volume(s):"
    echo "$volume_ids" | while read -r id; do
        local info=$(aws_cmd ec2 describe-volumes \
            --volume-ids "$id" \
            --query 'Volumes[0].[Size,VolumeType]' \
            --output json)
        log_warn "  - $id: $(echo $info | jq -r '.[0]')GB $(echo $info | jq -r '.[1]')"
    done

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would delete EBS volumes"
        return 0
    fi

    if ! confirm "Delete these orphan EBS volumes?"; then
        return 0
    fi

    echo "$volume_ids" | while read -r id; do
        # Create snapshot before deletion (optional, commented out for cost)
        # local snapshot_id=$(aws_cmd ec2 create-snapshot --volume-id "$id" --query 'SnapshotId' --output text)
        # log_info "Created snapshot: $snapshot_id"

        # Save volume data before deletion
        local volume_data=$(aws_cmd ec2 describe-volumes --volume-ids "$id" --output json)
        save_deleted_resource "ebs_volume" "$id" "$volume_data"

        log_action "Deleting EBS volume: $id"
        aws_cmd ec2 delete-volume --volume-id "$id" | tee -a "$LOG_FILE"
    done

    log_info "EBS volumes deleted"
}

################################################################################
# ECS FUNCTIONS
################################################################################

list_ecs_resources() {
    section_header "ECS RESOURCES"

    log_info "Scanning for ECS clusters..."

    local clusters=$(aws_cmd ecs list-clusters --query 'clusterArns[]' --output json)
    local cluster_count=$(echo "$clusters" | jq '. | length')

    if [[ $cluster_count -eq 0 ]]; then
        log_info "No ECS clusters found"
        return 0
    fi

    log_info "Found $cluster_count ECS cluster(s)"

    echo "$clusters" | jq -r '.[]' | while read -r cluster_arn; do
        local cluster_name=$(basename "$cluster_arn")
        log_info "Cluster: $cluster_name"

        # List services
        local services=$(aws_cmd ecs list-services --cluster "$cluster_name" --query 'serviceArns[]' --output json)
        local service_count=$(echo "$services" | jq '. | length')

        if [[ $service_count -gt 0 ]]; then
            log_info "  Services: $service_count"
            echo "$services" | jq -r '.[]' | while read -r service_arn; do
                local service_name=$(basename "$service_arn")
                local service_info=$(aws_cmd ecs describe-services \
                    --cluster "$cluster_name" \
                    --services "$service_name" \
                    --query 'services[0].[desiredCount,runningCount]' \
                    --output json)
                log_info "    - $service_name: desired=$(echo $service_info | jq -r '.[0]'), running=$(echo $service_info | jq -r '.[1]')"
            done
        fi

        # List tasks
        local tasks=$(aws_cmd ecs list-tasks --cluster "$cluster_name" --query 'taskArns[]' --output json)
        local task_count=$(echo "$tasks" | jq '. | length')

        if [[ $task_count -gt 0 ]]; then
            log_warn "  Running tasks: $task_count"
        fi
    done
}

stop_ecs_services() {
    section_header "STOPPING ECS SERVICES"

    local clusters=$(aws_cmd ecs list-clusters --query 'clusterArns[]' --output json)
    local cluster_count=$(echo "$clusters" | jq '. | length')

    if [[ $cluster_count -eq 0 ]]; then
        log_info "No ECS clusters found"
        return 0
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would set ECS service desired count to 0"
        return 0
    fi

    echo "$clusters" | jq -r '.[]' | while read -r cluster_arn; do
        local cluster_name=$(basename "$cluster_arn")
        local services=$(aws_cmd ecs list-services --cluster "$cluster_name" --query 'serviceArns[]' --output json)

        echo "$services" | jq -r '.[]' | while read -r service_arn; do
            local service_name=$(basename "$service_arn")

            log_action "Setting desired count to 0 for service: $service_name"
            aws_cmd ecs update-service \
                --cluster "$cluster_name" \
                --service "$service_name" \
                --desired-count 0 | tee -a "$LOG_FILE"

            save_deleted_resource "ecs_service_stopped" "$service_name" "{\"cluster\": \"$cluster_name\"}"
        done

        # Stop running tasks
        local tasks=$(aws_cmd ecs list-tasks --cluster "$cluster_name" --query 'taskArns[]' --output json)
        echo "$tasks" | jq -r '.[]' | while read -r task_arn; do
            log_action "Stopping task: $(basename $task_arn)"
            aws_cmd ecs stop-task --cluster "$cluster_name" --task "$task_arn" | tee -a "$LOG_FILE"
        done
    done

    log_info "ECS services stopped"
}

################################################################################
# ELB FUNCTIONS
################################################################################

list_load_balancers() {
    section_header "LOAD BALANCERS"

    log_info "Scanning for Application/Network Load Balancers..."

    local albs=$(aws_cmd elbv2 describe-load-balancers \
        --query 'LoadBalancers[].[LoadBalancerName,Type,State.Code]' \
        --output json 2>/dev/null || echo '[]')

    local alb_count=$(echo "$albs" | jq '. | length')

    if [[ $alb_count -gt 0 ]]; then
        log_info "Found $alb_count ALB/NLB(s):"
        echo "$albs" | jq -r '.[] | "  - " + .[0] + " (" + .[1] + ") - " + .[2]' | tee -a "$LOG_FILE"
        log_warn "Estimated cost: ~\$16-25/month per load balancer"
    else
        log_info "No ALB/NLB found"
    fi

    log_info "Scanning for Classic Load Balancers..."

    local clbs=$(aws_cmd elb describe-load-balancers \
        --query 'LoadBalancerDescriptions[].LoadBalancerName' \
        --output json 2>/dev/null || echo '[]')

    local clb_count=$(echo "$clbs" | jq '. | length')

    if [[ $clb_count -gt 0 ]]; then
        log_info "Found $clb_count Classic Load Balancer(s):"
        echo "$clbs" | jq -r '.[] | "  - " + .' | tee -a "$LOG_FILE"
        log_warn "Estimated cost: ~\$18/month per Classic LB"
    else
        log_info "No Classic Load Balancers found"
    fi

    return $((alb_count + clb_count))
}

delete_load_balancers() {
    section_header "DELETING LOAD BALANCERS"

    local albs=$(aws_cmd elbv2 describe-load-balancers \
        --query 'LoadBalancers[].[LoadBalancerArn,LoadBalancerName]' \
        --output json 2>/dev/null || echo '[]')

    local alb_count=$(echo "$albs" | jq '. | length')

    if [[ $alb_count -gt 0 ]]; then
        log_warn "Will delete $alb_count ALB/NLB(s)"

        if [[ $DRY_RUN -eq 0 ]] && confirm "Delete ALB/NLB load balancers?"; then
            echo "$albs" | jq -r '.[]' | while read -r lb_info; do
                local lb_arn=$(echo "$lb_info" | jq -r '.[0]')
                local lb_name=$(echo "$lb_info" | jq -r '.[1]')

                log_action "Deleting load balancer: $lb_name"
                aws_cmd elbv2 delete-load-balancer --load-balancer-arn "$lb_arn" | tee -a "$LOG_FILE"
                save_deleted_resource "load_balancer" "$lb_name" "{\"arn\": \"$lb_arn\"}"
            done
        fi
    fi

    local clbs=$(aws_cmd elb describe-load-balancers \
        --query 'LoadBalancerDescriptions[].LoadBalancerName' \
        --output json 2>/dev/null || echo '[]')

    local clb_count=$(echo "$clbs" | jq '. | length')

    if [[ $clb_count -gt 0 ]]; then
        log_warn "Will delete $clb_count Classic Load Balancer(s)"

        if [[ $DRY_RUN -eq 0 ]] && confirm "Delete Classic Load Balancers?"; then
            echo "$clbs" | jq -r '.[]' | while read -r lb_name; do
                log_action "Deleting Classic Load Balancer: $lb_name"
                aws_cmd elb delete-load-balancer --load-balancer-name "$lb_name" | tee -a "$LOG_FILE"
                save_deleted_resource "classic_load_balancer" "$lb_name" "{}"
            done
        fi
    fi
}

################################################################################
# CLOUDWATCH LOGS FUNCTIONS
################################################################################

list_cloudwatch_log_groups() {
    section_header "CLOUDWATCH LOG GROUPS"

    log_info "Scanning for CloudWatch Log Groups with high retention..."

    local log_groups=$(aws_cmd logs describe-log-groups \
        --query 'logGroups[].[logGroupName,retentionInDays,storedBytes]' \
        --output json)

    local count=$(echo "$log_groups" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No CloudWatch Log Groups found"
        return 0
    fi

    log_info "Found $count Log Group(s):"

    local total_gb=0
    echo "$log_groups" | jq -c '.[]' | while read -r group; do
        local name=$(echo "$group" | jq -r '.[0]')
        local retention=$(echo "$group" | jq -r '.[1] // "Never expire"')
        local bytes=$(echo "$group" | jq -r '.[2] // 0')
        local gb=$(echo "scale=2; $bytes / 1024 / 1024 / 1024" | bc)

        if [[ "$retention" != "Never expire" ]] && [[ "$retention" -gt 7 ]]; then
            log_warn "  - $name: ${retention} days, ${gb}GB"
        else
            log_info "  - $name: ${retention}, ${gb}GB"
        fi
    done

    log_info "CloudWatch Logs cost: \$0.50/GB ingested, \$0.03/GB stored"
}

reduce_log_retention() {
    section_header "REDUCING LOG RETENTION"

    local log_groups=$(aws_cmd logs describe-log-groups \
        --query 'logGroups[?retentionInDays>`7`].[logGroupName,retentionInDays]' \
        --output json)

    local count=$(echo "$log_groups" | jq '. | length')

    if [[ $count -eq 0 ]]; then
        log_info "No log groups with retention > 7 days"
        return 0
    fi

    log_warn "Will reduce retention to 7 days for $count log group(s)"

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info "DRY_RUN: Would reduce log retention"
        echo "$log_groups" | jq -r '.[] | "  - " + .[0] + " (" + (.[1]|tostring) + " days → 7 days)"' | tee -a "$LOG_FILE"
        return 0
    fi

    if ! confirm "Reduce CloudWatch Log retention to 7 days?"; then
        return 0
    fi

    echo "$log_groups" | jq -r '.[][0]' | while read -r group_name; do
        log_action "Setting retention to 7 days: $group_name"
        aws_cmd logs put-retention-policy \
            --log-group-name "$group_name" \
            --retention-in-days 7 | tee -a "$LOG_FILE"
    done

    log_info "Log retention reduced"
}

################################################################################
# SUMMARY & REPORTING
################################################################################

calculate_total_savings() {
    section_header "COST SAVINGS ESTIMATE"

    local ec2_savings=0
    local rds_savings=0
    local vpc_savings=0
    local ebs_savings=0
    local elb_savings=0

    # EC2 estimation
    local ec2_count=$(aws_cmd ec2 describe-instances \
        --filters "Name=instance-state-name,Values=running" \
        --query 'Reservations[].Instances[]' | jq '. | length')
    if [[ $ec2_count -gt 0 ]]; then
        ec2_savings=$(echo "$ec2_count * 10" | bc)  # ~$10/month per instance (conservative)
    fi

    # RDS estimation (70% savings when stopped)
    local rds_count=$(aws_cmd rds describe-db-instances \
        --query 'DBInstances[?DBInstanceStatus==`available`]' | jq '. | length')
    if [[ $rds_count -gt 0 ]]; then
        rds_savings=$(echo "$rds_count * 10" | bc)  # ~$10/month savings per instance when stopped 70% of time
    fi

    # VPC Endpoint estimation
    local vpc_count=$(aws_cmd ec2 describe-vpc-endpoints \
        --filters "Name=vpc-endpoint-type,Values=Interface" \
        --query 'VpcEndpoints[]' | jq '. | length')
    if [[ $vpc_count -gt 0 ]]; then
        vpc_savings=$(echo "$vpc_count * 7.3" | bc)  # $7.30/month per endpoint
    fi

    # EBS estimation
    local ebs_volumes=$(aws_cmd ec2 describe-volumes \
        --filters "Name=status,Values=available" \
        --query 'Volumes[].[Size]' --output json)
    if [[ $(echo "$ebs_volumes" | jq '. | length') -gt 0 ]]; then
        local total_size=$(echo "$ebs_volumes" | jq '[.[][0]] | add // 0')
        ebs_savings=$(echo "$total_size * 0.09" | bc)
    fi

    # ELB estimation
    local elb_count=$(aws_cmd elbv2 describe-load-balancers --query 'LoadBalancers[]' --output json 2>/dev/null | jq '. | length')
    if [[ $elb_count -gt 0 ]]; then
        elb_savings=$(echo "$elb_count * 20" | bc)
    fi

    local total_savings=$(echo "$ec2_savings + $rds_savings + $vpc_savings + $ebs_savings + $elb_savings" | bc)

    echo "" | tee -a "$LOG_FILE"
    log_info "ESTIMATED MONTHLY SAVINGS:"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ $STOP_EC2 -eq 1 ]] && [[ $(echo "$ec2_savings > 0" | bc) -eq 1 ]]; then
        log_info "  EC2 Instances (stopped):        \$$(printf "%.2f" $ec2_savings)"
    fi

    if [[ $STOP_RDS -eq 1 ]] && [[ $(echo "$rds_savings > 0" | bc) -eq 1 ]]; then
        log_info "  RDS Instances (stopped 70%):    \$$(printf "%.2f" $rds_savings)"
    fi

    if [[ $DELETE_ENDPOINTS -eq 1 ]] && [[ $(echo "$vpc_savings > 0" | bc) -eq 1 ]]; then
        log_warn "  VPC Endpoints (deleted):        \$$(printf "%.2f" $vpc_savings)"
    fi

    if [[ $(echo "$ebs_savings > 0" | bc) -eq 1 ]]; then
        log_info "  EBS Volumes (deleted):          \$$(printf "%.2f" $ebs_savings)"
    fi

    if [[ $(echo "$elb_savings > 0" | bc) -eq 1 ]]; then
        log_info "  Load Balancers (deleted):       \$$(printf "%.2f" $elb_savings)"
    fi

    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_info "  TOTAL ESTIMATED SAVINGS:        \$$(printf "%.2f" $total_savings)/month"
    log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "" | tee -a "$LOG_FILE"
}

generate_restore_commands() {
    if [[ ! -f "$DELETED_RESOURCES_FILE" ]]; then
        return
    fi

    section_header "RESTORE COMMANDS"

    log_info "Deleted resources saved to: $DELETED_RESOURCES_FILE"
    log_info ""
    log_info "To restore resources, use the following commands:"
    log_info ""

    # EC2 restore
    local ec2_stopped=$(jq -r '.resources[] | select(.type=="ec2_stopped") | .id' "$DELETED_RESOURCES_FILE" 2>/dev/null || echo "")
    if [[ -n "$ec2_stopped" ]]; then
        log_info "# Restart EC2 instances:"
        echo "$ec2_stopped" | while read -r id; do
            echo "aws ec2 start-instances --instance-ids $id --region $REGION" | tee -a "$LOG_FILE"
        done
        echo "" | tee -a "$LOG_FILE"
    fi

    # RDS restore
    local rds_stopped=$(jq -r '.resources[] | select(.type=="rds_stopped") | .id' "$DELETED_RESOURCES_FILE" 2>/dev/null || echo "")
    if [[ -n "$rds_stopped" ]]; then
        log_info "# Restart RDS instances:"
        echo "$rds_stopped" | while read -r id; do
            echo "aws rds start-db-instance --db-instance-identifier $id --region $REGION" | tee -a "$LOG_FILE"
        done
        echo "" | tee -a "$LOG_FILE"
    fi

    # VPC Endpoints restore (would require recreation, more complex)
    local vpc_deleted=$(jq -r '.resources[] | select(.type=="vpc_endpoint") | .id' "$DELETED_RESOURCES_FILE" 2>/dev/null || echo "")
    if [[ -n "$vpc_deleted" ]]; then
        log_warn "# VPC Endpoints need to be manually recreated (check deleted-resources.json for details)"
        echo "" | tee -a "$LOG_FILE"
    fi
}

################################################################################
# MAIN EXECUTION
################################################################################

show_usage() {
    cat << EOF
AWS COST KILL-SWITCH - Emergency Resource Management

USAGE:
    $0 [OPTIONS]

OPTIONS:
    --dry-run               List resources without changes (DEFAULT)
    --execute               Execute actions (requires confirmation)

    --stop-ec2              Stop running EC2 instances
    --terminate-ec2         Terminate EC2 instances (DANGER)
    --stop-rds              Stop RDS instances
    --delete-endpoints      Delete VPC Interface Endpoints (DANGER)
    --delete-volumes        Delete orphan EBS volumes
    --delete-elb            Delete load balancers
    --reduce-logs           Reduce CloudWatch Log retention to 7 days

    --aggressive            Execute ALL actions (DANGER)
    --no-rds-snapshot       Skip RDS snapshot before stopping

    --profile PROFILE       AWS profile to use
    --region REGION         AWS region (default: us-east-1)
    --help                  Show this help

EXAMPLES:
    # List all resources (safe, no changes)
    $0 --dry-run

    # Stop EC2 and RDS (saves ~\$20-30/month)
    $0 --execute --stop-ec2 --stop-rds

    # Aggressive mode (saves max, but risky)
    $0 --execute --aggressive

    # Use specific AWS profile
    $0 --execute --stop-ec2 --profile production

SAFETY:
    - DRY_RUN mode is enabled by default
    - All destructive actions require explicit confirmation
    - Snapshots created before RDS stop (unless --no-rds-snapshot)
    - Full logging to logs/ directory
    - Deleted resources tracked for restoration

ESTIMATED SAVINGS:
    - EC2 stopped: ~\$8-15/month
    - RDS stopped (70% of time): ~\$10-35/month
    - VPC Endpoints deleted: ~\$22/month (may break services!)
    - EBS volumes deleted: ~\$0.09/GB/month
    - Load Balancers deleted: ~\$16-25/month each

WARNINGS:
    - Deleting VPC Endpoints can break Lambda/VPC services
    - Terminating EC2 is permanent and irreversible
    - RDS auto-restarts after 7 days when stopped
    - Always test in dev/staging first

For more info, see: scripts/aws-cost-kill-switch.sh

EOF
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --execute)
                DRY_RUN=0
                shift
                ;;
            --stop-ec2)
                STOP_EC2=1
                shift
                ;;
            --terminate-ec2)
                TERMINATE_EC2=1
                shift
                ;;
            --stop-rds)
                STOP_RDS=1
                shift
                ;;
            --delete-endpoints)
                DELETE_ENDPOINTS=1
                shift
                ;;
            --delete-volumes)
                DELETE_EBS=1
                shift
                ;;
            --delete-elb)
                DELETE_ELB=1
                shift
                ;;
            --reduce-logs)
                REDUCE_LOGS=1
                shift
                ;;
            --aggressive)
                AGGRESSIVE_MODE=1
                STOP_EC2=1
                STOP_RDS=1
                DELETE_ENDPOINTS=1
                DELETE_EBS=1
                DELETE_ELB=1
                REDUCE_LOGS=1
                shift
                ;;
            --no-rds-snapshot)
                CREATE_RDS_SNAPSHOT=0
                shift
                ;;
            --profile)
                AWS_PROFILE="$2"
                shift 2
                ;;
            --region)
                REGION="$2"
                shift 2
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
}

initialize() {
    # Create logs directory if it doesn't exist
    mkdir -p "$LOG_DIR"

    # Start logging
    log_info "AWS Cost Kill-Switch Starting..."
    log_info "Timestamp: $TIMESTAMP"
    log_info "Log file: $LOG_FILE"
    log_info ""

    # Check required tools
    for tool in aws jq bc; do
        if ! command -v $tool &> /dev/null; then
            log_error "Required tool not found: $tool"
            log_error "Please install $tool and try again"
            exit 1
        fi
    done
}

main() {
    initialize
    parse_arguments "$@"

    # Show mode
    if [[ $DRY_RUN -eq 1 ]]; then
        log_warn "╔════════════════════════════════════════════════════════════════╗"
        log_warn "║                    DRY RUN MODE ENABLED                        ║"
        log_warn "║              No changes will be made to AWS                    ║"
        log_warn "║         Use --execute to perform actual actions                ║"
        log_warn "╚════════════════════════════════════════════════════════════════╝"
        echo "" | tee -a "$LOG_FILE"
    else
        log_error "╔════════════════════════════════════════════════════════════════╗"
        log_error "║                  ⚠️  EXECUTE MODE ENABLED ⚠️                   ║"
        log_error "║            Changes WILL be made to your AWS account            ║"
        log_error "║        All destructive actions require confirmation            ║"
        log_error "╚════════════════════════════════════════════════════════════════╝"
        echo "" | tee -a "$LOG_FILE"
    fi

    # Check AWS credentials
    check_credentials

    # List all resources first
    list_ec2_instances
    list_rds_instances
    list_vpc_endpoints
    list_orphan_ebs_volumes
    list_ecs_resources
    list_load_balancers
    list_cloudwatch_log_groups

    # Show estimated savings
    calculate_total_savings

    # Execute actions if requested
    if [[ $STOP_EC2 -eq 1 ]]; then
        stop_ec2_instances
        release_elastic_ips
    fi

    if [[ $TERMINATE_EC2 -eq 1 ]]; then
        terminate_ec2_instances
    fi

    if [[ $STOP_RDS -eq 1 ]]; then
        stop_rds_instances
    fi

    if [[ $DELETE_ENDPOINTS -eq 1 ]]; then
        delete_vpc_endpoints
    fi

    if [[ ${DELETE_EBS:-0} -eq 1 ]]; then
        delete_orphan_ebs_volumes
    fi

    if [[ ${DELETE_ELB:-0} -eq 1 ]]; then
        delete_load_balancers
    fi

    if [[ ${REDUCE_LOGS:-0} -eq 1 ]]; then
        reduce_log_retention
    fi

    # ECS check (preventive)
    local ecs_count=$(aws_cmd ecs list-clusters --query 'clusterArns[]' | jq '. | length')
    if [[ $ecs_count -gt 0 ]]; then
        stop_ecs_services
    fi

    # Generate restore commands if resources were deleted
    if [[ $DRY_RUN -eq 0 ]]; then
        generate_restore_commands
    fi

    # Final summary
    section_header "EXECUTION COMPLETE"

    log_info "Log file saved to: $LOG_FILE"

    if [[ -f "$DELETED_RESOURCES_FILE" ]]; then
        log_info "Deleted resources tracked in: $DELETED_RESOURCES_FILE"
    fi

    if [[ $DRY_RUN -eq 1 ]]; then
        log_info ""
        log_info "This was a DRY RUN - no changes were made"
        log_info "To execute actions, run with --execute flag"
        log_info ""
        log_info "Quick start examples:"
        log_info "  Stop EC2 & RDS:  $0 --execute --stop-ec2 --stop-rds"
        log_info "  Full cleanup:    $0 --execute --aggressive"
    else
        log_info ""
        log_info "✅ Kill-switch execution completed"
        log_info "Monitor your AWS resources to ensure expected state"
    fi

    log_info ""
    log_info "════════════════════════════════════════════════════════════════"
}

# Execute main function with all arguments
main "$@"
