# Bugbot Audit Report - Advisor Ally Repository
**Generated:** $(date)  
**Repository:** advisor-ally  
**Audit Type:** Security, Logic Bugs, Edge Cases, Code Quality

---

## 🔴 CRITICAL SECURITY ISSUES

### 1. Missing Authorization Checks in Delete/Update Operations
**Severity:** CRITICAL  
**Location:** `src/services/api.ts`

**Issue:** The following API methods do not verify that the user owns the resource before allowing delete/update operations:
- `positionsApi.delete(id)` - Line 79-86
- `positionsApi.update(id, updates)` - Line 67-77
- `eyeApi.updateSnapshot(id, updates)` - Line 509-519
- `eyeApi.deleteSnapshot(id)` - Line 522-529

**Risk:** Users could potentially delete or modify other users' data by guessing or manipulating IDs.

**Recommendation:**
```typescript
// Example fix for positionsApi.delete
async delete(id: string, userId: string): Promise<void> {
  // First verify ownership
  const { data: position, error: fetchError } = await supabase
    .from('open_positions')
    .select('user_id')
    .eq('id', id)
    .eq('user_id', userId)
    .single();
  
  if (fetchError || !position) {
    throw new Error('Position not found or access denied');
  }
  
  const { error } = await supabase
    .from('open_positions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId); // Add user_id check here too
  
  if (error) throw error;
}
```

**Note:** While RLS policies should protect against this at the database level, defense-in-depth requires client-side validation as well.

---

### 2. API Keys Exposed in Client-Side Code
**Severity:** CRITICAL  
**Location:** `src/services/api.ts:614, 743`

**Issue:** OpenAI API key is accessed directly from environment variables in client-side code:
```typescript
const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY;
```

**Risk:** 
- API keys are bundled into the client JavaScript and visible to anyone
- Can be extracted from browser DevTools
- Leads to unauthorized API usage and potential cost overruns

**Recommendation:** 
- Move OpenAI API calls to a backend service (Python backend mentioned in code)
- Never expose API keys in client-side code
- Use the `VITE_PYTHON_API_URL` backend endpoint instead

---

### 3. Hardcoded Debug Endpoint in Production Code
**Severity:** HIGH  
**Location:** `src/components/auth/SignUpDialog.tsx:94, 113, 120, 154`

**Issue:** Debug logging endpoint hardcoded in signup flow:
```typescript
fetch('http://127.0.0.1:7242/ingest/35f772b5-a839-4b22-9045-0f9af9ec78dd', ...)
```

**Risk:**
- Exposes user data (email, names, age) to external debug service
- Privacy violation (GDPR/CCPA concerns)
- Debug code should not be in production

**Recommendation:**
- Remove all debug fetch calls or gate them behind a development-only flag
- Use proper logging service if needed, not hardcoded endpoints

---

## 🟠 HIGH PRIORITY ISSUES

### 4. Race Condition in Auth Callback
**Severity:** HIGH  
**Location:** `src/pages/AuthCallback.tsx:64-98`

**Issue:** Multiple potential race conditions:
1. Subscription cleanup may not happen if component unmounts during async operations
2. Timeout and subscription both try to navigate/unsubscribe
3. No cleanup if `handleAuthCallback` is called multiple times

**Risk:** Memory leaks, unexpected navigation, or duplicate subscriptions.

**Recommendation:**
```typescript
useEffect(() => {
  let isMounted = true;
  let subscription: { unsubscribe: () => void } | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  
  const handleAuthCallback = async () => {
    // ... existing code ...
    
    if (isMounted) {
      const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(...);
      subscription = authSubscription;
      
      timeoutId = setTimeout(() => {
        if (isMounted) {
          authSubscription.unsubscribe();
          // ... handle timeout ...
        }
      }, 10000);
    }
  };
  
  handleAuthCallback();
  
  return () => {
    isMounted = false;
    if (subscription) subscription.unsubscribe();
    if (timeoutId) clearTimeout(timeoutId);
  };
}, [navigate, searchParams]);
```

---

### 5. Missing Error Handling in Async Operations
**Severity:** HIGH  
**Location:** Multiple files

**Issues:**
- `src/services/api.ts:335-338` - Chat update operation doesn't handle errors
- `src/hooks/use-data.ts:236-239` - Title generation failure not handled gracefully
- `src/services/api.ts:726` - Fallback to Python backend may fail silently

**Risk:** Silent failures, poor user experience, difficult debugging.

**Recommendation:** Add comprehensive error handling and user feedback for all async operations.

---

### 6. Potential Division by Zero in Statistics
**Severity:** MEDIUM (handled but could be clearer)  
**Location:** `src/services/api.ts:138`

**Issue:** While division by zero is handled, the logic could be clearer:
```typescript
const profitFactor = avgLoss > 0 ? Math.abs(avgProfit) / avgLoss : 0;
```

**Recommendation:** Add explicit comments and consider edge cases where all trades are winners (avgLoss = 0).

---

## 🟡 MEDIUM PRIORITY ISSUES

### 7. Inconsistent Error Handling Patterns
**Severity:** MEDIUM  
**Location:** Throughout codebase

**Issue:** Some functions throw errors, others return null, some log to console. No consistent error handling strategy.

**Recommendation:** 
- Establish error handling patterns
- Use a centralized error handler
- Provide consistent user feedback

---

### 8. Missing Input Validation
**Severity:** MEDIUM  
**Location:** `src/services/api.ts`

**Issues:**
- `chatApi.addMessage` - No validation of message content length
- `pythonApi.getChatResponse` - No validation of message or history size
- `chatsApi.updateTitle` - No validation of title length

**Risk:** Potential DoS attacks, database bloat, API quota exhaustion.

**Recommendation:** Add input validation and limits:
```typescript
if (content.length > 10000) {
  throw new Error('Message too long');
}
```

---

### 9. No Rate Limiting on API Calls
**Severity:** MEDIUM  
**Location:** `src/services/api.ts:607-738`

**Issue:** OpenAI API calls have no rate limiting or retry logic. Users could spam requests.

**Risk:** 
- Cost overruns
- API quota exhaustion
- Poor user experience during failures

**Recommendation:** Implement rate limiting and exponential backoff retry logic.

---

### 10. Missing Null Checks
**Severity:** MEDIUM  
**Location:** Multiple locations

**Issues:**
- `src/services/api.ts:721` - `data.choices[0]?.message?.content` could still be undefined
- `src/hooks/use-data.ts:229` - `userProfile?.experience_level` could be null but not explicitly handled
- `src/services/api.ts:224` - `messagesByChat[chat.id]?.[0]` could be undefined

**Recommendation:** Add explicit null checks and default values.

---

## 🟢 LOW PRIORITY / CODE QUALITY

### 11. Magic Numbers
**Severity:** LOW  
**Location:** Multiple files

**Issues:**
- `src/services/api.ts:711` - `max_tokens: 400` - Should be a constant
- `src/services/api.ts:685` - `slice(-20)` - Should be a configurable constant
- `src/pages/AuthCallback.tsx:35` - `setTimeout(..., 1000)` - Magic number

**Recommendation:** Extract to named constants with documentation.

---

### 12. Inconsistent Date Handling
**Severity:** LOW  
**Location:** `src/services/api.ts:253, 512`

**Issue:** Some places use `new Date().toISOString()`, others might use different formats.

**Recommendation:** Use a centralized date utility function.

---

### 13. Type Safety Issues
**Severity:** LOW  
**Location:** `src/services/api.ts:543`

**Issue:** `ExperienceLevel` type allows `null` but usage doesn't always handle it:
```typescript
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | null;
```

**Recommendation:** Use a default value or make it non-nullable with proper defaults.

---

### 14. Missing JSDoc Comments
**Severity:** LOW  
**Location:** Throughout codebase

**Issue:** Many public API functions lack documentation.

**Recommendation:** Add JSDoc comments for all public APIs.

---

## 📋 SUMMARY

### Critical Issues: 3
- Missing authorization checks
- API keys in client code
- Debug endpoints in production

### High Priority: 3
- Race conditions
- Missing error handling
- Division by zero edge cases

### Medium Priority: 4
- Inconsistent patterns
- Missing validation
- No rate limiting
- Null safety

### Low Priority: 4
- Code quality improvements

---

## 🎯 RECOMMENDED ACTION PLAN

1. **Immediate (This Week):**
   - Remove debug endpoints from SignUpDialog
   - Add authorization checks to all delete/update operations
   - Move OpenAI API calls to backend

2. **Short Term (This Month):**
   - Fix race conditions in AuthCallback
   - Add comprehensive error handling
   - Implement input validation

3. **Medium Term (Next Sprint):**
   - Add rate limiting
   - Improve type safety
   - Standardize error handling patterns

4. **Ongoing:**
   - Code quality improvements
   - Documentation
   - Testing coverage

---

## ✅ POSITIVE FINDINGS

- Good use of TypeScript for type safety
- Proper use of React Query for data fetching
- RLS policies in place at database level
- Good separation of concerns (API layer, hooks, components)
- Proper use of Supabase client with type safety

---

**Note:** This audit assumes RLS policies are properly configured in Supabase. It's recommended to verify all RLS policies are active and correctly configured.
