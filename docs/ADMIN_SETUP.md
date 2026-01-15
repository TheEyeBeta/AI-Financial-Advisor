# Admin Panel Setup

## Overview

The admin panel allows designated users to manage other users, view statistics, and perform administrative tasks.

## Setup Instructions

### Step 1: Add Admin Field to Database

1. Go to your Supabase SQL Editor
2. Run the migration script: `sql/add-admin-field.sql`
   - This adds an `is_admin` boolean column to the `public.users` table
   - Defaults to `FALSE` for all existing users

### Step 2: Make a User Admin

After running the migration, you can make a user an admin by running:

```sql
-- Replace 'user-email@example.com' with the actual email of the user you want to make admin
UPDATE public.users 
SET is_admin = TRUE 
WHERE email = 'user-email@example.com';
```

Or via Supabase Dashboard:
1. Go to **Table Editor** → `users` table
2. Find the user you want to make admin
3. Edit the row and set `is_admin` to `true`

### Step 3: Access Admin Panel

1. Log in as the admin user
2. You'll see an **"Admin"** link in the sidebar (with a shield icon)
3. Click it to access `/admin`

## Features

### Admin Panel Includes:

- **Statistics Dashboard**
  - Total Users count
  - Number of Admins
  - Number of Verified Users

- **User Management Table**
  - View all users
  - See user details (name, email, verification status, role)
  - Promote/demote users to/from admin
  - View join dates

### Security

- Only users with `is_admin = TRUE` can access `/admin`
- Non-admin users are automatically redirected to `/dashboard` if they try to access `/admin`
- The admin link only appears in the sidebar for admin users

## Route Protection

The admin route is protected by `AdminRoute` component which:
1. Checks if user is authenticated
2. Checks if user has `is_admin = TRUE` in their profile
3. Redirects non-admin users to dashboard
4. Shows loading state during checks

## Making Users Admin via Code

You can also programmatically make users admin (requires service role or admin privileges):

```typescript
// In a server-side function or admin script
await supabase
  .from('users')
  .update({ is_admin: true })
  .eq('email', 'admin@example.com');
```

## Notes

- The `is_admin` field is included in the user profile fetched by `useAuth()`
- Admin status is checked via `userProfile?.is_admin`
- The sidebar automatically shows/hides the Admin link based on admin status
