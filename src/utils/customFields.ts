import { Contact, CustomField } from '@/types';

/**
 * Custom table columns are addressed by a `custom_`-prefixed key derived
 * from the column label. The same string is stored as the field's id on
 * each contact's customFields entry, so the column list, cell renders,
 * sorting, and cell edits all resolve the same entry. These helpers are
 * the single place that knows that convention.
 */
export type CustomColumnKey = `custom_${string}`;

/** Canonical column key for a label ("Deal Stage" -> "custom_deal_stage"). */
export const customKeyForLabel = (label: string): CustomColumnKey =>
  `custom_${label.toLowerCase().replace(/\s+/g, '_')}`;

/**
 * Canonical key for a stored field: trust its id when it already follows
 * the convention, else fall back to the label (fields from older data or
 * CSV imports may carry foreign ids).
 */
export const customFieldKey = (field: Pick<CustomField, 'id' | 'label'>): CustomColumnKey =>
  field.id?.startsWith('custom_') ? (field.id as CustomColumnKey) : customKeyForLabel(field.label);

export const isCustomColumnKey = (field: string): field is CustomColumnKey =>
  field.startsWith('custom_');

/** Read a cell value; custom columns live in customFields, not top-level props. */
export function getContactFieldValue(contact: Contact, field: string): unknown {
  if (isCustomColumnKey(field)) {
    return contact.customFields?.find(f => customFieldKey(f) === field)?.value ?? '';
  }
  return contact[field as keyof Contact];
}

/**
 * Copy of the contact with the field set. Custom columns upsert the
 * matching customFields entry instead of writing a top-level property.
 */
export function withContactFieldValue(
  contact: Contact,
  field: string,
  value: string,
  label?: string
): Contact {
  if (!isCustomColumnKey(field)) {
    return { ...contact, [field]: value };
  }
  const fields = contact.customFields ?? [];
  const exists = fields.some(f => customFieldKey(f) === field);
  if (exists) {
    return {
      ...contact,
      customFields: fields.map(f => (customFieldKey(f) === field ? { ...f, value } : f)),
    };
  }
  // Don't materialize an entry for an empty value: the table saves cells on
  // blur even when untouched, and that shouldn't grow every contact's fields.
  if (value === '') {
    return contact;
  }
  return {
    ...contact,
    customFields: [
      ...fields,
      { id: field, label: label ?? field.slice('custom_'.length).replace(/_/g, ' '), value },
    ],
  };
}
