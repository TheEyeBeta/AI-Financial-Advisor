# FinanceAI - AI Financial Advisor

An AI-powered financial education platform with paper trading capabilities.

## Features

- 🤖 AI Financial Advisor chatbot (via server-side AI proxy)
- 📊 Paper trading simulator
- 📈 Portfolio tracking and performance charts
- 📚 Financial education topics
- 🔐 User authentication via Supabase
- 🗂️ Six major database schemas: `core`, `ai`, `trading`, `market`, `academy`, and `meridian`

## Setup (Local)

### Prerequisites
- Node.js 20+
- Python 3.12+
- Supabase account (for database and auth)

### Frontend Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `config/env.example` to `.env` and fill in your credentials:
   ```bash
   cp config/env.example .env
   ```
4. Run SQL setup in Supabase SQL Editor:
   - `sql/schema.sql`
   - `sql/add_news_table.sql` (adds canonical `public.news` table)
   - `sql/harden_news_policies.sql` (recommended before production go-live)
5. Start the frontend development server:
   ```bash
   npm run dev
   # or
   npm run start:frontend
   ```

### Backend Setup

1. Navigate to backend directory:
   ```bash
   cd backend/websearch_service
   ```

2. Create virtual environment:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Set up environment variables:
   ```bash
   cp .env.example .env
   # Edit .env and add your API keys:
   # OPENAI_API_KEY=sk-...
   # PERPLEXITY_API_KEY=pplx-... (optional fallback)
   # TAVILY_API_KEY=tvly-...
   ```

5. Start the backend server:
   ```bash
   # From project root:
   npm run start:backend
   # or manually:
   cd backend/websearch_service
   source venv/bin/activate
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

The backend will be available at `http://localhost:8000` with API docs at `http://localhost:8000/docs`

### Running Both Services

**Terminal 1 - Frontend:**
```bash
npm run dev
```

**Terminal 2 - Backend:**
```bash
npm run start:backend
```

See [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md) for detailed deployment and troubleshooting.

## Environment Variables

**Frontend (Vercel):**
- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
- `VITE_PYTHON_API_URL` - URL of backend AI proxy service

**Backend (Railway) — never expose in frontend env vars:**
- `OPENAI_API_KEY` - Required for AI chat
- `TAVILY_API_KEY` - Required for web search
- `PERPLEXITY_API_KEY` - Optional fallback when OpenAI hits rate limits
- `CORS_ORIGINS` - Your Vercel frontend URL (e.g. `https://your-app.vercel.app`)

## Deploying to Vercel

This project is designed to run well on Vercel.

**Recommended settings:**

- **Framework preset**: Vite
- **Build Command**: `npm run build`
- **Install Command**: `npm ci` (or `npm install`)
- **Output Directory**: `dist`
- **Node.js version**: 20 (set this in Vercel project settings and it will also respect the `engines.node` field in `package.json`)

Make sure to configure the environment variables in the Vercel dashboard:

- In **Project → Settings → Environment Variables**, add the variables listed above.
- Use different values for **Production** vs **Preview** environments if needed.

Once connected to your GitHub repo, Vercel will automatically build and deploy on pushes to the configured branches (for example, `main`).

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Python FastAPI (microservice)
- **Styling**: Tailwind CSS + shadcn/ui
- **Database & Auth**: Supabase
- **AI**: OpenAI API (server-side proxy)
- **Deployment**: Vercel (frontend) + Railway/Render (backend)
- **CI/CD**: GitHub Actions
- **Containerization**: Docker

## Quick Start

### Local Development

```bash
# Install frontend dependencies
npm install

# Start frontend dev server
npm run dev

# Start backend (in separate terminal)
cd backend/websearch_service
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Docker Development

```bash
# Start all services
docker-compose -f deployment/docker-compose.yml up -d

# View logs
docker-compose -f deployment/docker-compose.yml logs -f

# Stop services
docker-compose -f deployment/docker-compose.yml down
```

## Deployment

See [deployment/DEPLOYMENT.md](./deployment/DEPLOYMENT.md) for comprehensive deployment guide.

### Quick Deploy

**Frontend (Vercel)**:
```bash
npm i -g vercel
vercel --prod
```

**Backend (Railway)**:
```bash
npm i -g @railway/cli
cd backend/websearch_service
railway init
railway up
```

## Project Structure

```
├── src/                    # Frontend React application
├── backend/                # Python FastAPI backend
│   └── websearch_service/ # AI proxy & search service
├── .github/workflows/     # CI/CD pipelines
├── deployment/            # Deployment configurations & docs
│   ├── docker-compose.yml # Local development
│   ├── DEPLOYMENT.md      # Deployment guide
│   └── ...                # Platform configs (Railway, Vercel, etc.)
├── config/                # Configuration templates
│   ├── env.example        # Environment variable template
│   └── env.production.example
└── docs/                  # Documentation
```
