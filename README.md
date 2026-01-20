# Financial Advisor

An AI-powered financial education platform with paper trading capabilities.

## Features

- 🤖 AI Financial Advisor chatbot (powered by OpenAI)
- 📊 Paper trading simulator
- 📈 Portfolio tracking and performance charts
- 📚 Financial education topics
- 🔐 User authentication via Supabase

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `env.example` to `.env` and fill in your credentials:
   ```bash
   cp env.example .env
   ```
4. Run the SQL files in `sql/` folder in your Supabase SQL Editor
5. Start the development server:
   ```bash
   npm run dev
   ```

## Environment Variables

- `VITE_SUPABASE_URL` - Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Your Supabase anon key
- `VITE_OPENAI_API_KEY` - Your OpenAI API key

## Tech Stack

- React + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- Supabase (Auth + Database)
- OpenAI API
