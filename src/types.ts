export interface Contact {
  id: string;
  name: string;
  email: string;
  lastContacted: string;
  lastContactedRaw?: string; // For sorting
  company?: string;
  industry?: string;
  relationshipStrength?: {
    score: number;
    trend: 'rising' | 'stable' | 'falling';
  };
  interactions?: {
    date: string;
    channel: 'email' | 'message' | 'call' | 'meeting' | 'other';
    type: 'sent' | 'received';
    participants?: string[];
    subject?: string;
    snippet?: string;
  }[];
  sentDates?: string[];
  velocity?: {
    score: number;
    trend: 'rising' | 'stable' | 'falling';
    interactionMetrics: {
      last30Days: number;
      last90Days: number;
      responseRate: number;
      averageResponseTime: number;
    };
  };
  customFields?: CustomField[];
  tags?: string[];
  notes?: string;
  provider?: 'google' | 'microsoft-entra-id';
  isSpam?: boolean;
  metAt?: string;
  introducedBy?: string;
  /** Other addresses this person was merged under (duplicate merge). */
  altEmails?: string[];
  snoozedUntil?: string;
  /** When Node first stored the row; the reconnect queue falls back to it when no touch is recorded. */
  createdAt?: string;
  /** Where the user wants this person on the orbit map: 1 (closest five) to 4 (the 150). Unset means wherever activity puts them. */
  intendedLayer?: number;
  /** What Node has read out of the mail about this person; see ContactMemory. */
  memory?: ContactMemory;
  /** Name rehearsal schedule; see RehearsalEntry. */
  rehearsal?: RehearsalEntry;
  enrichedBy?: 'ai';
}

/** A promise that looked unresolved as of the newest message. */
export interface OpenLoop {
  /** What is owed, as a short verb phrase without a subject: "send the deck by Friday". */
  text: string;
  /** Who owes it. */
  who: 'you' | 'them';
  /** The date (YYYY-MM-DD) of the message it was read from. */
  date: string;
}

/** The notes nobody keeps, read out of stored subjects and previews by the model. */
export interface ContactMemory {
  /** At most two short sentences: what this is about, what changed lately. */
  summary: string;
  openLoops: OpenLoop[];
  /** Hash of the interactions it was read from; unchanged history never costs another model call. */
  sourceHash: string;
  updatedAt: string;
}

/** Where a contact's name card sits in the rehearsal schedule. */
export interface RehearsalEntry {
  /** ISO time the card is due again. */
  due: string;
  /** Index into the expanding intervals reached by successive recalls. */
  step: number;
  reps: number;
  lastResult?: 'got' | 'missed';
}

export type Group = {
  id: string;
  name: string;
  members: Set<string>;
};

export interface CustomField {
  id: string;
  label: string;
  value: string;
}