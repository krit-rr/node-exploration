/**
 * Where "open this email" goes. The compose deep links prefill recipient,
 * subject and body in the web client the user signed in with; everyone
 * else gets a mailto link, which their mail app handles.
 */
export function composeLabel(provider?: string | null): string {
  if (provider === 'google') return 'Gmail';
  if (provider === 'microsoft-entra-id') return 'Outlook';
  return 'your mail app';
}

/** True when the compose link is a web page worth a new tab; a mailto link hands off to the mail app and must not leave a blank tab behind. */
export function composeOpensInBrowser(provider?: string | null): boolean {
  return provider === 'google' || provider === 'microsoft-entra-id';
}

export function composeUrl(provider: string | null | undefined, to: string, subject: string, body: string): string {
  const q = encodeURIComponent;
  if (provider === 'google') {
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${q(to)}&su=${q(subject)}&body=${q(body)}`;
  }
  if (provider === 'microsoft-entra-id') {
    return `https://outlook.office.com/mail/deeplink/compose?to=${q(to)}&subject=${q(subject)}&body=${q(body)}`;
  }
  return `mailto:${to}?subject=${q(subject)}&body=${q(body)}`;
}
