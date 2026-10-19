import posthog from 'posthog-js'

posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY as string, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    capture_pageview: 'history_change',
    // The contacts table renders third-party names and email addresses as
    // clickable elements; default autocapture would stream that PII to
    // PostHog on every click. Explicit events only.
    autocapture: false,
    person_profiles: 'identified_only',
    loaded: (posthog) => {
        if (process.env.NODE_ENV === 'development') posthog.debug()
    }
});
