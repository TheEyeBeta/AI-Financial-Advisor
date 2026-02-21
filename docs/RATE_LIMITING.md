# Professional Rate Limiting System

## Overview

The rate limiting system has been completely redesigned to be production-ready with cost control, abuse prevention, and multi-tier protection.

## Key Features

### 1. **Multi-Tier Rate Limiting**
- **User-based**: When `user_id` is provided, limits are enforced per user (more secure)
- **IP-based**: Falls back to IP address when user_id is not available
- **Endpoint-specific**: Different limits for different endpoints based on their cost/usage patterns

### 2. **Cost Control**
- **Token-based limits**: Tracks estimated and actual token usage
- **Per-window limits**: Minute, hour, and daily token limits
- **Cost tracking**: Monitors API costs per user/IP to prevent runaway expenses

### 3. **Abuse Prevention**
- **Suspicious activity detection**: Automatically blocks IPs/users making excessive requests
- **Concurrent request limits**: Prevents resource exhaustion
- **Automatic blocking**: Temporarily blocks abusive users/IPs for configurable duration
- **Audit logging**: All abuse events are logged for security review

### 4. **Professional Features**
- **Rate limit headers**: Standard HTTP headers inform clients of limits and remaining quota
- **Clear error messages**: Users know exactly when they can retry
- **Memory management**: Automatic cleanup of old entries to prevent memory leaks
- **Configurable**: Easy to adjust limits per endpoint

## Rate Limit Configuration

### Endpoint-Specific Limits

#### `/api/chat` (Main Chat Endpoint)
- **Requests**: 20/min, 150/hour, 500/day
- **Tokens**: 40,000/min, 150,000/hour, 800,000/day
- **Rationale**: Most expensive endpoint, needs stricter limits

#### `/api/chat/title` (Title Generation)
- **Requests**: 60/min, 500/hour, 2,000/day
- **Tokens**: 10,000/min, 50,000/hour, 200,000/day
- **Rationale**: Lightweight operation, can handle more requests

#### `/api/ai/analyze-quantitative` (Analysis)
- **Requests**: 30/min, 200/hour, 1,000/day
- **Tokens**: 30,000/min, 100,000/hour, 500,000/day
- **Rationale**: Moderate cost, balanced limits

### Abuse Detection Thresholds
- **Suspicious threshold**: 50 requests in 1 minute triggers automatic block
- **Block duration**: 1 hour (configurable)
- **Concurrent requests**: Maximum 5 concurrent requests per user/IP

## Rate Limit Headers

All responses include standard rate limit headers:

```
X-RateLimit-Limit-Minute: 20
X-RateLimit-Remaining-Minute: 15
X-RateLimit-Reset-Minute: 1640995200

X-RateLimit-Limit-Hour: 150
X-RateLimit-Remaining-Hour: 135
X-RateLimit-Reset-Hour: 1640998800

X-RateLimit-Limit-Day: 500
X-RateLimit-Remaining-Day: 485
X-RateLimit-Reset-Day: 1641081600
```

## Security Improvements

### 1. **User-Based Prioritization**
- When `user_id` is provided, rate limiting uses user ID instead of IP
- Prevents IP rotation attacks
- More accurate per-user cost tracking

### 2. **IP Address Handling**
- Properly handles `X-Forwarded-For` headers (proxy/load balancer support)
- Falls back to `X-Real-IP` if available
- Handles unknown IPs gracefully

### 3. **Cost Protection**
- Prevents accidental or malicious high-cost requests
- Tracks both estimated (before request) and actual (after response) tokens
- Multiple time windows prevent short-term spikes

## Error Messages

Users receive clear, actionable error messages:

- `"Rate limit exceeded: 20 requests per minute. Retry after 45 seconds."`
- `"Token limit exceeded: 40,000 tokens per minute."`
- `"Account temporarily blocked due to suspicious activity. Retry after 3600 seconds."`
- `"Too many concurrent requests. Maximum: 5"`

## Implementation Details

### Token Estimation
- Uses formula: `(text_length / 4) * 1.2 + system_overhead`
- Accounts for system messages and response tokens
- Conservative estimates to prevent cost overruns

### Memory Management
- Automatic cleanup of old entries every 5 minutes
- Removes identifiers with no activity in last 48 hours
- Prevents memory leaks in long-running services

### Concurrent Request Tracking
- Tracks active requests per user/IP
- Prevents resource exhaustion attacks
- Automatically releases slots when requests complete

## Cost Reduction Benefits

1. **Prevents Runaway Costs**: Token limits prevent accidental expensive requests
2. **Fair Usage**: Ensures resources are distributed fairly among users
3. **Abuse Prevention**: Blocks malicious users before they incur costs
4. **Cost Visibility**: Audit logs track actual token usage for billing

## Hacking Prevention

1. **IP Rotation Resistance**: User-based limiting prevents IP rotation attacks
2. **Rate Limit Headers**: Clients can't easily determine exact limits
3. **Automatic Blocking**: Suspicious patterns trigger automatic blocks
4. **Audit Trail**: All abuse attempts are logged for investigation
5. **Concurrent Limits**: Prevents resource exhaustion attacks

## Configuration

To adjust limits, modify `RateLimitConfig` in `app/services/rate_limit.py`:

```python
self._endpoint_configs: Dict[str, RateLimitConfig] = {
    "/api/chat": RateLimitConfig(
        requests_per_minute=20,
        requests_per_hour=150,
        requests_per_day=500,
        tokens_per_minute=40000,
        tokens_per_hour=150000,
        tokens_per_day=800000,
    ),
    # ... other endpoints
}
```

## Future Enhancements

1. **Redis Backend**: For distributed rate limiting across multiple instances
2. **Per-User Tiers**: Different limits for free/premium users
3. **Dynamic Limits**: Adjust limits based on system load
4. **Cost Alerts**: Notify admins when costs exceed thresholds
5. **Whitelist/Blacklist**: Manual override for specific users/IPs

## Testing

All rate limiting functionality is covered by comprehensive tests:
- Rate limit enforcement
- Token tracking
- Abuse detection
- Header generation
- Error handling

Run tests with:
```bash
pytest tests/test_ai_proxy.py -v
```

## Migration Notes

The old rate limiting system (`_request_windows`) has been completely replaced. All endpoints now use the new `RateLimitService`.

**Breaking Changes**: None - API remains the same, only internal implementation changed.

**Benefits**: 
- More secure
- Better cost control
- Professional error messages
- Standard HTTP headers
- Abuse prevention
