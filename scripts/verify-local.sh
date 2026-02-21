#!/bin/bash
# Verify Local Setup is Working
# This script checks if the app is accessible and working

echo "🔍 Verifying Local Setup"
echo "========================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if server is running
echo "1. Checking if dev server is running..."
if lsof -i :8080 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Server is running on port 8080${NC}"
else
    echo -e "${RED}❌ Server is NOT running on port 8080${NC}"
    echo "   Start it with: npm run dev"
    exit 1
fi

# Check if server responds
echo ""
echo "2. Testing server response..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Server responds with HTTP 200${NC}"
else
    echo -e "${RED}❌ Server returned HTTP $HTTP_CODE${NC}"
    exit 1
fi

# Check if HTML contains expected content
echo ""
echo "3. Checking page content..."
if curl -s http://localhost:8080 | grep -q "AI Financial Advisor"; then
    echo -e "${GREEN}✅ Page contains expected content${NC}"
else
    echo -e "${YELLOW}⚠️  Page might not be loading correctly${NC}"
fi

# Check environment variables
echo ""
echo "4. Checking environment variables..."
if [ -f .env ]; then
    if grep -q "VITE_SUPABASE_URL=your_supabase_project_url" .env; then
        echo -e "${YELLOW}⚠️  Supabase URL not configured (using placeholder)${NC}"
        echo "   The page should still load, but authentication won't work"
    else
        echo -e "${GREEN}✅ Supabase URL is configured${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  .env file not found${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✅ Verification Complete!${NC}"
echo ""
echo "Access your app at:"
echo "  🌐 http://localhost:8080"
echo "  🌐 http://127.0.0.1:8080"
echo ""
echo "If you see a blank page:"
echo "  1. Open browser DevTools (F12)"
echo "  2. Check Console tab for errors"
echo "  3. Check Network tab for failed requests"
echo "  4. Try hard refresh (Ctrl+Shift+R)"
echo ""
