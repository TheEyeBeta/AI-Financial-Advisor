# Setting Up John Doe Test User

This guide shows you how to create a test user "John Doe" with sample data for testing the application.

## Step 1: Create User in Supabase Auth

1. **Go to Supabase Auth Dashboard:**
   - Open: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
   - Or: Dashboard → Authentication → Users

2. **Create New User:**
   - Click "Add user" → "Create new user"
   - **Email**: `john.doe@example.com`
   - **Password**: `TestPassword123!` (or any password you prefer)
   - Click "Create user"

3. **Copy User ID:**
   - After creating, you'll see the user in the list
   - Click on the user to view details
   - Copy the **User UID** (UUID) - it looks like: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

## Step 2: Insert Test Data

1. **Go to SQL Editor:**
   - Open: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
   - Or: Dashboard → SQL Editor → New Query

2. **Open `create-john-doe-user.sql`** file from this project

3. **Replace the User ID:**
   - Find `'YOUR_USER_ID_HERE'` in the SQL file
   - Replace it with the actual User UID you copied in Step 1
   - Example: `'a1b2c3d4-e5f6-7890-abcd-ef1234567890'`

4. **Run the Script:**
   - Copy the entire modified SQL script
   - Paste into Supabase SQL Editor
   - Click "Run" (or press Ctrl+Enter / Cmd+Enter)
   - You should see: "Test data for John Doe created successfully!"

## Step 3: Verify Test Data

1. **Check Tables:**
   - Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/database/tables
   - You should see data in:
     - `users` - 1 user (john.doe@example.com)
     - `portfolio_history` - 12 entries
     - `open_positions` - 4 positions
     - `trades` - 7 closed trades
     - `trade_journal` - 3 journal entries
     - `learning_topics` - 5 topics
     - `achievements` - 3 achievements
     - `chat_messages` - 1 welcome message
     - `market_indices` - 4 indices
     - `trending_stocks` - 5 stocks

## Step 4: Test in Application

1. **Sign In as John Doe:**
   - Start your app: `npm run dev`
   - Go to: http://localhost:8080
   - Sign in with:
     - Email: `john.doe@example.com`
     - Password: `TestPassword123!` (or the password you set)

2. **Verify Data is Showing:**
   - **Dashboard**: Should show portfolio performance, trade statistics, market overview, learning progress
   - **Paper Trading → Open Positions**: Should show 4 positions (AAPL, MSFT, NVDA, TSLA)
   - **Paper Trading → Trade History**: Should show 7 closed trades
   - **Paper Trading → Trade Journal**: Should show 3 journal entries (with working form)
   - **Paper Trading → Performance**: Should show charts based on your data
   - **Advisor**: Should show welcome message and allow chat

## Alternative: Quick SQL Method

If you prefer, you can also manually insert the data. First, get your user ID:

```sql
-- Get your user ID
SELECT id, email FROM auth.users WHERE email = 'john.doe@example.com';
```

Then use that ID in the test data script, or insert manually:

```sql
-- Replace 'YOUR_USER_ID' with actual ID from above query
INSERT INTO public.users (id, email, created_at, updated_at)
VALUES ('YOUR_USER_ID', 'john.doe@example.com', NOW(), NOW());

-- Then insert portfolio history, trades, etc. using YOUR_USER_ID
-- See create-john-doe-user.sql for full examples
```

## Sample Data Included

### Portfolio History
- 12 data points from Jan 1 to Mar 22, 2024
- Starting at $10,000, ending at $15,340
- Shows portfolio growth over time

### Open Positions
- **AAPL**: 25 shares @ $178.50 (current: $185.20)
- **MSFT**: 15 shares @ $420.00 (current: $415.80)
- **NVDA**: 10 shares @ $875.00 (current: $920.50)
- **TSLA**: 8 shares @ $245.00 (current: $238.75)

### Closed Trades
- **GOOGL**: +$171.60 (win)
- **AMD**: -$204.00 (loss)
- **META**: +$218.40 (win)
- **AMZN**: +$100.50 (win)
- **NFLX**: -$61.00 (loss)
- Plus 2 more trades

### Trade Journal
- 3 detailed journal entries with strategies and notes
- Includes tags for categorization

### Learning Progress
- Stock Market Basics: 100% (completed)
- Technical Analysis: 75%
- Options Trading: 40%
- Risk Management: 60%
- Portfolio Theory: 20%

### Achievements
- First Trade 🎯
- Week Streak 🔥
- Profit Master 💰

### Market Data (Public)
- S&P 500, NASDAQ, Dow Jones, Russell 2000
- Trending stocks: NVDA, TSLA, AAPL, MSFT, GOOGL

## Troubleshooting

### "User not found" error
- Make sure you created the user in Supabase Auth dashboard first
- Verify the user ID matches the one in `auth.users` table

### "Foreign key constraint" error
- Make sure you ran `supabase-schema.sql` first
- The user must exist in `auth.users` before creating profile

### "RLS policy violation" error
- If you see this, the user is not authenticated
- Sign in as John Doe first, then the data should be visible
- Or temporarily disable RLS for testing (NOT for production)

### Data not showing in app
- Verify you're signed in as John Doe
- Check browser console for errors (F12)
- Verify the user ID in database matches the signed-in user
- Make sure all data was inserted successfully

## Next Steps

After setting up John Doe:
1. ✅ Test all features with the test data
2. ✅ Verify forms work (Trade Journal form)
3. ✅ Test OpenAI chat (if API key is set)
4. ✅ Test adding new data
5. ✅ Test updating/deleting data

## Notes

- The test user password should be strong (use the one you set)
- All test data is realistic but fictional
- Market data is static - update it periodically if needed
- The user ID must match between `auth.users` and all data tables
