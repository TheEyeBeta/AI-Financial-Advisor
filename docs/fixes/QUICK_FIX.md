# Quick Fix for Blank Page

## The Issue
The page is loading but showing blank/dark screen in VS Code's browser view.

## Solution 1: Open in External Browser

VS Code's embedded browser view sometimes has issues with React apps. Try opening in your system browser:

1. **Copy the URL**: `http://localhost:8080`
2. **Open in Chrome/Firefox/Edge**: Paste the URL in your external browser
3. **Check DevTools**: Press F12 to see console errors

## Solution 2: Check Browser Console

The blank page is likely due to a JavaScript error. Check the console:

1. In VS Code browser view: Click the **cursor/inspect icon** in the address bar
2. Or open external browser and press **F12**
3. Look for **red errors** in the Console tab

## Solution 3: Common Causes

### Missing Supabase Config
If you see errors about Supabase, the page should still load (we fixed this), but check:
```bash
cat .env | grep VITE_SUPABASE
```

### JavaScript Module Errors
Check if modules are loading:
- Network tab should show files with 200 status
- Look for 404 errors on `/src/` files

### CSS Issues
The page might be rendering but invisible. Check:
- Elements tab → Find `<div id="root">`
- See if it has content but is hidden

## Solution 4: Hard Refresh

In VS Code browser view:
- Click the **refresh icon** in the address bar
- Or press **Ctrl+R** (Cmd+R on Mac)

## Solution 5: Restart Dev Server

```bash
# Stop current server (Ctrl+C)
# Then restart
npm run dev
```

## Expected Result

You should see:
- "AI Financial Advisor" heading
- "Get Started" and "Sign In" buttons  
- Feature cards below

If still blank, **check the browser console** - that will tell us exactly what's wrong!
