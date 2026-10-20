import { Contact } from '@/types';

export interface SpamDetectionResult {
  isSpam: boolean;
  reasons: string[];
  confidence: number;
}

// Pattern data lives here (not in a component) so the dependency points
// UI -> utils, not in a cycle. Previously the component exported this and
// this module imported it back.
export const EMAIL_PATTERNS = {
  marketing: {
    title: 'Marketing & Promotions',
    patterns: [
      'promotions?',
      'deals?',
      'offer',
      'sale',
      'discount',
      'store',
      'shop',
      'buy',
      'special',
      'promo',
      '@marketing',
    ],
    icon: '🏷️',
  },
  notifications: {
    title: 'Notifications & Alerts',
    patterns: [
      'notification',
      'alert(s)?',
      'notify',
      'update',
      'status',
      'reminder',
      'confirm',
      'notice',
      '@alerts?',
    ],
    icon: '🔔',
  },
  newsletters: {
    title: 'Newsletters & Updates',
    patterns: [
      'newsletter(s)?',
      'news',
      'weekly',
      'monthly',
      'digest',
      'info',
      'learn',
      'list(s)?',
      '^info@',
      'subscribe',
      '@news',
      '@info',
      '@list(s)?',
    ],
    icon: '📰',
  },
  automated: {
    title: 'Automated Messages',
    patterns: [
      'noreply',
      'no-reply',
      'do-not-reply',
      'automated',
      'system',
      'mailer-daemon',
      '^mail@',
      '^email@',
      '^donotreply@',
      'notifications?@',
      '@mail\\.',
      '@mailer\\.',
    ],
    icon: '🤖',
  },
  corporate: {
    title: 'Corporate Communications',
    patterns: [
      'team',
      'office',
      'careers',
      'hr',
      'human-?resources',
      'recruiting',
      'talent',
      '^hello@',
      'company',
      '@team',
      '@office',
      '@careers',
    ],
    icon: '🏢',
  },
  support: {
    title: 'Customer Support',
    patterns: [
      'support',
      'help',
      'service',
      'contact',
      'feedback',
      'survey',
      'care',
      'assist',
      '^reviews?@',
      '@support',
      '@service',
      '@survey',
    ],
    icon: '💬',
  },
  travel: {
    title: 'Travel & Logistics',
    patterns: [
      'mileageplan',
      'travel',
      'flight',
      'booking',
      'reservation',
      'itinerary',
      'rewards?',
    ],
    icon: '✈️',
  },
  general: {
    title: 'General Communications',
    patterns: [
      'calendar',
      'events?',
      'invite',
      'rsvp',
      'schedule',
    ],
    icon: '📅',
  }
}

/**
 * Patterns are compiled once at module load (not per contact per render).
 * A plain word pattern must sit on a token boundary of the address —
 * 'news' matches "news@x.com" and "daily.news" but NOT "northbeam.co" or
 * "newsletter" (which has its own pattern). Patterns carrying their own
 * anchors or @-context (^info@, @mail\.) are used verbatim.
 */
const COMPILED_PATTERNS = Object.values(EMAIL_PATTERNS).map((category) => ({
  title: category.title,
  regexes: category.patterns.map((pattern) =>
    /[@^\\]/.test(pattern)
      ? new RegExp(pattern, 'i')
      : new RegExp(`(^|[@._+-])(?:${pattern})(?=$|[@._+-])`, 'i')
  ),
}));

function matchesEmailPatterns(email: string): string[] {
  const matches: string[] = [];
  for (const category of COMPILED_PATTERNS) {
    if (category.regexes.some((regex) => regex.test(email))) {
      matches.push(category.title);
    }
  }
  return matches;
}

const SUSPICIOUS_TLDS = ['.xyz', '.top', '.work', '.click', '.link'];

/**
 * Score how likely a contact is list/automation noise rather than a person.
 *
 * Calibrated for this app's data model, which is SENT-ONLY: heuristics
 * about "never replied" or "only received" are meaningless here (every
 * contact is someone the user emailed), so flagging requires positive
 * evidence — address patterns or a suspicious TLD. Weak signals (name
 * quality, odd timing) only ever reinforce, never flag on their own.
 */
export function analyzeContact(contact: Contact): SpamDetectionResult {
  const reasons: string[] = [];
  let spamScore = 0;

  const patternMatches = matchesEmailPatterns(contact.email);
  if (patternMatches.length > 0) {
    reasons.push(`Matches patterns: ${patternMatches.join(', ')}`);
    spamScore += 40 * Math.min(patternMatches.length, 2);
  }

  if (SUSPICIOUS_TLDS.some((tld) => contact.email.toLowerCase().endsWith(tld))) {
    reasons.push('Suspicious email domain');
    spamScore += 30;
  }

  // Reinforcing signals only (cannot reach the threshold alone)
  if (!contact.name || contact.name.length < 2 || contact.name === contact.email) {
    reasons.push('Missing or placeholder contact name');
    spamScore += 15;
  }

  if (contact.interactions && contact.interactions.length >= 8) {
    const hours = new Set(contact.interactions.map((i) => new Date(i.date).getHours()));
    if (hours.size <= 1) {
      reasons.push('Identical send time on every message');
      spamScore += 10;
    }
  }

  const confidence = Math.min(spamScore, 100);
  return {
    isSpam: confidence >= 40,
    reasons,
    confidence,
  };
}
