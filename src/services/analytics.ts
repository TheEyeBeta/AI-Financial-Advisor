/**
 * Product analytics service.
 *
 * Uses PostHog for funnel tracking, retention measurement, and conversion
 * metrics.  Falls back to a no-op implementation when the PostHog key is
 * not configured so the rest of the app never needs to guard calls.
 *
 * Env var: VITE_POSTHOG_KEY  (optional — analytics disabled when absent)
 * Env var: VITE_POSTHOG_HOST (optional — defaults to PostHog Cloud US)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnalyticsProperties {
  [key: string]: string | number | boolean | null | undefined;
}

interface AnalyticsService {
  /** Initialise the provider (call once at app boot). */
  init(): void;
  /** Identify a logged-in user. */
  identify(userId: string, traits?: AnalyticsProperties): void;
  /** Reset identity on sign-out. */
  reset(): void;
  /** Track a named event. */
  track(event: string, properties?: AnalyticsProperties): void;
  /** Track a page/screen view. */
  page(name: string, properties?: AnalyticsProperties): void;
}

// ---------------------------------------------------------------------------
// PostHog implementation
// ---------------------------------------------------------------------------

let posthogInstance: ReturnType<typeof import('posthog-js')['default']['init']> | null = null;

function createPostHogService(): AnalyticsService {
  return {
    init() {
      const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
      if (!key) return;

      import('posthog-js').then(({ default: posthog }) => {
        posthog.init(key, {
          api_host: (import.meta.env.VITE_POSTHOG_HOST as string) || 'https://us.i.posthog.com',
          autocapture: false,           // explicit events only — keeps data clean
          capture_pageview: false,      // we call page() manually for SPA routes
          capture_pageleave: true,
          persistence: 'localStorage',
          disable_session_recording: true,  // opt-in later if needed
        });
        posthogInstance = posthog;
      }).catch(() => {
        // PostHog JS failed to load (ad-blocker, network issue) — silent no-op
      });
    },

    identify(userId, traits) {
      posthogInstance?.identify(userId, traits);
    },

    reset() {
      posthogInstance?.reset();
    },

    track(event, properties) {
      posthogInstance?.capture(event, properties);
    },

    page(name, properties) {
      posthogInstance?.capture('$pageview', { ...properties, $current_url: window.location.href, page_name: name });
    },
  };
}

// ---------------------------------------------------------------------------
// No-op fallback (VITE_POSTHOG_KEY not set)
// ---------------------------------------------------------------------------

const noopService: AnalyticsService = {
  init() {},
  identify() {},
  reset() {},
  track() {},
  page() {},
};

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
export const analytics: AnalyticsService = POSTHOG_KEY
  ? createPostHogService()
  : noopService;

// ---------------------------------------------------------------------------
// Pre-defined event helpers (typed surface area for the product)
// ---------------------------------------------------------------------------

export const AnalyticsEvents = {
  // ── Auth funnel ──
  signUp: (method: 'email' | 'oauth' = 'email') =>
    analytics.track('sign_up', { method }),
  signIn: (method: 'email' | 'oauth' = 'email') =>
    analytics.track('sign_in', { method }),
  signOut: () =>
    analytics.track('sign_out'),
  onboardingComplete: (properties?: AnalyticsProperties) =>
    analytics.track('onboarding_complete', properties),

  // ── Core product ──
  chatSent: (chatId?: string, properties?: AnalyticsProperties) =>
    analytics.track('chat_message_sent', { chat_id: chatId, ...properties }),
  chatResponseReceived: (chatId?: string, properties?: AnalyticsProperties) =>
    analytics.track('chat_response_received', { chat_id: chatId, ...properties }),
  chatResponseFailed: (properties?: AnalyticsProperties) =>
    analytics.track('chat_response_failed', properties),
  tradeExecuted: (action: string, symbol: string, properties?: AnalyticsProperties) =>
    analytics.track('trade_executed', { action, symbol, ...properties }),
  tradeJournalEntry: (properties?: AnalyticsProperties) =>
    analytics.track('trade_journal_entry_created', properties),

  // ── Engagement / retention ──
  learningTopicStarted: (topic: string, properties?: AnalyticsProperties) =>
    analytics.track('learning_topic_started', { topic, ...properties }),
  learningTopicCompleted: (topic: string, properties?: AnalyticsProperties) =>
    analytics.track('learning_topic_completed', { topic, ...properties }),
  newsArticleClicked: (provider?: string | null, properties?: AnalyticsProperties) =>
    analytics.track('news_article_clicked', { provider, ...properties }),
  newsSortChanged: (sortOrder: string) =>
    analytics.track('news_sort_changed', { sort_order: sortOrder }),
  stockRankingViewed: (properties?: AnalyticsProperties) =>
    analytics.track('stock_ranking_viewed', properties),
  stockRankingFilterChanged: (properties?: AnalyticsProperties) =>
    analytics.track('stock_ranking_filter_changed', properties),
  stockDetailExpanded: (ticker: string, properties?: AnalyticsProperties) =>
    analytics.track('stock_detail_expanded', { ticker, ...properties }),

  // ── Feature discovery ──
  featureViewed: (feature: string, properties?: AnalyticsProperties) =>
    analytics.track('feature_viewed', { feature, ...properties }),
} as const;
