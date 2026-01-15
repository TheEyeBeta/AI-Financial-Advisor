# Automated John Doe Setup Guide

I've updated the SQL script to automatically detect and use existing users, but creating users in Supabase Auth requires special permissions. Here are **3 easy ways** to set up John Doe:

## ✅ Option 1: Use Updated Script (Recommended)

The updated `create-john-doe-user.sql` script now:
- ✅ **Auto-detects** if John Doe user already exists
- ✅ **Creates all test data** automatically
- ✅ **Updates existing data** if user already has some data
- ✅ **Works immediately** if user was created in Auth Dashboard

### Steps:

1. **First, create the user in Supabase Auth Dashboard** (one-time setup):
   - Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
   - Click "Add user" → "Create new user"
   - Email: `john.doe@example.com`
   - Password: `TestPassword123!`
   - Click "Create user"

2. **Run the updated script**:
   - Open: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/sql/new
   - Open `create-john-doe-user.sql` file
   - Copy entire contents
   - Paste into SQL Editor
   - Click "Run"
   - ✅ Done! All test data is created automatically

3. **Test it**:
   - Go to your app: http://localhost:8080
   - Click "Sign In" (top right)
   - Click "Sign in as John Doe"
   - ✅ You're signed in with all test data!

## ✅ Option 2: Create User Programmatically (Advanced)

If you want to automate user creation, you can use Supabase Management API via Python/Node.js:

### Using Python:
```python
from supabase import create_client
import os

# Use service role key (NOT anon key - this is for backend only!)
supabase_url = os.getenv("SUPABASE_URL")
service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase = create_client(supabase_url, service_role_key)

# Create user
response = supabase.auth.admin.create_user({
    "email": "john.doe@example.com",
    "password": "TestPassword123!",
    "email_confirm": True
})

print(f"User created: {response.user.id}")
```

### Using Node.js/JavaScript:
```javascript
import { createClient } from '@supabase/supabase-js'

// Use service role key (backend only!)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Create user
const { data, error } = await supabase.auth.admin.createUser({
  email: 'john.doe@example.com',
  password: 'TestPassword123!',
  email_confirm: true
})

console.log('User created:', data.user.id)
```

Then run the SQL script to add test data.

## ✅ Option 3: Manual Setup (One-Time)

1. **Create user in Auth Dashboard** (as shown in Option 1)
2. **Get the User ID** from the created user
3. **Run the SQL script** - it will detect the user automatically

## 🔧 What the Updated Script Does

The `create-john-doe-user.sql` script now:

1. **Checks if user exists** in `auth.users` table
2. **If exists**: Uses that user ID and creates all test data
3. **If not exists**: Shows instructions to create user first
4. **Creates/updates**:
   - ✅ User profile in `public.users`
   - ✅ 12 portfolio history entries
   - ✅ 4 open positions
   - ✅ 5 closed trades
   - ✅ 2 trade journal entries
   - ✅ 5 learning topics
   - ✅ 3 achievements
   - ✅ Initial chat message
   - ✅ Market indices (public)
   - ✅ Trending stocks (public)

## 🚀 Quick Start (Easiest)

1. **Create user once**:
   ```
   Supabase Dashboard → Auth → Users → Add user
   Email: john.doe@example.com
   Password: TestPassword123!
   ```

2. **Run script**:
   ```
   Copy create-john-doe-user.sql → Paste in SQL Editor → Run
   ```

3. **Test**:
   ```
   App → Sign In → Sign in as John Doe → ✅ Done!
   ```

## 📋 Verification

After running the script, verify it worked:

```sql
-- Check user exists
SELECT id, email FROM auth.users WHERE email = 'john.doe@example.com';

-- Check test data
SELECT 'Portfolio History' as table_name, COUNT(*) as count FROM public.portfolio_history WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com')
UNION ALL
SELECT 'Open Positions', COUNT(*) FROM public.open_positions WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com')
UNION ALL
SELECT 'Trades', COUNT(*) FROM public.trades WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com')
UNION ALL
SELECT 'Trade Journal', COUNT(*) FROM public.trade_journal WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com')
UNION ALL
SELECT 'Learning Topics', COUNT(*) FROM public.learning_topics WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com')
UNION ALL
SELECT 'Achievements', COUNT(*) FROM public.achievements WHERE user_id = (SELECT id FROM auth.users WHERE email = 'john.doe@example.com');
```

Expected results:
- Portfolio History: 12
- Open Positions: 4
- Trades: 5
- Trade Journal: 2
- Learning Topics: 5
- Achievements: 3

## ⚠️ Important Notes

- **User creation via SQL**: Supabase doesn't allow direct SQL insertion into `auth.users` for security reasons (password hashing)
- **Auth Dashboard**: Easiest way to create users
- **Management API**: Use service role key for programmatic creation
- **Script is idempotent**: Can run multiple times safely (won't duplicate data)

## 🎯 After Setup

Once setup is complete:
- ✅ Sign in as John Doe using the top right button
- ✅ See all test data in Dashboard
- ✅ Test Paper Trading features
- ✅ Use AI Advisor chat
- ✅ Everything works with real data!

Enjoy! 🎉
