#!/bin/bash
# Local Testing Script
# This script helps test the application locally

set -e

echo "🧪 Local Testing Setup"
echo "======================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from template...${NC}"
    cp config/env.example .env
    echo -e "${GREEN}✅ Created .env file${NC}"
    echo -e "${YELLOW}⚠️  Please edit .env and add your Supabase credentials!${NC}"
    echo ""
fi

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✅ Node.js: $NODE_VERSION${NC}"
else
    echo -e "${RED}❌ Node.js not found${NC}"
    exit 1
fi

# Check Python
echo "Checking Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo -e "${GREEN}✅ Python: $PYTHON_VERSION${NC}"
else
    echo -e "${RED}❌ Python3 not found${NC}"
    exit 1
fi

# Check frontend dependencies
echo "Checking frontend dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Frontend dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Installing frontend dependencies...${NC}"
    npm install
fi

# Check backend virtual environment
echo "Checking backend setup..."
if [ -d "backend/websearch_service/venv" ]; then
    echo -e "${GREEN}✅ Backend virtual environment exists${NC}"
else
    echo -e "${YELLOW}⚠️  Creating backend virtual environment...${NC}"
    cd backend/websearch_service
    python3 -m venv venv
    source venv/bin/activate
    pip install --upgrade pip
    pip install -r requirements.txt
    cd ../..
    echo -e "${GREEN}✅ Backend dependencies installed${NC}"
fi

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your Supabase credentials"
echo "2. Start backend: cd backend/websearch_service && source venv/bin/activate && export OPENAI_API_KEY=your-key && uvicorn app.main:app --reload"
echo "3. Start frontend: npm run dev"
echo ""
echo "Or use Docker Compose:"
echo "  docker-compose -f deployment/docker-compose.yml up"
echo ""
