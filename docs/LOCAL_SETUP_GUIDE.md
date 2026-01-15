# Local Setup and Testing Guide

This guide walks you through setting up and testing the Advisor Ally application locally.

## Prerequisites

- **Node.js** 18+ and npm/yarn/bun
- **Supabase account** (free tier is fine)
- **Python 3.8+** (optional, for backend integration)
- **Git** (for cloning the repository)

## Step 1: Install Dependencies

```bash
# Install Node.js dependencies
npm install
# or
yarn install
# or
bun install
```

This will install all required packages including:
- React and React DOM
- Supabase client
- React Query
- All UI components (shadcn/ui)
- TypeScript

## Step 2: Set Up Supabase

### 2.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Sign up or log in
3. Click "New Project"
4. Fill in project details:
   - **Name**: advisor-ally (or your choice)
   - **Database Password**: Choose a strong password
   - **Region**: Choose closest to you
5. Wait for project to be created (~2 minutes)

### 2.2 Get Your Supabase Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy the following:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJhbGci...`)

### 2.3 Run the Database Schema

1. In Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Open `supabase-schema.sql` from this project
4. Copy the entire contents
5. Paste into the SQL Editor
6. Click "Run" (or press Ctrl+Enter)
7. Verify all tables were created by checking **Table Editor**

### 2.4 Configure Authentication (Optional but Recommended)

For local testing without authentication, you can:
- Use Supabase's built-in auth
- Or modify the code to use a test user ID

To enable authentication:
1. Go to **Authentication** → **Providers** in Supabase
2. Enable **Email** provider (already enabled by default)
3. You can also enable **Google**, **GitHub**, etc. for easier testing

## Step 3: Configure Environment Variables

1. Create a `.env` file in the project root:

```bash
cp env.example .env
```

2. Edit `.env` and add your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here

# Optional: Python backend URL (if you have one)
VITE_PYTHON_API_URL=http://localhost:8000
```

**⚠️ Important**: Never commit the `.env` file to git. It's already in `.gitignore`.

## Step 4: Install Supabase Dependencies

The Supabase client is already in `package.json`, but make sure it's installed:

```bash
npm install @supabase/supabase-js
```

## Step 5: Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
bun dev
```

The app should start on `http://localhost:8080` (as configured in `vite.config.ts`)

## Step 6: Test the Application

### 6.1 Initial Test

1. Open `http://localhost:8080` in your browser
2. You should see the Advisor page
3. If you see errors about authentication, continue to Step 6.2

### 6.2 Set Up Authentication (For Full Testing)

Since the app uses Supabase Auth, you need to create a test user:

**Option A: Using Supabase Dashboard**
1. Go to **Authentication** → **Users** in Supabase
2. Click "Add user" → "Create new user"
3. Enter email and password
4. Note: Email confirmation may be required

**Option B: Using the App (if login UI exists)**
1. Navigate to a login page (you may need to add this)
2. Sign up with your email
3. Check your email for confirmation link

**Option C: Bypass Auth for Testing (Quick Method)**

For quick local testing, you can temporarily modify the code to use a test user ID. See the troubleshooting section below.

### 6.3 Test Each Feature

1. **Dashboard Page** (`/dashboard`):
   - Should load portfolio performance (empty initially)
   - Should show trade statistics (empty initially)
   - Should show market overview (if data exists)

2. **Paper Trading Page** (`/paper-trading`):
   - Should show open positions (empty initially)
   - Should show trade history (empty initially)
   - Try creating a new trade journal entry

3. **AI Advisor Page** (`/`):
   - Should show chat interface
   - Type a message and see if it saves to database
   - If Python backend is connected, it will get AI responses

## Step 7: Populate Test Data (Optional)

### Using Supabase Dashboard:

1. Go to **Table Editor** in Supabase
2. Select a table (e.g., `portfolio_history`)
3. Click "Insert row"
4. Add test data:

**Example Portfolio History:**
```sql
INSERT INTO portfolio_history (user_id, date, value)
VALUES 
  ('your-user-id', '2024-01-01', 10000),
  ('your-user-id', '2024-01-15', 10450),
  ('your-user-id', '2024-02-01', 11100);
```

**Example Open Position:**
```sql
INSERT INTO open_positions (user_id, symbol, name, quantity, entry_price, current_price, type)
VALUES 
  ('your-user-id', 'AAPL', 'Apple Inc.', 25, 178.50, 185.20, 'LONG');
```

**Example Trade:**
```sql
INSERT INTO trades (user_id, symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl)
VALUES 
  ('your-user-id', 'GOOGL', 'LONG', 'CLOSED', 12, 142.50, 156.80, '2024-01-15', '2024-01-22', 171.60);
```

### Using SQL Script:

Create a file `seed-data.sql`:

```sql
-- Replace 'your-user-id' with actual user ID from auth.users table
-- Get it from: SELECT id FROM auth.users LIMIT 1;

-- Portfolio history
INSERT INTO portfolio_history (user_id, date, value) VALUES
  ('your-user-id', '2024-01-01', 10000),
  ('your-user-id', '2024-01-15', 10450),
  ('your-user-id', '2024-02-01', 11100);

-- More data...
```

Run it in Supabase SQL Editor.

## Step 8: Set Up Python Backend (Optional)

If you want to test the full integration with Python backend:

1. **Create Python Backend:**

```bash
# In a separate directory
mkdir python-backend
cd python-backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install fastapi uvicorn supabase openai
```

2. **Create `main.py`:**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/chat")
async def chat(request: dict):
    # Simple echo response for testing
    return {
        "response": f"You said: {request.get('message', '')}. This is a test response."
    }

@app.get("/api/stock-price/{symbol}")
async def get_stock_price(symbol: str):
    # Mock price for testing
    return {
        "symbol": symbol,
        "price": 150.0,
        "currency": "USD"
    }
```

3. **Run Python Backend:**

```bash
uvicorn main:app --reload --port 8000
```

4. **Update `.env`:**

```env
VITE_PYTHON_API_URL=http://localhost:8000
```

5. **Restart React Dev Server:**

```bash
npm run dev
```

## Troubleshooting

### Error: "Missing Supabase environment variables"

**Solution**: Make sure your `.env` file exists and has correct values:
```bash
# Check if .env exists
ls -la .env

# Verify values (don't share these publicly)
cat .env
```

### Error: "Row Level Security policy violation"

**Solution**: This means the user is not authenticated. Options:
1. Sign in through Supabase Auth
2. Temporarily disable RLS for testing (NOT for production):

```sql
-- In Supabase SQL Editor (ONLY FOR TESTING)
ALTER TABLE portfolio_history DISABLE ROW LEVEL SECURITY;
-- Repeat for other tables
```

3. Or use a service role key (NOT recommended for frontend, only for backend)

### Error: "Cannot read properties of undefined (reading 'id')"

**Solution**: User is not authenticated. The hooks require a logged-in user. Create a test user or modify code temporarily:

```typescript
// Temporary fix in hooks/use-data.ts (NOT for production)
const userId = user?.id || 'test-user-id-for-local-dev';
```

### Port 8080 Already in Use

**Solution**: Change port in `vite.config.ts`:

```typescript
server: {
  port: 3000,  // Or any other port
}
```

### Database Tables Not Created

**Solution**:
1. Check SQL Editor for errors
2. Verify you ran the entire `supabase-schema.sql` script
3. Check Table Editor to see which tables exist
4. Re-run any missing CREATE TABLE statements

### Python Backend Not Responding

**Solution**:
1. Check if Python server is running: `curl http://localhost:8000/docs`
2. Check CORS settings (frontend URL should be allowed)
3. Check Python logs for errors
4. Verify `VITE_PYTHON_API_URL` in `.env` matches Python server URL

## Next Steps

1. **Add Authentication UI**: Create login/signup pages if not present
2. **Add Data Entry Forms**: Create forms to add trades, positions, etc.
3. **Connect Python Backend**: Implement real AI chat and market data
4. **Deploy**: Deploy to Vercel, Netlify, or similar for frontend
5. **Deploy Backend**: Deploy Python backend to Railway, Render, or AWS

## Useful Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production
npm run preview          # Preview production build
npm run lint             # Run ESLint

# Database (via Supabase Dashboard)
# SQL Editor: Run queries
# Table Editor: View/edit data
# Authentication: Manage users

# Python Backend (if set up)
python -m uvicorn main:app --reload  # Start Python server
```

## Getting Help

- Check Supabase logs in dashboard for database errors
- Check browser console (F12) for frontend errors
- Check Python server logs for backend errors
- Review `supabase-schema.sql` for database structure
- Review `PYTHON_API_INTEGRATION.md` for API requirements
