/** The digest subject line for a going-cold count; the email and the settings card use the same words. */
export function digestSubject(count: number): string {
  return count === 0
    ? 'Nobody is going cold this week'
    : `Going cold this week: ${count} ${count === 1 ? 'person' : 'people'}`;
}
