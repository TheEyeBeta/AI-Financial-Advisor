# User Authentication Guide

A login/logout component has been added to the top right of the app header!

## ✅ What's Been Added

### Top Right Login/Logout Button
- **Location**: Top right corner of every page (in the header)
- **Features**:
  - Quick "Sign in as John Doe" button for testing
  - Custom sign in with email/password
  - Shows user email when signed in
  - Sign out functionality
  - Responsive design (shows icon on mobile, text on desktop)

## 🚀 How to Use

### Option 1: Quick Sign In as John Doe (Recommended for Testing)

1. **Click the "Sign In" button** (top right)
2. **Select "Sign in as John Doe"** from the dropdown
3. **Confirm in the dialog** - It will automatically use:
   - Email: `john.doe@example.com`
   - Password: `TestPassword123!`
4. **Click "Sign In as John Doe"** button
5. ✅ You're signed in! You'll see your email in the top right

### Option 2: Custom Sign In

1. **Click the "Sign In" button** (top right)
2. **Select "Custom Sign In"** from the dropdown
3. **Enter your email and password** in the dialog
4. **Click "Sign In"**
5. ✅ You're signed in!

### Sign Out

1. **Click your email/name** (top right when signed in)
2. **Click "Sign Out"** from the dropdown menu
3. ✅ You're signed out!

## 📋 Prerequisites

### For John Doe Sign In:
Before you can use the "Sign in as John Doe" feature, you need to:

1. **Create the user in Supabase Auth:**
   - Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
   - Click "Add user" → "Create new user"
   - Email: `john.doe@example.com`
   - Password: `TestPassword123!`
   - Click "Create user"

2. **Add test data** (optional but recommended):
   - Follow instructions in `JOHN_DOE_SETUP.md`
   - This will add portfolio data, trades, etc. for testing

### For Custom Sign In:
- You need to create users in Supabase Auth dashboard first
- Or sign up programmatically (can be added later)

## 🎯 Testing Workflow

1. **Start the app:**
   ```bash
   npm run dev
   ```

2. **Open in browser:**
   - Go to: http://localhost:8080

3. **Test sign in:**
   - Click "Sign In" (top right)
   - Click "Sign in as John Doe"
   - Confirm sign in

4. **Verify you're signed in:**
   - You should see your email in the top right
   - Dashboard should show data (if test data was added)
   - All pages should work with your data

5. **Test sign out:**
   - Click your email (top right)
   - Click "Sign Out"
   - You should be signed out

## 🔒 What Happens When You Sign In

- ✅ Your session is stored in Supabase Auth
- ✅ All API calls are authenticated
- ✅ You can only see your own data (Row Level Security)
- ✅ Session persists across page refreshes
- ✅ Automatically signs you out if session expires

## 📱 UI Features

### When Not Signed In:
- Shows "Sign In" button with login icon
- Dropdown menu with:
  - "Sign in as John Doe" (quick test)
  - "Custom Sign In" (email/password)

### When Signed In:
- Shows user email/name with user icon
- Dropdown menu with:
  - Account info (email)
  - "Sign Out" option

### Responsive:
- Desktop: Shows full text ("Sign In", "john.doe@example.com")
- Mobile: Shows icon only
- Dropdown menu works on both

## 🐛 Troubleshooting

### "Failed to sign in. Make sure John Doe user exists"
- **Solution**: Create the user in Supabase Auth dashboard first
- Go to: https://supabase.com/dashboard/project/nsngzzbgankkxxxsdacb/auth/users
- Create user with email: `john.doe@example.com` and password: `TestPassword123!`

### "User not found" error
- **Solution**: Verify the user exists in Supabase Auth dashboard
- Check the email spelling matches exactly

### "Invalid login credentials"
- **Solution**: Check the password is correct
- For John Doe: Make sure password is `TestPassword123!`
- For custom: Verify the password in Supabase dashboard

### Button not showing
- **Solution**: Check browser console for errors
- Verify `UserAuth` component is imported in `AppLayout`
- Make sure all dependencies are installed

### Can't see my data after signing in
- **Solution**: Make sure you've run the test data script
- See `JOHN_DOE_SETUP.md` for instructions
- Verify data is associated with the correct user ID

## 💡 Tips

1. **For Quick Testing:**
   - Use "Sign in as John Doe" - it's the fastest way to test

2. **For Multiple Users:**
   - Create different users in Supabase Auth dashboard
   - Sign in with different credentials
   - Each user will only see their own data

3. **Session Management:**
   - Sessions persist until you sign out or they expire
   - Sign out when done testing to clear the session
   - Refresh the page - you should stay signed in

4. **Security:**
   - Passwords are handled securely by Supabase
   - Never expose API keys or credentials
   - User data is protected by Row Level Security (RLS)

## ✅ Checklist

- [ ] John Doe user created in Supabase Auth
- [ ] Test data added (optional, see `JOHN_DOE_SETUP.md`)
- [ ] App running (`npm run dev`)
- [ ] Can see "Sign In" button (top right)
- [ ] Can sign in as John Doe
- [ ] See email/name after signing in
- [ ] Can see data (if test data was added)
- [ ] Can sign out
- [ ] Session persists on page refresh

Enjoy testing! 🎉
