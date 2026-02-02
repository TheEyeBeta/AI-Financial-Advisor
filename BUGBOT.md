# Bugbot Configuration for Advisor Ally

This file configures Bugbot's code review for this repository.

## Focus Areas

### Security
- Authorization checks: Verify all delete/update operations check user ownership
- API key exposure: Ensure no secrets are exposed in client-side code
- Input validation: Check for SQL injection, XSS, and other injection vulnerabilities
- Authentication: Verify proper session handling and auth state management

### Logic Bugs
- Race conditions: Check for async/await issues, subscription cleanup, useEffect dependencies
- Null/undefined handling: Verify all optional chaining and null checks
- Edge cases: Division by zero, empty arrays, boundary conditions
- State management: Check for stale closures, missing dependencies

### Data Integrity
- Database operations: Verify RLS policies are properly enforced
- Transaction safety: Check for atomic operations where needed
- Data validation: Ensure all user inputs are validated before database operations

### Error Handling
- Async operations: All promises should have error handling
- User feedback: Errors should be communicated to users
- Logging: Sensitive data should not be logged

## Codebase-Specific Context

### Architecture
- Frontend: React + TypeScript + Vite
- Backend: Supabase (PostgreSQL with RLS)
- Authentication: Supabase Auth
- State Management: React Query for server state

### Key Patterns
- All database operations go through `src/services/api.ts`
- User ID should always be verified before operations
- RLS policies at database level provide defense-in-depth
- Client-side validation is still required for better UX

### Known Issues to Watch For
1. **Authorization**: API methods like `positionsApi.delete()` and `eyeApi.updateSnapshot()` don't verify user ownership
2. **API Keys**: OpenAI API key is exposed in client-side code (`VITE_OPENAI_API_KEY`)
3. **Debug Code**: Hardcoded debug endpoints in `SignUpDialog.tsx`
4. **Race Conditions**: Auth callback has potential memory leaks

### Files Requiring Extra Attention
- `src/services/api.ts` - All CRUD operations
- `src/pages/AuthCallback.tsx` - Auth state management
- `src/components/auth/SignUpDialog.tsx` - Debug endpoints
- `src/hooks/use-data.ts` - Data fetching hooks

## Review Guidelines

### Critical Issues (Block PR)
- Security vulnerabilities (authorization bypass, exposed secrets)
- Data corruption risks
- Authentication/authorization bugs

### High Priority (Should Fix)
- Race conditions
- Memory leaks
- Missing error handling
- Logic bugs that could cause crashes

### Medium Priority (Nice to Have)
- Code quality improvements
- Performance optimizations
- Better error messages

## Ignore Patterns
- Styling/formatting issues (handled by linter)
- Test files (unless logic bugs)
- Generated files in `dist/`
