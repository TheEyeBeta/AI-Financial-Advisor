#!/bin/bash

# Professional Deployment Script
# Usage: ./scripts/deploy.sh [frontend|backend|all] [environment]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Parse arguments
SERVICE=${1:-all}
ENVIRONMENT=${2:-production}

print_info "Starting deployment for: $SERVICE (environment: $ENVIRONMENT)"

# Frontend deployment
deploy_frontend() {
    print_info "Deploying frontend to Vercel..."
    
    if ! command_exists vercel; then
        print_error "Vercel CLI not found. Install with: npm i -g vercel"
        exit 1
    fi
    
    # Check if logged in
    if ! vercel whoami >/dev/null 2>&1; then
        print_warn "Not logged in to Vercel. Please run: vercel login"
        exit 1
    fi
    
    # Deploy
    if [ "$ENVIRONMENT" = "production" ]; then
        vercel --prod
    else
        vercel
    fi
    
    print_info "Frontend deployment complete!"
}

# Backend deployment
deploy_backend() {
    print_info "Deploying backend..."
    
    # Check for Railway
    if command_exists railway; then
        print_info "Using Railway for deployment..."
        cd backend/websearch_service
        railway up
        cd ../..
        print_info "Backend deployment complete!"
        return
    fi
    
    # Check for Render
    if [ -f "deployment/render.yaml" ]; then
        print_warn "Render configuration found. Deploy via Render dashboard or CLI."
        return
    fi
    
    # Docker deployment
    if command_exists docker; then
        print_info "Building and deploying with Docker..."
        docker build -t ai-financial-advisor-backend:latest \
            --build-arg APP_VERSION=$(git rev-parse --short HEAD) \
            --build-arg ENVIRONMENT=$ENVIRONMENT \
            ./backend/websearch_service
        
        print_info "Docker image built successfully!"
        print_warn "Push to registry and deploy manually or use docker-compose"
        return
    fi
    
    print_error "No deployment method found. Install Railway CLI or Docker."
    exit 1
}

# Docker Compose deployment
deploy_docker_compose() {
    print_info "Deploying with Docker Compose..."
    
    if ! command_exists docker-compose; then
        print_error "docker-compose not found"
        exit 1
    fi
    
    docker-compose -f deployment/docker-compose.yml up -d --build
    print_info "Services started. Check logs with: docker-compose -f deployment/docker-compose.yml logs -f"
}

# Health check
health_check() {
    print_info "Running health checks..."
    
    # Backend health check
    if [ -n "$BACKEND_URL" ]; then
        print_info "Checking backend health..."
        if curl -f "$BACKEND_URL/health/live" >/dev/null 2>&1; then
            print_info "Backend is healthy!"
        else
            print_warn "Backend health check failed"
        fi
    fi
    
    # Frontend health check
    if [ -n "$FRONTEND_URL" ]; then
        print_info "Checking frontend health..."
        if curl -f "$FRONTEND_URL/health" >/dev/null 2>&1; then
            print_info "Frontend is healthy!"
        else
            print_warn "Frontend health check failed"
        fi
    fi
}

# Main deployment logic
case $SERVICE in
    frontend)
        deploy_frontend
        ;;
    backend)
        deploy_backend
        ;;
    docker)
        deploy_docker_compose
        ;;
    all)
        deploy_backend
        sleep 5
        deploy_frontend
        ;;
    health)
        health_check
        ;;
    *)
        print_error "Unknown service: $SERVICE"
        echo "Usage: $0 [frontend|backend|all|docker|health] [production|preview]"
        exit 1
        ;;
esac

print_info "Deployment script completed!"
