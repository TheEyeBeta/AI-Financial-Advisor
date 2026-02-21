# Perplexity Fallback Integration

## Overview

The application now includes **automatic fallback to Perplexity** when OpenAI encounters rate limits, quota issues, or service unavailability. This ensures your AI Financial Advisor remains available even when OpenAI is experiencing issues.

## How It Works

1. **Primary Provider**: OpenAI (GPT-4o-mini) - used for all requests by default
2. **Fallback Provider**: Perplexity (llama-3.1-sonar-small-128k-online) - automatically used when:
   - OpenAI returns HTTP 429 (Rate Limit Exceeded)
   - OpenAI returns HTTP 402 (Quota Exceeded)
   - OpenAI returns HTTP 503 (Service Unavailable)
   - Network errors occur when calling OpenAI

## Configuration

### Get a Perplexity API Key

1. Go to https://www.perplexity.ai/
2. Sign up for an account
3. Navigate to API settings
4. Generate an API key (starts with `pplx-`)

### Set Environment Variable

**Local Development:**
```bash
export PERPLEXITY_API_KEY=pplx-your-actual-key-here
```

**Production (Railway/Render):**
Add to your environment variables:
```
PERPLEXITY_API_KEY=pplx-your-actual-key-here
```

**Docker Compose:**
Add to your `.env` file or export before running:
```bash
export PERPLEXITY_API_KEY=pplx-your-actual-key-here
docker-compose -f deployment/docker-compose.yml up
```

## Features

### Automatic Fallback
- No code changes needed in your frontend
- Seamless transition - users won't notice the switch
- All endpoints support fallback: `/api/chat`, `/api/chat/title`, `/api/ai/analyze-quantitative`

### Audit Logging
All fallback events are logged with reason:
- `openai_fallback_perplexity` event with reason:
  - `rate_limit_429` - OpenAI rate limit hit
  - `quota_exceeded_402` - OpenAI quota exceeded
  - `service_unavailable_503` - OpenAI service down
  - `network_error` - Network connectivity issue

### Cost Optimization
- Perplexity is only used when OpenAI fails
- Primary usage remains on OpenAI (typically cheaper)
- Fallback prevents service interruption

## Model Details

**Perplexity Model**: `llama-3.1-sonar-small-128k-online`
- Cost-effective fallback option
- 128k context window
- Online model (can access real-time information)
- Compatible with OpenAI API format

## Monitoring

Check audit logs to see fallback usage:
```bash
# View recent fallback events
grep "openai_fallback_perplexity" backend/websearch_service/logs/audit.jsonl
```

## Behavior Without Perplexity Key

If `PERPLEXITY_API_KEY` is not set:
- App continues to work normally with OpenAI
- When OpenAI fails, users will see appropriate error messages
- No fallback occurs (graceful degradation)

## Testing

To test the fallback:
1. Temporarily set an invalid OpenAI key
2. Make a request to `/api/chat`
3. Should automatically fallback to Perplexity (if configured)

## Benefits

✅ **High Availability**: Service continues even when OpenAI has issues  
✅ **Cost Control**: Only uses Perplexity when needed  
✅ **Transparent**: Users don't experience downtime  
✅ **Auditable**: All fallbacks are logged  
✅ **Optional**: Works without Perplexity, just no fallback

## Next Steps

1. Get your Perplexity API key from https://www.perplexity.ai/
2. Add `PERPLEXITY_API_KEY` to your backend environment
3. Restart your backend service
4. Monitor audit logs to see fallback usage

---

**Note**: Perplexity fallback is completely optional. Your app works perfectly fine without it, you just won't have automatic fallback when OpenAI hits limits.
