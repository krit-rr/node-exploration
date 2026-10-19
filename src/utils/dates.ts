import { format, isValid, parseISO } from 'date-fns';

/**
 * Format a date value that may be missing or unparseable (CSV imports and
 * inline edits can write arbitrary strings into date fields). Never throws.
 */
export function safeFormatDate(
  value: string | undefined | null,
  dateFormat = 'MMM d, yyyy',
  fallback = '-'
): string {
  if (!value) return fallback;
  try {
    const parsed = parseISO(value);
    const date = isValid(parsed) ? parsed : new Date(value);
    return isValid(date) ? format(date, dateFormat) : fallback;
  } catch {
    return fallback;
  }
}

/** Value for a <input type="date">: local yyyy-MM-dd, or '' when invalid. */
export function toDateInputValue(value: string | undefined | null): string {
  if (!value) return '';
  try {
    const date = new Date(value);
    return isValid(date) ? format(date, 'yyyy-MM-dd') : '';
  } catch {
    return '';
  }
}
