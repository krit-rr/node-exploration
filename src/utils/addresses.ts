/** Automated and no-reply style senders: never a relationship. One list, shared by every feature. */
export const AUTOMATED_ADDRESS = /^(no-?reply|noreply|do-?not-?reply|newsletter|notifications?|marketing|updates|info|support|hello)@/i;

export function isAutomatedAddress(email: string): boolean {
  return AUTOMATED_ADDRESS.test(email);
}
