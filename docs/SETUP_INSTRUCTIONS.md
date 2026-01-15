# Quick Setup Instructions for Your Supabase Project

Your Supabase credentials have been configured! Follow these steps to complete the setup.

## ✅ Step 1: Environment Variables (DONE)
Your `.env` file has been created with:
- Supabase URL: `https://nsngzzbgankkxxxsdacb.supabase.co`
- Anon Key: Configured

## Step 2: Run Database Schema in Supabase

1. **Go to Supabase SQL Editor:**
   - Open: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
   - Or: Dashboard → SQL Editor → New Query

2. **Copy and Paste the Schema:**
   - Open `supabase-schema.sql` in this project
   - Copy ALL contents (entire file)
   - Paste into the SQL Editor in Supabase

3. **Run the Schema:**
   - Click "Run" button (or press Ctrl+Enter / Cmd+Enter)
   - Wait for it to complete (should see "Success" message)

4. **Verify Tables Were Created:**
   - Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/database/tables
   - You should see these tables:
     - users
     - portfolio_history
     - open_positions
     - trades
     - trade_journal
     - chat_messages
     - learning_topics
     - achievements
     - market_indices
     - trending_stocks

## Step 3: Test the Application

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Open in browser:**
   - Go to: http://localhost:8080
   - The app should load (but you'll need authentication)

## Step 4: Set Up Authentication (Optional for Testing)

You have two options:

### Option A: Create a Test User via Supabase Dashboard
1. Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
2. Click "Add user" → "Create new user"
3. Enter email and password
4. Note: You may need to disable email confirmation for testing

### Option B: Temporarily Disable RLS (FOR TESTING ONLY)
If you want to test without authentication, you can temporarily disable RLS:

```sql
-- ONLY FOR LOCAL TESTING - NOT FOR PRODUCTION!
ALTER TABLE portfolio_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE open_positions DISABLE ROW LEVEL SECURITY;
ALTER TABLE trades DISABLE ROW LEVEL SECURITY;
ALTER TABLE trade_journal DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE learning_topics DISABLE ROW LEVEL SECURITY;
ALTER TABLE achievements DISABLE ROW LEVEL SECURITY;
```

⚠️ **IMPORTANT:** Re-enable RLS before deploying to production!

## Step 5: Add Test Data (Optional)

You can add test data directly in Supabase:

### Via Table Editor:
1. Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/database/tables
2. Click on any table (e.g., `portfolio_history`)
3. Click "Insert row"
4. Add data manually

### Via SQL:
First, get your user ID:
```sql
SELECT id FROM auth.users LIMIT 1;
```

Then insert test data (replace 'USER_ID_HERE' with actual ID):
```sql
-- Portfolio History
INSERT INTO portfolio_history (user_id, date, value) VALUES
  ('USER_ID_HERE', '2024-01-01', 10000),
  ('USER_ID_HERE', '2024-01-15', 10450),
  ('USER_ID_HERE', '2024-02-01', 11100);

-- Open Position
INSERT INTO open_positions (user_id, symbol, name, quantity, entry_price, current_price, type) VALUES
  ('USER_ID_HERE', 'AAPL', 'Apple Inc.', 25, 178.50, 185.20, 'LONG');

-- Closed Trade
INSERT INTO trades (user_id, symbol, type, action, quantity, entry_price, exit_price, entry_date, exit_date, pnl) VALUES
  ('USER_ID_HERE', 'GOOGL', 'LONG', 'CLOSED', 12, 142.50, 156.80, '2024-01-15', '2024-01-22', 171.60);

-- Market Indices (Public data - no user_id needed)
INSERT INTO market_indices (symbol, name, value, change_percent, is_positive) VALUES
  ('SPX', 'S&P 500', 5234.18, 1.24, true),
  ('IXIC', 'NASDAQ', 16742.39, 1.58, true),
  ('DJI', 'DOW JONES', 39087.38, 0.87, true),
  ('RUT', 'RUSSELL 2000', 2089.45, -0.32, false);
```

## Troubleshooting

### Error: "Missing Supabase environment variables"
- Make sure `.env` file exists in project root
- Restart the dev server after creating `.env`
- Verify the values are correct (no extra spaces)

### Error: "Row Level Security policy violation"
- You need to be authenticated or disable RLS for testing
- See Step 4 above

### Error: "relation does not exist"
- The schema hasn't been run yet
- Go back to Step 2 and run the schema

### Tables not showing in Supabase
- Check if schema ran successfully
- Refresh the page
- Check SQL Editor for error messages

## Next Steps

1. ✅ Run the schema (Step 2)
2. ✅ Test the app (Step 3)
3. ⬜ Set up authentication (Step 4)
4. ⬜ Add test data (Step 5)
5. ⬜ Test all features
6. ⬜ Implement authentication UI (if needed)
7. ⬜ Set up Python backend (optional)

## Useful Links

- **Supabase Dashboard**: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb
- **SQL Editor**: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
- **Table Editor**: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/database/tables
- **Auth Users**: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users

## Security Notes

- ⚠️ Never commit `.env` file to git (it's in `.gitignore`)
- ⚠️ Never share your anon key publicly
- ⚠️ Use service role key only in backend (never in frontend)
- ⚠️ Re-enable RLS before production deployment
