.PHONY: help install dev build test lint deploy-frontend deploy-backend deploy-all docker-up docker-down docker-logs clean

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

install: ## Install all dependencies
	@echo "Installing frontend dependencies..."
	npm ci
	@echo "Installing backend dependencies..."
	cd backend/websearch_service && python -m venv venv && . venv/bin/activate && pip install -r requirements.txt

dev: ## Start development servers
	@echo "Starting development servers..."
	@echo "Frontend: http://localhost:8080"
	@echo "Backend: http://localhost:8000"
	docker-compose -f deployment/docker-compose.yml up

build: ## Build all Docker images
	@echo "Building Docker images..."
	docker build -t ai-financial-advisor-backend:latest ./backend/websearch_service
	docker build -t ai-financial-advisor-frontend:latest -f deployment/Dockerfile.frontend .

test: ## Run all tests
	@echo "Running frontend tests..."
	npm test
	@echo "Running backend tests..."
	cd backend/websearch_service && . venv/bin/activate && pytest tests/ -v

lint: ## Run linters
	@echo "Linting frontend..."
	npm run lint
	@echo "Type checking..."
	npm run type-check

deploy-frontend: ## Deploy frontend to Vercel
	@echo "Deploying frontend..."
	vercel --prod

deploy-backend: ## Deploy backend to Railway
	@echo "Deploying backend..."
	cd backend/websearch_service && railway up

deploy-all: deploy-backend deploy-frontend ## Deploy both frontend and backend

docker-up: ## Start Docker Compose services
	docker-compose -f deployment/docker-compose.yml up -d

docker-down: ## Stop Docker Compose services
	docker-compose -f deployment/docker-compose.yml down

docker-logs: ## View Docker Compose logs
	docker-compose -f deployment/docker-compose.yml logs -f

clean: ## Clean build artifacts and dependencies
	@echo "Cleaning..."
	rm -rf dist/ build/ node_modules/ .pytest_cache/ htmlcov/ coverage/
	cd backend/websearch_service && rm -rf venv/ __pycache__/ *.pyc .pytest_cache/
