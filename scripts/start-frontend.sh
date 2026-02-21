#!/bin/bash
# Start Frontend Service
# Usage: ./scripts/start-frontend.sh

cd "$(dirname "$0")/.."

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "⚠️  .env file not found. Creating from template..."
    cp config/env.example .env
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env and add your Supabase credentials!"
    echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

# Start dev server
echo "🚀 Starting frontend dev server..."
echo "🌐 Frontend will be available at http://localhost:5173"
echo ""
npm run dev
