'use client';

import AppLayout from '@/components/Layout/AppLayout';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from "next-auth/react";
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { format, isValid } from "date-fns";
import GroupModal from "@/components/GroupModal";
import { Contact } from '@/types';
import ContactTable from "@/components/ContactTable";
import ContactDetail from "@/components/ContactDetail";
import ColumnCustomizer from "@/components/ColumnCustomizer";
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import OnboardingPrompt from '@/components/OnboardingPrompt';
import InboxCleanupAssistant from '@/components/insights/InboxCleanupAssistant';
import GroupExportModal from '@/components/GroupExportModal';
import ImportModal from '@/components/ImportModal';
import { toast } from 'react-hot-toast';
import FilterChip from '@/components/ui/filters/FilterChip';
import { IconName } from '@/components/ui/icons/Icon';
import React from 'react';
import DomainStats from '@/components/DomainStats';
import { useContacts, syncContacts, getContactsStorageKey, persistContacts, type ContactsData } from '@/hooks/useContacts';
import ReconnectRail from '@/components/ReconnectRail';
import QuickAddModal from '@/components/QuickAddModal';
import TriageModal from '@/components/TriageModal';
import MergeModal from '@/components/MergeModal';
import { findDuplicatePairs, makePair, pairKey, type DuplicatePair } from '@/utils/duplicates';
import { getCurrentEvent, setCurrentEvent, clearCurrentEvent, type CurrentEvent } from '@/utils/currentEvent';
import { customKeyForLabel, customFieldKey } from '@/utils/customFields';
import { useSemanticSearch } from '@/hooks/useSemanticSearch';
import { Suspense } from 'react';

// Add a custom useDebounce hook after the imports and before the component code
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Helper function to get user-specific group storage key
const getGroupsStorageKey = (userEmail: string | null | undefined): string => {
  if (!userEmail) {
    throw new Error('User email is required for group storage key');
  }
  return `contact-groups_${userEmail}`;
};

// Custom column definitions persist per user (like groups), so a freshly
// added column survives reload even before any contact carries a value.
type StoredCustomColumn = { key: CustomColumnKey; label: string };

const getCustomColumnsStorageKey = (userEmail: string): string =>
  `custom-columns_${userEmail}`;

type FilterType = 'all' | 'intros' | `group-${string}` | `tag-${string}` | `event-${string}`;

type SortConfig = {
  key: keyof Contact | CustomColumnKey | null;
  direction: 'asc' | 'desc';
};

type CustomColumnKey = `custom_${string}`;
type ColumnKey = keyof Contact | 'relationshipStrength' | CustomColumnKey;

type Column = {
  key: ColumnKey;
  label: string;
  description: string;
  render: (contact: Contact) => React.ReactNode;
};

interface CustomField {
  id: string;
  label: string;
  value: string;
}

// Add this interface before using Contact
interface ContactWithSpam extends Contact {
  isSpam?: boolean;
}



// Define types for filter items
type BaseFilterItem = {
  id: string;
  label: string;
  isGroup: boolean;
}

type QuickFilterItem = BaseFilterItem & {
  icon: IconName;
  isGroup: false;
}

type GroupFilterItem = BaseFilterItem & {
  isGroup: true;
  groupData: {id: string, name: string, members: string[]};
}

type FilterItem = QuickFilterItem | GroupFilterItem;

/**
 * Custom hook to handle groups persistence and filter state
 */
function useGroupsPersistence(userEmail: string | null | undefined) {
  const [groups, setGroupsState] = useState<Array<{id: string, name: string, members: string[]}>>([]);
  const [activeFilter, setActiveFilterState] = useState<FilterType>('all');
  const [loadedGroups, setLoadedGroups] = useState(false);
  
  // Load groups: server first (so they follow the account across devices),
  // localStorage as the offline/unprovisioned fallback. ALWAYS sets state , 
  // on an account switch that reset is what stops the previous user's
  // groups being re-persisted under the new user's key.
  const loadData = useCallback(async () => {
    if (!userEmail) return;
    const groupsKey = getGroupsStorageKey(userEmail);
    const readLocal = (): Array<{id: string, name: string, members: string[]}> => {
      try {
        const raw = localStorage.getItem(groupsKey);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    try {
      const response = await fetch('/api/groups');
      if (response.ok) {
        const data = await response.json();
        if (data.persisted) {
          let serverGroups: Array<{id: string, name: string, members: string[]}> = data.groups ?? [];
          const local = readLocal();
          if (serverGroups.length === 0 && local.length > 0) {
            // One-time migration: groups created before the server store
            serverGroups = local;
            fetch('/api/groups', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ groups: local }),
            }).catch(() => {});
          }
          try { localStorage.setItem(groupsKey, JSON.stringify(serverGroups)); } catch {}
          setGroupsState(serverGroups);
          setLoadedGroups(true);
          return;
        }
      }
    } catch {
      // offline: fall through to the local cache
    }

    setGroupsState(readLocal());
    setLoadedGroups(true);
  }, [userEmail]);
  
  // Save groups: optimistic local update + localStorage cache, then the
  // server replace-set. A failed sync keeps the local copy and says so.
  const saveGroups = useCallback((updatedGroups: Array<{id: string, name: string, members: string[]}>) => {
    if (!userEmail) return;

    setGroupsState(updatedGroups);
    setLoadedGroups(true);
    try {
      localStorage.setItem(getGroupsStorageKey(userEmail), JSON.stringify(updatedGroups));
    } catch (error) {
      console.error('Error caching groups:', error);
    }

    fetch('/api/groups', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: updatedGroups }),
    })
      .then(response => { if (!response.ok) throw new Error(String(response.status)); })
      .catch(() => {
        toast.error('Groups saved on this device; server sync failed', {
          duration: 3000,
          position: 'bottom-right',
        });
      });
  }, [userEmail]);
  
  // Initial load on mount or when user email changes
  useEffect(() => {
    loadData();
  }, [loadData, userEmail]);

  return {
    groups,
    setGroups: saveGroups,
    filter: activeFilter,
    // Deliberately not persisted: the ?group= URL param is the shareable,
    // durable form of the filter. (A `contact-filter_<email>` localStorage
    // copy used to be written here but was never read back; clientSignOut
    // still clears that key for users who have it from older builds.)
    setFilter: setActiveFilterState,
    reloadData: loadData,
    loadedGroups
  };
}

function ContactsContent() {
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const userEmail = session?.user?.email;
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Get group ID from URL if present
  const groupIdFromUrl = searchParams.get('group');
  
  const [search, setSearch] = useState('');
  const [inputSearch, setInputSearch] = useState('');
  const debouncedSearch = useDebounce(inputSearch, 200);
  
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // Event mode: device-local current event for capture defaults and triage.
  const [currentEvent, setCurrentEventState] = useState<CurrentEvent | null>(null);
  const [settingEvent, setSettingEvent] = useState(false);
  const [eventDraft, setEventDraft] = useState('');
  const [showTriage, setShowTriage] = useState(false);

  // Duplicate merge: review pairs the detector found, or two hand-picked rows.
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [manualPair, setManualPair] = useState<DuplicatePair | null>(null);
  const [dismissedPairs, setDismissedPairs] = useState<Set<string>>(new Set());

  // "Not the same person" decisions persist per account (device-local cache,
  // like other UI conveniences; the merge itself lives in the store).
  useEffect(() => {
    if (!userEmail) return;
    try {
      const raw = localStorage.getItem(`mergeDismissed_${userEmail}`);
      if (raw) {
        const keys = JSON.parse(raw);
        if (Array.isArray(keys)) {
          setDismissedPairs(new Set(keys.filter((k: unknown): k is string => typeof k === 'string')));
        }
      }
    } catch {
      // Cache only; detection just re-suggests dismissed pairs.
    }
  }, [userEmail]);

  // Read after mount: localStorage is not available during SSR.
  useEffect(() => {
    setCurrentEventState(getCurrentEvent());
  }, []);

  const startEventMode = () => {
    const event = setCurrentEvent(eventDraft);
    if (!event) return;
    setCurrentEventState(event);
    setSettingEvent(false);
    setEventDraft('');
    toast.success(`Event mode on: ${event.name}`);
  };

  const endEventMode = () => {
    clearCurrentEvent();
    setCurrentEventState(null);
  };
  
  // Use the custom hook for groups and filter persistence
  const { groups, setGroups, filter, setFilter, reloadData, loadedGroups } = useGroupsPersistence(userEmail);

  // Saved views: named filter combinations, server-synced like groups with
  // a localStorage fallback until the views migration is applied.
  type SavedView = { id: string; name: string; config: { search?: string; filter?: string; sortKey?: string; sortDirection?: 'asc' | 'desc' } };
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const viewsKey = userEmail ? `views_${userEmail}` : '';
  useEffect(() => {
    if (!userEmail) return;
    const readLocal = (): SavedView[] => {
      try {
        const raw = localStorage.getItem(viewsKey);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    };
    fetch('/api/views')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.persisted) {
          setSavedViews(Array.isArray(data.views) ? data.views : []);
          try { localStorage.setItem(viewsKey, JSON.stringify(data.views ?? [])); } catch {}
        } else {
          setSavedViews(readLocal());
        }
      })
      .catch(() => setSavedViews(readLocal()));
  }, [userEmail, viewsKey]);

  const persistViews = useCallback((views: SavedView[]) => {
    setSavedViews(views);
    try { localStorage.setItem(viewsKey, JSON.stringify(views)); } catch {}
    fetch('/api/views', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ views }),
    }).catch(() => {});
  }, [viewsKey]);

  const [savingView, setSavingView] = useState(false);
  const [viewNameDraft, setViewNameDraft] = useState('');
  
  // Update filter when URL changes (separate from the next useEffect to avoid race conditions)
  useEffect(() => {
    if (groupIdFromUrl && loadedGroups) {
      // Check if the group exists in the loaded groups
      const groupExists = groups.some(g => g.id === groupIdFromUrl);
      if (groupExists) {
        console.log('Setting filter from URL param:', `group-${groupIdFromUrl}`);
        setFilter(`group-${groupIdFromUrl}` as FilterType);
      }
    }
  }, [groupIdFromUrl, groups, loadedGroups, setFilter]);
  
  // Sync filter state to URL when filter changes (keep this separate).
  // Gated on loadedGroups: until groups load, `filter` is still the 'all'
  // default, and the else-branch would strip a ?group= deep link from the
  // URL before the restore effect above has had a chance to apply it.
  useEffect(() => {
    if (!loadedGroups) return;
    if (filter && filter !== 'all' && filter.startsWith('group-')) {
      const groupId = filter.replace('group-', '');
      // Only update URL if it's different to avoid unnecessary history entries
      if (groupIdFromUrl !== groupId) {
        const newParams = new URLSearchParams(searchParams);
        newParams.set('group', groupId);
        console.log('Updating URL with group param:', groupId);
        router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
      }
    } else if (groupIdFromUrl) {
      // Remove group param if filter is not a group
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('group');
      console.log('Removing group param from URL');
      router.replace(pathname, { scroll: false });
    }
  }, [filter, pathname, router, searchParams, groupIdFromUrl, loadedGroups]);
  
  // Force reload data when the component becomes visible
  useEffect(() => {
    // This will run when the component mounts or becomes visible
    reloadData();
    
    // Set up visibility change event listener
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('Page became visible, reloading data');
        reloadData();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reloadData]);
  
  // Current group based on filter (keep this separate from storage logic)
  const currentGroup = useMemo(() => {
    if (filter.startsWith('group-')) {
      const groupId = filter.replace('group-', '');
      return groups.find(g => g.id === groupId);
    }
    return null;
  }, [filter, groups]);

  const [showGroupExportModal, setShowGroupExportModal] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>({ 
    key: 'lastContacted', 
    direction: 'desc' 
  });
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [editingGroup, setEditingGroup] = useState<{id: string, name: string, members: string[]} | null>(null);
  const [activeColumns, setActiveColumns] = useState<ColumnKey[]>([
    'name',
    'email',
    'company',
    'tags',
    'lastContacted'
  ]);
  const [availableColumnsList, setAvailableColumnsList] = useState<Column[]>([]);
  const [customColumnDefs, setCustomColumnDefs] = useState<StoredCustomColumn[]>([]);
  const [loadedCustomColumns, setLoadedCustomColumns] = useState(false);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showCleanupAssistant, setShowCleanupAssistant] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // Add state to track if domain filter mode is active
  const [isDomainFilterMode, setIsDomainFilterMode] = useState(false);

  // Add state for selected domain in domain stats
  const [selectedDomain, setSelectedDomain] = useState<string | undefined>(undefined);

  // Clear storage if the user changes
  useEffect(() => {
    if (!session?.user?.email) {
      // User logged out - don't clear localStorage, just reset the state
      setGroups([]);
    } else {
      // When user changes, ensure we're using the correct data for the current user
      const currentUserEmail = session.user.email;
      
      // Force a refresh of the data
      queryClient.invalidateQueries({ 
        queryKey: ['sentRecipients', currentUserEmail],
        refetchType: 'active'
      });
    }
  }, [session?.user?.email, setGroups, queryClient]);



  const { data: contactsData = { contacts: [], lastUpdated: new Date().toISOString() }, isLoading, error } = useContacts();

  // Extract contacts from the data object
  const contacts = contactsData.contacts;

  const duplicatePairs = useMemo(
    () =>
      findDuplicatePairs(contacts).filter(
        (pair) => !dismissedPairs.has(pairKey(pair.primary, pair.duplicate))
      ),
    [contacts, dismissedPairs]
  );

  // Keep server-side embeddings fresh so semantic search has data to match
  // against. The sync endpoint hashes content and skips unchanged contacts,
  // so a repeat sync costs no embedding calls. Fire-and-forget: search just
  // degrades to keyword-only if it fails.
  const lastSyncKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.user?.email || contacts.length === 0) return;
    const syncKey = `${session.user.email}:${contactsData.lastUpdated}`;
    if (lastSyncKeyRef.current === syncKey) return;
    lastSyncKeyRef.current = syncKey;
    fetch('/api/embeddings/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts }),
    }).catch(() => {});
  }, [session?.user?.email, contacts, contactsData.lastUpdated]);

  // Fire out-of-band enrichment for stored contacts missing a company, then
  // refetch so the new company/industry values appear. Guarded so one page
  // load triggers at most one run.
  const enrichTriggeredRef = useRef(false);
  const triggerEnrichment = useCallback(() => {
    if (enrichTriggeredRef.current || !session?.user?.email) return;
    enrichTriggeredRef.current = true;
    fetch('/api/contacts/enrich', { method: 'POST' })
      .then(res => res.ok ? res.json() : null)
      .then(result => {
        if (result && result.enriched > 0) {
          queryClient.invalidateQueries({
            queryKey: ['sentRecipients', session.user?.email],
            refetchType: 'active'
          });
        }
      })
      .catch(() => {});
  }, [queryClient, session?.user?.email]);

  useEffect(() => {
    if (contacts.length === 0) return;
    if (contacts.some(c => !c.company)) triggerEnrichment();
  }, [contacts, triggerEnrichment]);

  // Force refresh = re-pull from the mail provider and merge into the
  // server store. Edits and imports survive: this no longer destroys data.
  const forceRefresh = useCallback(async () => {
    if (!session?.user?.email) return;
    const email = session.user.email;

    toast.success('Syncing with your mailbox...', {
      duration: 2000,
      position: 'bottom-right',
      style: { backgroundColor: '#F4F4FF', color: '#1E1E3F' }
    });
    try {
      const data = await syncContacts(email);
      queryClient.setQueryData(['sentRecipients', email], data);
      enrichTriggeredRef.current = false;
      triggerEnrichment();
    } catch (error) {
      console.error('Mailbox sync failed:', error);
      toast.error('Sync failed. Please try again.');
    }
  }, [queryClient, session?.user?.email, triggerEnrichment]);

  // Cleanup-assistant visibility: one user-scoped sessionStorage record
  // ({ shownAt, dismissedAt }) replaces the four overlapping localStorage
  // booleans that used to choreograph this (one of which could latch the
  // assistant off permanently, and one of which was never written).
  useEffect(() => {
    if (!session?.user?.email || isLoading || contacts.length === 0) return;
    try {
      const key = `cleanup-state_${session.user.email}`;
      const state = JSON.parse(sessionStorage.getItem(key) ?? '{}');
      if (!state.shownAt && !state.dismissedAt) {
        setShowCleanupAssistant(true);
        sessionStorage.setItem(key, JSON.stringify({ ...state, shownAt: new Date().toISOString() }));
      }
    } catch {
      // sessionStorage unavailable: just don't auto-open the assistant
    }
  }, [session?.user?.email, isLoading, contacts.length]);

  // Refresh = refetch from the server store (cheap; no mailbox pull)
  const refreshContacts = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['sentRecipients', session?.user?.email],
      refetchType: 'active'
    });
    toast.success('Refreshing contacts...', {
      duration: 2000,
      position: 'bottom-right',
      style: { backgroundColor: '#F4F4FF', color: '#1E1E3F' }
    });
  }, [queryClient, session?.user?.email]);



  // For development/testing - simulate a new session without clearing permanent preferences
  const resetSessionOnly = useCallback(() => {
    if (session?.user?.email) {
      sessionStorage.removeItem(`cleanup-state_${session.user.email}`);

      // Show cleanup assistant immediately
      setShowCleanupAssistant(true);
      
      toast.success('Cleanup assistant showing (simulating first visit)', { 
        duration: 2000,
        style: { background: '#F4F4FF', color: '#1E1E3F' }
      });
    }
  }, [session?.user?.email]);

  // Filter out spam contacts for display
  const displayContacts = useMemo(
    () => contacts?.filter((contact: Contact) => !(contact as ContactWithSpam).isSpam) || [],
    [contacts]
  );

  // Priority contacts: anyone tagged, plus every member of any group.
  const priorityEmails = useMemo(() => {
    const emails = new Set<string>();
    for (const c of displayContacts) {
      if (c.tags && c.tags.length > 0) emails.add(c.email.toLowerCase());
    }
    for (const group of groups) {
      for (const member of group.members) emails.add(member.toLowerCase());
    }
    return emails;
  }, [displayContacts, groups]);

  // Every tag in use, most common first, capped so the chip row stays sane.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of displayContacts) {
      for (const tag of c.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);
  }, [displayContacts]);

  // Events worth a chip: met-at values shared by 2+ contacts. One-off met-at
  // entries ("coffee with Sam") stay reachable through search instead.
  const allEvents = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of displayContacts) {
      const met = c.metAt?.trim();
      if (met) counts.set(met, (counts.get(met) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [displayContacts]);

  // The roster behind the active event filter, for post-event triage.
  const triageContacts = useMemo(() => {
    if (!filter.startsWith('event-')) return [];
    const eventName = filter.replace('event-', '');
    return displayContacts.filter(c => (c.metAt?.trim() ?? '') === eventName);
  }, [filter, displayContacts]);

  // Parse each contact's lastContacted once, not twice per sort comparison.
  const visibleColumns = useMemo(
    () => availableColumnsList.filter(col => activeColumns.includes(col.key)),
    [availableColumnsList, activeColumns]
  );

  const lastContactedTimes = useMemo(() => {
    const times = new Map<string, number>();
    for (const c of displayContacts) {
      const t = c.lastContacted ? new Date(c.lastContacted).getTime() : NaN;
      times.set(c.email, isNaN(t) ? 0 : t);
    }
    return times;
  }, [displayContacts]);

  // Custom columns come from two sources keyed identically: fields present
  // on any contact (server data) and the persisted per-user definitions
  // (columns added before any value was saved). Definition labels win.
  const mergedCustomDefs = useMemo(() => {
    const defs = new Map<CustomColumnKey, string>();
    for (const contact of contacts ?? []) {
      for (const field of contact.customFields ?? []) {
        const key = customFieldKey(field);
        if (!defs.has(key)) defs.set(key, field.label);
      }
    }
    for (const def of customColumnDefs) defs.set(def.key, def.label);
    return defs;
  }, [contacts, customColumnDefs]);

  const availableColumns = useMemo(() => [
    {
      key: 'name' as ColumnKey,
      label: 'Name',
      description: 'Contact\'s full name',
      render: (contact: Contact) => (
        <button
          onClick={() => setSelectedContact(contact)}
          className="text-left font-medium text-[#1E1E3F] hover:underline underline-offset-2"
          aria-label={`Open details for ${contact.name}`}
        >
          {contact.name}
        </button>
      )
    },
    {
      key: 'email' as ColumnKey,
      label: 'Email',
      description: 'Primary email address',
      render: (contact: Contact) => contact.email
    },
    {
      key: 'company' as ColumnKey,
      label: 'Company',
      description: 'Organization or company name',
      render: (contact: Contact) => contact.company || '-'
    },
    {
      key: 'industry' as ColumnKey,
      label: 'Industry',
      description: 'Industry or sector',
      render: (contact: Contact) => contact.industry || '-'
    },
    {
      key: 'tags' as ColumnKey,
      label: 'Tags',
      description: 'Labels you have put on this contact',
      render: (contact: Contact) => (
        <div className="flex flex-wrap gap-1">
          {(contact.tags ?? []).map(tag => (
            <span key={tag} className="px-2 py-0.5 text-xs rounded-md bg-[#F4F4FF] text-[#1E1E3F]">{tag}</span>
          ))}
        </div>
      )
    },
    {
      key: 'metAt' as ColumnKey,
      label: 'Met At',
      description: 'Where you met this contact',
      render: (contact: Contact) => contact.metAt || '-'
    },
    {
      key: 'introducedBy' as ColumnKey,
      label: 'Introduced By',
      description: 'Who connected you with this contact',
      render: (contact: Contact) => contact.introducedBy || '-'
    },
    {
      key: 'lastContacted' as ColumnKey,
      label: 'Last Emailed',
      description: 'Most recent email sent',
      render: (contact: Contact) => {
        if (!contact.lastContacted) return '-';
        try {
          // Parse the date string which is in RFC 2822 format
          const dateStr = contact.lastContacted;
          // Handle different date formats
          let date: Date;
          if (dateStr.includes(',')) {
            // RFC 2822 format (e.g., "Thu, 1 May 2025 10:16:18 +0000")
            date = new Date(dateStr);
          } else {
            // ISO format
            date = new Date(dateStr);
          }
          
          if (!isValid(date)) {
            console.warn('Invalid date for contact:', contact.email, dateStr);
            return '-';
          }
          
          return format(date, 'MMM d, yyyy');
        } catch (error) {
          console.error('Error formatting date for contact:', contact.email, error);
          return '-';
        }
      }
    },
    ...Array.from(mergedCustomDefs, ([key, label]) => ({
      key: key as ColumnKey,
      label,
      description: `Custom field: ${label}`,
      render: (contact: Contact) => {
        const customField = contact.customFields?.find(f => customFieldKey(f) === key);
        return customField?.value || '-';
      }
    }))
  ], [mergedCustomDefs]);

  // Replace this useEffect with direct assignment
  useEffect(() => {
    // Only update if availableColumnsList isn't already set or if columns have changed
    const columnsChanged = JSON.stringify(availableColumnsList) !== JSON.stringify(availableColumns);
    if (availableColumnsList.length === 0 || columnsChanged) {
      setAvailableColumnsList(availableColumns);
    }
  }, [availableColumns, availableColumnsList]);

  // Save groups to localStorage whenever they change
  useEffect(() => {
    if (session?.user?.email) {
      const groupsKey = getGroupsStorageKey(session.user.email);
      localStorage.setItem(groupsKey, JSON.stringify(groups));
    }
  }, [groups, session?.user?.email]);

  // Load persisted custom column definitions for this user. Always set
  // state (empty included) so an account switch can't leak the previous
  // user's columns.
  useEffect(() => {
    if (!session?.user?.email) return;
    try {
      const raw = localStorage.getItem(getCustomColumnsStorageKey(session.user.email));
      const parsed = raw ? JSON.parse(raw) : [];
      setCustomColumnDefs(
        Array.isArray(parsed)
          ? parsed.filter((def): def is StoredCustomColumn =>
              !!def && typeof def.key === 'string' && def.key.startsWith('custom_') &&
              typeof def.label === 'string')
          : []
      );
    } catch (error) {
      console.error('Error loading custom columns:', error);
      setCustomColumnDefs([]);
    }
    setLoadedCustomColumns(true);
  }, [session?.user?.email]);

  // Save custom column definitions whenever they change: only after the
  // initial load, so the empty first render can't wipe the stored list.
  useEffect(() => {
    if (!session?.user?.email || !loadedCustomColumns) return;
    try {
      localStorage.setItem(
        getCustomColumnsStorageKey(session.user.email),
        JSON.stringify(customColumnDefs)
      );
    } catch (error) {
      console.error('Error saving custom columns:', error);
    }
  }, [customColumnDefs, loadedCustomColumns, session?.user?.email]);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Add utility functions for smart domain filtering
  const extractDomain = useCallback((email: string): string => {
    const parts = email.split('@');
    return parts.length > 1 ? parts[1].toLowerCase() : '';
  }, []);

  const isDomainSearch = (term: string): boolean => {
    // Checks if a search term appears to be a domain or partial domain
    // Examples: "amazon", "gmail", "amazon.com", etc.
    return !term.includes('@') && !term.includes(' ') && (
      term.includes('.') || 
      ['gmail', 'yahoo', 'hotmail', 'outlook', 'amazon', 'apple', 'google', 'facebook', 
       'microsoft', 'aol', 'proton', 'icloud', 'me', 'live', 'msn', 'zoho'].includes(term.toLowerCase())
    );
  };

  const domainMatches = (email: string, domainTerm: string): boolean => {
    const domain = extractDomain(email);
    const searchTerm = domainTerm.toLowerCase();

    // Check for exact matches
    if (domain === searchTerm) return true;
    
    // Handle common variations
    if (searchTerm === 'gmail' && domain === 'gmail.com') return true;
    if (searchTerm === 'yahoo' && (domain === 'yahoo.com' || domain === 'yahoo.co.uk')) return true;
    if (searchTerm === 'hotmail' && (domain === 'hotmail.com' || domain === 'hotmail.co.uk')) return true;
    if (searchTerm === 'outlook' && domain === 'outlook.com') return true;
    if (searchTerm === 'icloud' && domain === 'icloud.com') return true;
    if (searchTerm === 'me' && domain === 'me.com') return true;
    if (searchTerm === 'live' && domain === 'live.com') return true;
    if (searchTerm === 'msn' && domain === 'msn.com') return true;
    
    // Handle partial domain matches (e.g., "amazon" matches "amazon.com", "amazon.co.uk", etc.)
    if (domain.startsWith(searchTerm + '.')) return true;
    
    // Special case for domain search with TLD
    if (searchTerm.includes('.')) {
      // Allow subdomain matches, e.g., "mail.google.com" when searching for "google.com"
      const searchParts = searchTerm.split('.');
      const domainParts = domain.split('.');
      
      // If the domain term has fewer parts than the full domain
      if (searchParts.length < domainParts.length) {
        // Extract the last N parts of the domain where N is the length of the search term parts
        const relevantDomainParts = domainParts.slice(-searchParts.length);
        return relevantDomainParts.join('.') === searchTerm;
      }
    }
    
    return false;
  };

  // Add function to group contacts by domain
  const groupContactsByDomain = useCallback((contacts: Contact[]) => {
    // Create a map to group contacts by domain
    const domainGroups = new Map<string, Contact[]>();
    
    contacts.forEach(contact => {
      const domain = extractDomain(contact.email);
      if (!domainGroups.has(domain)) {
        domainGroups.set(domain, []);
      }
      domainGroups.get(domain)!.push(contact);
    });
    
    // Convert map to array of [domain, contacts] pairs and sort by domain
    return Array.from(domainGroups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [extractDomain]);

  // Modified getFilteredContacts to handle domain grouping
  const getFilteredContacts = useCallback((searchTerm: string, activeFilter: FilterType) => {
    let filteredResults = [...displayContacts];
    
    // Apply search filter
    if (searchTerm) {
      const searchTerms = searchTerm.toLowerCase().split(' ');
      
      filteredResults = filteredResults.filter(contact => 
        searchTerms.every(term => {
          // Check for domain-like search term
          if (isDomainSearch(term)) {
            return domainMatches(contact.email, term);
          }
          
          // Regular search criteria
          return (
            contact.name.toLowerCase().includes(term) ||
            contact.email.toLowerCase().includes(term) ||
            (contact.company && contact.company.toLowerCase().includes(term)) ||
            (contact.tags && contact.tags.some(tag => tag.toLowerCase().includes(term))) ||
            (contact.metAt && contact.metAt.toLowerCase().includes(term)) ||
            (contact.introducedBy && contact.introducedBy.toLowerCase().includes(term)) ||
            contact.customFields?.some((field: CustomField) => 
              field.value.toLowerCase().includes(term)
            )
          );
        })
      );
    }
    
    // Apply group filter
    if (activeFilter.startsWith('group-')) {
      const groupId = activeFilter.replace('group-', '');
      const group = groups.find(g => g.id === groupId);
      filteredResults = filteredResults.filter(contact => 
        group?.members.includes(contact.email) ?? false
      );
    }

    // Apply tag filter
    if (activeFilter.startsWith('tag-')) {
      const tagName = activeFilter.replace('tag-', '');
      filteredResults = filteredResults.filter(contact =>
        contact.tags?.includes(tagName) ?? false
      );
    }

    // Apply intros lens: contacts someone connected you with
    if (activeFilter === 'intros') {
      filteredResults = filteredResults.filter(contact => Boolean(contact.introducedBy));
    }

    // Apply event lens: everyone met at the same place
    if (activeFilter.startsWith('event-')) {
      const eventName = activeFilter.replace('event-', '');
      filteredResults = filteredResults.filter(contact => (contact.metAt?.trim() ?? '') === eventName);
    }

    // Apply sorting
    if (sortConfig.key) {
      filteredResults.sort((a, b) => {
        // Handle custom field sorting
        if (typeof sortConfig.key === 'string' && sortConfig.key.startsWith('custom_')) {
          const aCustomField = a.customFields?.find((f: CustomField) =>
            customFieldKey(f) === sortConfig.key
          );
          const bCustomField = b.customFields?.find((f: CustomField) =>
            customFieldKey(f) === sortConfig.key
          );
          
          const aValue = aCustomField?.value || '';
          const bValue = bCustomField?.value || '';
          
          // Try to sort numerically if both values are numbers
          const aNum = Number(aValue);
          const bNum = Number(bValue);
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
          }
          
          // Otherwise sort alphabetically
          return sortConfig.direction === 'asc'
            ? String(aValue).localeCompare(String(bValue))
            : String(bValue).localeCompare(String(aValue));
        }
        
        // Handle standard field sorting
        if (sortConfig.key && sortConfig.key in a) {
          const aValue = a[sortConfig.key as keyof Contact];
          const bValue = b[sortConfig.key as keyof Contact];
          
          if (sortConfig.key === 'lastContacted') {
            const aTime = lastContactedTimes.get(a.email) ?? 0;
            const bTime = lastContactedTimes.get(b.email) ?? 0;
            return sortConfig.direction === 'asc' ? aTime - bTime : bTime - aTime;
          }
          
          return sortConfig.direction === 'asc'
            ? String(aValue).localeCompare(String(bValue))
            : String(bValue).localeCompare(String(aValue));
        }
        
        return 0;
      });
    }
    
    return filteredResults;
  }, [displayContacts, groups, sortConfig, lastContactedTimes]);

  // Memoized: typing in the search box re-renders the page per keystroke,
  // and this used to re-filter and re-sort the full list every render.
  const keywordFilteredContacts = useMemo(
    () => getFilteredContacts(search, filter),
    [getFilteredContacts, search, filter]
  );

  // When the literal text filter finds nothing, fall back to semantic search
  // over the embedded contacts (e.g. "investors I met in healthcare").
  const semanticEnabled =
    !!search && keywordFilteredContacts.length === 0 && !isDomainSearch(search);
  const { matches: semanticMatches } = useSemanticSearch(search, semanticEnabled);

  let filteredContacts = keywordFilteredContacts;
  if (semanticEnabled && semanticMatches?.length) {
    const byEmail = new Map(contacts.map(c => [c.email.toLowerCase(), c]));
    filteredContacts = semanticMatches
      .map(m => byEmail.get(m.contact_email))
      .filter((c): c is Contact => !!c);
  }
  
  // Get domain-grouped contacts when in domain filter mode and domain search is active
  const domainGroupedContacts = useMemo(() => {
    if (isDomainFilterMode && search && isDomainSearch(search)) {
      return groupContactsByDomain(filteredContacts);
    }
    return null;
  }, [filteredContacts, isDomainFilterMode, search, groupContactsByDomain]);

  const handleSort = (key: keyof Contact | CustomColumnKey) => {
    setSortConfig(prevConfig => {
      const isSameKey = prevConfig.key === key;
      return {
        key,
        direction: isSameKey && prevConfig.direction === 'asc' ? 'desc' : 'asc'
      };
    });
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [search, filter]);

  // Activate each custom column once when it first appears. The seen-set
  // keeps this from re-adding a column the user has since unchecked.
  const seededCustomKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newKeys = Array.from(mergedCustomDefs.keys())
      .filter(key => !seededCustomKeys.current.has(key));
    if (newKeys.length === 0) return;
    newKeys.forEach(key => seededCustomKeys.current.add(key));
    setActiveColumns(prev => {
      const toAdd = (newKeys as ColumnKey[]).filter(key => !prev.includes(key));
      return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
    });
  }, [mergedCustomDefs]);

  const updateContactMutation = useMutation({
    // Addressed by the ORIGINAL email so an email edit updates the stored
    // row in place instead of forking a duplicate contact.
    mutationFn: async ({ contact, originalEmail }: { contact: Contact; originalEmail: string }) => {
      const response = await fetch(`/api/contacts/${encodeURIComponent(originalEmail)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contact),
      });
      if (!response.ok) {
        throw new Error('Failed to update contact');
      }
      return response.json();
    },
    onSuccess: (data: Contact & { persisted?: boolean }, variables) => {
      const { persisted: _persisted, ...savedContact } = data;
      queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
        const existing = oldData?.contacts ?? [];
        const found = existing.some(c => c.email === variables.originalEmail);
        const newContacts = found
          ? existing.map(contact => contact.email === variables.originalEmail ? (savedContact as Contact) : contact)
          : [...existing, savedContact as Contact];

        return session?.user?.email
          ? persistContacts(session.user.email, newContacts)
          : { contacts: newContacts, lastUpdated: new Date().toISOString() };
      });
    },
    onError: (error) => {
      console.error('Failed to update contact:', error);
      toast.error('Failed to save changes. Please try again.');
    },
  });

  // Merge one new/updated contact into cache + localStorage (quick-add, snooze)
  const mergeContactLocal = useCallback((incoming: Contact) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const found = existing.some(c => c.email === incoming.email);
      const merged = found
        ? existing.map(c => c.email === incoming.email ? { ...c, ...incoming } : c)
        : [incoming, ...existing];
      return session?.user?.email
        ? persistContacts(session.user.email, merged)
        : { contacts: merged, lastUpdated: new Date().toISOString() };
    });
  }, [queryClient, session?.user?.email]);

  const handleTouchLogged = useCallback((email: string, channel: 'email' | 'call' | 'meeting' | 'other') => {
    const now = new Date().toISOString();
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const merged = existing.map(c => c.email === email
        ? {
            ...c,
            lastContacted: now,
            interactions: [{ date: now, channel, type: 'sent' as const }, ...(c.interactions ?? [])],
          }
        : c);
      return session?.user?.email
        ? persistContacts(session.user.email, merged)
        : { contacts: merged, lastUpdated: now };
    });
    toast.success('Touch logged');
  }, [queryClient, session?.user?.email]);

  const handleBulkTag = useCallback((emails: string[], tag: string) => {
    const emailSet = new Set(emails);
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const merged = existing.map(c =>
        emailSet.has(c.email) && !(c.tags ?? []).includes(tag)
          ? { ...c, tags: [...(c.tags ?? []), tag] }
          : c
      );
      return session?.user?.email
        ? persistContacts(session.user.email, merged)
        : { contacts: merged, lastUpdated: new Date().toISOString() };
    });
    fetch('/api/contacts/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails, tag }),
    }).catch(() => {});
    toast.success(`Tagged ${emails.length} contact${emails.length === 1 ? '' : 's'} with ${tag}`);
  }, [queryClient, session?.user?.email]);

  const handleMergePairSelected = useCallback((emails: [string, string]) => {
    const first = contacts.find(c => c.email === emails[0]);
    const second = contacts.find(c => c.email === emails[1]);
    if (!first || !second) return;
    setManualPair(makePair(first, second));
    setShowMergeModal(true);
  }, [contacts]);

  const handleDismissPair = useCallback((pair: DuplicatePair) => {
    const key = pairKey(pair.primary, pair.duplicate);
    setDismissedPairs(prev => {
      const next = new Set(prev);
      next.add(key);
      if (userEmail) {
        try {
          localStorage.setItem(`mergeDismissed_${userEmail}`, JSON.stringify(Array.from(next)));
        } catch {
          // Cache only.
        }
      }
      return next;
    });
    setManualPair(prev => (prev && pairKey(prev.primary, prev.duplicate) === key ? null : prev));
  }, [userEmail]);

  const handleMerge = useCallback(async (primary: Contact, duplicate: Contact) => {
    let response: Response;
    try {
      response = await fetch('/api/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryEmail: primary.email, duplicateEmail: duplicate.email }),
      });
    } catch {
      toast.error('Failed to merge contacts');
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      toast.error(data.error || 'Failed to merge contacts');
      return;
    }
    const { persisted: _persisted, ...merged } = data as Contact & { persisted?: boolean };
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const next = existing
        .filter(c => c.email !== duplicate.email)
        .map(c => (c.email === primary.email ? (merged as Contact) : c));
      return session?.user?.email
        ? persistContacts(session.user.email, next)
        : { contacts: next, lastUpdated: new Date().toISOString() };
    });
    setManualPair(prev =>
      prev && pairKey(prev.primary, prev.duplicate) === pairKey(primary, duplicate) ? null : prev
    );
    toast.success(`Merged into ${merged.name || primary.email}`);
  }, [queryClient, session?.user?.email]);

  const handleSnoozed = useCallback((email: string, snoozedUntil: string) => {
    queryClient.setQueryData<ContactsData>(['sentRecipients', session?.user?.email], (oldData) => {
      const existing = oldData?.contacts ?? [];
      const merged = existing.map(c => c.email === email ? { ...c, snoozedUntil } : c);
      return session?.user?.email
        ? persistContacts(session.user.email, merged)
        : { contacts: merged, lastUpdated: new Date().toISOString() };
    });
  }, [queryClient, session?.user?.email]);

  const handleImportComplete = useCallback((newContacts: Contact[], eventName?: string) => {
    queryClient.setQueryData(['sentRecipients', session?.user?.email], (oldData: any) => {
      // Get existing contacts from the query data
      const existingContacts = oldData?.contacts || [];

      // Event-stamped re-imports refresh met-at on contacts we already have
      // (the server upsert did the same), without clobbering their richer
      // local data the way a full replace would.
      const incomingByEmail = new Map(newContacts.map(c => [c.email.toLowerCase(), c]));
      const refreshedExisting = existingContacts.map((c: Contact) => {
        const incoming = incomingByEmail.get(c.email.toLowerCase());
        return incoming?.metAt ? { ...c, metAt: incoming.metAt } : c;
      });

      // Create a Set of existing email addresses (case-insensitive)
      const existingEmails = new Set(existingContacts.map((c: Contact) => c.email.toLowerCase()));

      // Only add new contacts that don't exist in the current list
      const uniqueNewContacts = newContacts.filter(
        contact => !existingEmails.has(contact.email.toLowerCase())
      );

      const updatedContacts = [...refreshedExisting, ...uniqueNewContacts];
      
      // Update localStorage with the new data
      const storageKey = getContactsStorageKey(session?.user?.email);
      localStorage.setItem(storageKey, JSON.stringify({
        contacts: updatedContacts,
        lastUpdated: new Date().toISOString(),
        userEmail: session?.user?.email
      }));
      
      // Show success message
      if (uniqueNewContacts.length > 0) {
        toast.success(`Imported ${uniqueNewContacts.length} new contacts`, {
          duration: 3000,
          style: { background: '#F4F4FF', color: '#1E1E3F' }
        });
      } else if (newContacts.length > 0) {
        toast.success('All contacts already exist in your network', {
          duration: 3000,
          style: { background: '#F4F4FF', color: '#1E1E3F' }
        });
      } else {
        toast.error('No contacts found in import file', {
          duration: 3000,
          style: { background: '#FFEBEE', color: '#C62828' }
        });
      }
      
      return {
        contacts: updatedContacts,
        lastUpdated: new Date().toISOString()
      };
    });

    // Event import: land on the event's roster with triage one tap away.
    if (eventName && newContacts.length > 0) {
      setFilter(`event-${eventName}` as FilterType);
      toast((t) => (
        <span className="flex items-center gap-3 text-sm">
          <span>Stamped with {eventName}.</span>
          <button
            onClick={() => { setShowTriage(true); toast.dismiss(t.id); }}
            className="font-medium text-[#1E1E3F] underline underline-offset-2"
          >
            Triage now
          </button>
        </span>
      ), { duration: 8000, style: { background: '#F4F4FF', color: '#1E1E3F' } });
    }
  }, [queryClient, session?.user?.email, setFilter]);

  const handleContactUpdate = async (updatedContact: Contact, originalEmail?: string): Promise<void> => {
    // mutateAsync (not mutate) so failures reject and callers can react;
    // the mutation's onError already shows the user a toast.
    await updateContactMutation.mutateAsync({
      contact: updatedContact,
      originalEmail: originalEmail ?? updatedContact.email,
    });
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    toast[type](message);
  };

  // Handle domain selection from domain stats
  const handleDomainSelect = (domain: string) => {
    if (domain === selectedDomain) {
      setSelectedDomain(undefined);
      setSearch(''); // Clear search when deselecting
    } else {
      setSelectedDomain(domain);
      setSearch(domain); // Set search to selected domain
      if (!isDomainFilterMode) {
        setIsDomainFilterMode(true); // Ensure domain filter mode is active
      }
    }
  };

  // Update search state when debounced value changes
  useEffect(() => {
    setSearch(debouncedSearch);
  }, [debouncedSearch]);

  // Loading/error screens render INSIDE AppLayout (see the main return):
  // an early return here used to bypass the app's only auth gate, leaving
  // signed-out visitors on this spinner forever instead of redirecting.
  const loadingScreen = (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center justify-center">
        <div className="w-16 h-16 relative">
          <div className="w-16 h-16 rounded-full border-4 border-[#F4F4FF]"></div>
          <div className="w-16 h-16 rounded-full border-4 border-t-[#1E1E3F] animate-spin absolute inset-0"></div>
        </div>
        <h2 className="text-xl font-semibold text-[#1E1E3F] mt-8 mb-2">
          Organizing Your Network
        </h2>
        <p className="text-gray-600 text-center max-w-md">
          We're analyzing your contacts to provide personalized insights
        </p>
      </div>
    </div>
  );

  const errorScreen = (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      <div className="text-red-500 mb-4">⚠️ Error</div>
      <p className="text-gray-600">{error instanceof Error ? error.message : 'An unknown error occurred'}</p>
    </div>
  );

  // Add these calculations before the return statement
  // const { needFollowUp, activeConnectionsPercentage } = calculateMetrics();

  const handleCreateGroup = (name: string, members: Set<string>) => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const newGroup = {
      id: Date.now().toString(),
      name,
      members: Array.from(members)
    };
    
    const updatedGroups = [...groups, newGroup];
    setGroups(updatedGroups);
    
    setShowGroupModal(false);
    setFilter(`group-${newGroup.id}`);
  };

  const handleDeleteGroup = (groupId: string) => {
    if (filter === `group-${groupId}`) setFilter('all');
    const updatedGroups = groups.filter(g => g.id !== groupId);
    setGroups(updatedGroups);
  };

  const handleEditGroup = (group: { id: string; name: string; members: string[] }) => {
    setEditingGroup(group);
    setShowGroupModal(true);
  };

  const handleGroupSave = (name: string, members: Set<string>) => {
    if (editingGroup) {
      const updatedGroups = groups.map(g => 
        g.id === editingGroup.id 
          ? { ...g, name, members: Array.from(members) }
          : g
      );
      setGroups(updatedGroups);
    } else {
      handleCreateGroup(name, members);
    }
    setShowGroupModal(false);
    setEditingGroup(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddColumn = (column: {
    key: string;
    label: string;
    render: (contact: Contact) => React.ReactNode
  }) => {
    const customKey = customKeyForLabel(column.label);

    // Register the definition (persisted per user); values are written
    // into each contact's customFields when a cell is edited, so no
    // contact data changes here.
    seededCustomKeys.current.add(customKey);
    setCustomColumnDefs(prev =>
      prev.some(def => def.key === customKey)
        ? prev
        : [...prev, { key: customKey, label: column.label }]
    );

    setActiveColumns(prev => {
      if (prev.includes(customKey)) return prev;
      return [...prev, customKey];
    });
  };

  const handleStartCleanup = () => {
    setShowOnboarding(false);
    setShowCleanupAssistant(true);
  };

  const handleSkipOnboarding = () => {
    setShowOnboarding(false);
    // We don't need to mark cleanup as permanently completed anymore
  };

  const quickFilters: QuickFilterItem[] = [
    { id: 'all', label: 'All', icon: 'Users', isGroup: false },
    { id: 'domain', label: 'By Domain', icon: 'Globe', isGroup: false },
    { id: 'intros', label: 'Intros', icon: 'Link', isGroup: false }
  ];

  const applySavedView = (view: { config: { search?: string; filter?: string; sortKey?: string; sortDirection?: 'asc' | 'desc' } }) => {
    setInputSearch(view.config.search ?? '');
    setFilter((view.config.filter ?? 'all') as FilterType);
    if (view.config.sortKey) {
      setSortConfig({ key: view.config.sortKey as SortConfig['key'], direction: view.config.sortDirection ?? 'desc' });
    }
  };

  const saveCurrentView = () => {
    const name = viewNameDraft.trim();
    if (!name) return;
    const view = {
      id: String(Date.now()),
      name: name.slice(0, 60),
      config: {
        ...(search ? { search } : {}),
        ...(filter !== 'all' ? { filter } : {}),
        ...(sortConfig.key ? { sortKey: String(sortConfig.key), sortDirection: sortConfig.direction } : {}),
      },
    };
    persistViews([...savedViews, view]);
    setViewNameDraft('');
    setSavingView(false);
    toast.success(`View "${view.name}" saved`);
  };

  // Update the filter handling logic
  const handleFilterClick = (filterId: string) => {
    if (filterId === 'domain') {
      setIsDomainFilterMode(!isDomainFilterMode);
      // If turning on domain filter mode, clear search if it doesn't look like a domain
      if (!isDomainFilterMode && search && !isDomainSearch(search)) {
        setSearch('');
      }
    } else {
      const newFilter = filter === filterId ? 'all' : filterId as FilterType;
      setFilter(newFilter);
      
      // Update URL if selecting or deselecting a group
      if (newFilter !== 'all' && newFilter.startsWith('group-')) {
        const groupId = newFilter.replace('group-', '');
        const newParams = new URLSearchParams(searchParams);
        newParams.set('group', groupId);
        router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
      } else if (filterId.startsWith('group-')) {
        // If deselecting a group, remove group param
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('group');
        router.replace(pathname, { scroll: false });
      }
      
      // Turn off domain filter mode when selecting other filters
      if (isDomainFilterMode) {
        setIsDomainFilterMode(false);
      }
    }
  };

  // Add a placeholder hint for domain search
  const getSearchPlaceholder = () => {
    if (isDomainFilterMode) {
      return "Type a domain or company name (e.g., amazon, gmail.com)...";
    }
    return "Search by name, email, company...";
  };

  return (
    <AppLayout>
      {isLoading ? loadingScreen : error ? errorScreen : (
      <div className="w-full">
        <div className="space-y-6 md:space-y-8">
          {/* Enhanced Header Section */}
          <div className="bg-gradient-to-r from-[#F4F4FF] to-[#FAFAFA] rounded-3xl p-4 md:p-8 overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
              <div>
                <h1 className="text-2xl md:text-3xl font-bold text-[#1E1E3F] mb-2">Your Network</h1>
                <p className="text-gray-600">Manage and organize your professional connections</p>
                <p className="text-sm text-gray-500 mt-1">
                  Last updated: {new Date(contactsData.lastUpdated).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <button
                  onClick={refreshContacts}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-sm"
                  title="Refresh from cache"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden md:inline">Refresh</span>
                </button>
                <button
                  onClick={forceRefresh}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[#1E1E3F] text-white rounded-xl hover:bg-[#2D2D5F] transition-all text-sm"
                  title="Force refresh from server"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden md:inline">Force Refresh</span>
                </button>
                {process.env.NODE_ENV === 'development' && (
                  <button
                    onClick={resetSessionOnly}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gray-100 border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-sm"
                    title="Show cleanup assistant (testing only)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="hidden md:inline">Test Cleanup</span>
                  </button>
                )}
                {process.env.NODE_ENV === 'development' && (
                  <button
                    onClick={() => {
                      // Clear all localStorage data for testing
                      Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('contacts_') || 
                            key.startsWith('enrichment-cache_') || 
                            key.startsWith('contact-groups_')) {
                          localStorage.removeItem(key);
                        }
                      });
                      
                      if (session?.user?.email) {
                        sessionStorage.removeItem(`cleanup-state_${session.user.email}`);
                      }
                      
                      toast.success('All data cleared', {
                        duration: 2000,
                        style: { background: '#F4F4FF', color: '#1E1E3F' }
                      });
                      
                      // Reload the page to simulate a fresh visit
                      setTimeout(() => window.location.reload(), 500);
                    }}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-red-50 border border-red-200 text-red-700 rounded-xl hover:bg-red-100 transition-all text-sm"
                    title="Clear all data (testing only)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="hidden md:inline">Clear Data</span>
                  </button>
                )}
                {process.env.NODE_ENV === 'development' && (
                  <button
                    onClick={() => {
                      // Show all localStorage keys and values
                      const storage: Record<string, unknown> = {};
                      Object.keys(localStorage).forEach(key => {
                        try {
                          storage[key] = JSON.parse(localStorage.getItem(key) || '');
                        } catch {
                          storage[key] = localStorage.getItem(key);
                        }
                      });
                      console.log('All localStorage items:', storage);
                      
                      toast.success('Storage data logged to console', {
                        duration: 2000,
                        style: { background: '#F4F4FF', color: '#1E1E3F' }
                      });
                    }}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl hover:bg-blue-100 transition-all text-sm"
                    title="Log storage data to console (testing only)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <span className="hidden md:inline">Debug Storage</span>
                  </button>
                )}
                {process.env.NODE_ENV === 'development' && (
                  <button
                    onClick={() => {
                      // Clear groups data
                      Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('contact-groups_')) {
                          localStorage.removeItem(key);
                        }
                      });
                      
                      // Also clear the legacy groups data
                      localStorage.removeItem('contact-groups');
                      
                      // Reset groups state using the hook's setGroups
                      setGroups([]);
                      
                      toast.success('All groups data cleared', {
                        duration: 2000,
                        style: { background: '#F4F4FF', color: '#1E1E3F' }
                      });
                    }}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-orange-50 border border-orange-200 text-orange-700 rounded-xl hover:bg-orange-100 transition-all text-sm"
                    title="Clear all groups data (testing only)"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span className="hidden md:inline">Clear Groups</span>
                  </button>
                )}
                {duplicatePairs.length > 0 && (
                  <button
                    onClick={() => { setManualPair(null); setShowMergeModal(true); }}
                    className="flex items-center gap-2 px-3 md:px-4 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg hover:bg-amber-100 transition-colors text-sm"
                    title="Review contacts that look like the same person"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M9 20H4v-2a3 3 0 015.356-1.857M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="hidden md:inline">
                      {duplicatePairs.length} possible duplicate{duplicatePairs.length === 1 ? '' : 's'}
                    </span>
                    <span className="md:hidden">{duplicatePairs.length}</span>
                  </button>
                )}
                <button
                  onClick={() => setShowQuickAdd(true)}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span className="hidden md:inline">Add Contact</span>
                </button>
                <button
                  onClick={() => setShowGroupModal(true)}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="hidden md:inline">Create Group</span>
                </button>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  <span className="hidden md:inline">Import CSV</span>
                </button>
                <button
                  onClick={() => setShowGroupExportModal(true)}
                  className="flex items-center gap-2 px-3 md:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50 transition-all text-sm"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span className="hidden md:inline">{currentGroup ? 'Export Group' : 'Export'}</span>
                </button>
              </div>
            </div>

            {/* Filter section */}
            <div className="mb-4 md:mb-6 overflow-x-auto pb-2 hide-scrollbar">
              <div className="flex gap-2 md:gap-3 items-center">
                {/* Debug logging 
                  console.log('Rendering filters, current filter:', filter, 'loadedGroups:', loadedGroups, 'groups:', groups)
                */}
                {loadedGroups && [...quickFilters, ...groups.map(group => ({
                  id: `group-${group.id}`, 
                  label: group.name, 
                  isGroup: true,
                  groupData: group
                } as GroupFilterItem))].map((filterItem: FilterItem) => {
                  // Debug each filter item is commented out for production
                  // console.log('Filter item:', filterItem.id, 'selected:', filterItem.id === 'domain' ? isDomainFilterMode : filter === filterItem.id);
                  return (
                    <div key={filterItem.id} className="relative group">
                      <FilterChip
                        label={filterItem.id.startsWith('group-') 
                          ? filterItem.label 
                          : filterItem.id.charAt(0).toUpperCase() + filterItem.id.slice(1).replace(/([A-Z])/g, ' $1')}
                        icon={filterItem.isGroup ? 'Users' as IconName : filterItem.icon}
                        selected={filterItem.id === 'domain' ? isDomainFilterMode : filter === filterItem.id}
                        onClick={() => handleFilterClick(filterItem.id)}
                        badge={filterItem.isGroup ? filterItem.groupData?.members.length : undefined}
                        tooltipContent={filterItem.isGroup 
                          ? `Filter by ${filterItem.label} group contacts` 
                          : filterItem.id === 'domain'
                            ? 'Filter contacts by domain (e.g., gmail, amazon.com)'
                            : `Show ${filterItem.id === 'all' ? 'all' : filterItem.id.charAt(0).toUpperCase() + filterItem.id.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase()} contacts`}
                        showSelectedIcon={true}
                        onEdit={filterItem.isGroup ? 
                          () => handleEditGroup(filterItem.groupData) : undefined}
                        onDelete={filterItem.isGroup ? 
                          () => handleDeleteGroup(filterItem.groupData.id) : undefined}
                        editMode={filterItem.isGroup ? 'modal' : 'inline'}
                      />
                    </div>
                  );
                })}
                {loadedGroups && allTags.length > 0 && (
                  <div className="h-5 w-px bg-gray-200 mx-1 flex-none" aria-hidden="true" />
                )}
                {loadedGroups && allTags.map(([tag, count]) => (
                  <FilterChip
                    key={`tag-${tag}`}
                    label={tag}
                    icon={'Tag' as IconName}
                    selected={filter === `tag-${tag}`}
                    onClick={() => handleFilterClick(`tag-${tag}`)}
                    badge={count}
                    tooltipContent={`Show contacts tagged ${tag}`}
                    showSelectedIcon={true}
                  />
                ))}
                {loadedGroups && allEvents.length > 0 && (
                  <div className="h-5 w-px bg-gray-200 mx-1 flex-none" aria-hidden="true" />
                )}
                {loadedGroups && allEvents.map(([eventName, count]) => (
                  <FilterChip
                    key={`event-${eventName}`}
                    label={eventName}
                    icon={'Calendar' as IconName}
                    selected={filter === `event-${eventName}`}
                    onClick={() => handleFilterClick(`event-${eventName}`)}
                    badge={count}
                    tooltipContent={`Everyone you met at ${eventName}`}
                    showSelectedIcon={true}
                  />
                ))}
                {filter.startsWith('event-') && triageContacts.length > 0 && (
                  <button
                    onClick={() => setShowTriage(true)}
                    className="flex-none flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#1E1E3F] rounded-full hover:bg-[#2D2D5F] transition-colors"
                  >
                    Triage these
                  </button>
                )}
                {savedViews.length > 0 && (
                  <div className="h-5 w-px bg-gray-200 mx-1 flex-none" aria-hidden="true" />
                )}
                {savedViews.map(view => (
                  <FilterChip
                    key={`view-${view.id}`}
                    label={view.name}
                    icon={'Bookmark' as IconName}
                    selected={false}
                    onClick={() => applySavedView(view)}
                    tooltipContent={`Apply saved view: ${view.name}`}
                    onDelete={() => persistViews(savedViews.filter(v => v.id !== view.id))}
                  />
                ))}
                {(search || filter !== 'all') && (
                  savingView ? (
                    <form
                      onSubmit={(e) => { e.preventDefault(); saveCurrentView(); }}
                      className="flex items-center gap-1.5 flex-none"
                    >
                      <input
                        value={viewNameDraft}
                        onChange={(e) => setViewNameDraft(e.target.value)}
                        placeholder="View name"
                        autoFocus
                        className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20 bg-white w-36"
                      />
                      <button type="submit" disabled={!viewNameDraft.trim()} className="text-sm font-medium text-[#1E1E3F] px-2 py-1 disabled:opacity-40">Save</button>
                      <button type="button" onClick={() => { setSavingView(false); setViewNameDraft(''); }} aria-label="Cancel saving view" className="text-sm text-gray-400 px-1">×</button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setSavingView(true)}
                      className="flex-none flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-dashed border-gray-300 rounded-full hover:border-[#1E1E3F]/40 hover:text-[#1E1E3F] transition-colors"
                    >
                      + Save view
                    </button>
                  )
                )}
                <div className="h-5 w-px bg-gray-200 mx-1 flex-none" aria-hidden="true" />
                {currentEvent ? (
                  <span className="flex-none flex items-center gap-2 px-3 py-1.5 text-sm rounded-full bg-[#1E1E3F] text-white">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                    At {currentEvent.name}
                    <button
                      onClick={endEventMode}
                      aria-label="End event mode"
                      className="text-white/70 hover:text-white transition-colors"
                    >
                      ×
                    </button>
                  </span>
                ) : settingEvent ? (
                  <form
                    onSubmit={(e) => { e.preventDefault(); startEventMode(); }}
                    className="flex items-center gap-1.5 flex-none"
                  >
                    <input
                      value={eventDraft}
                      onChange={(e) => setEventDraft(e.target.value)}
                      placeholder="Event name"
                      autoFocus
                      className="px-2.5 py-1.5 text-sm border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20 bg-white w-40"
                    />
                    <button type="submit" disabled={!eventDraft.trim()} className="text-sm font-medium text-[#1E1E3F] px-2 py-1 disabled:opacity-40">Start</button>
                    <button type="button" onClick={() => { setSettingEvent(false); setEventDraft(''); }} aria-label="Cancel event mode" className="text-sm text-gray-400 px-1">×</button>
                  </form>
                ) : (
                  <button
                    onClick={() => setSettingEvent(true)}
                    className="flex-none flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 border border-dashed border-gray-300 rounded-full hover:border-[#1E1E3F]/40 hover:text-[#1E1E3F] transition-colors"
                    title="Prefill where-you-met on everything you add while you are there"
                  >
                    At an event?
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Enhanced Search Bar */}
          <div className="bg-white rounded-3xl shadow-sm mb-4">
            <div className="p-4">
              <div className="relative">
                <input
                  type="text"
                  value={inputSearch}
                  onChange={(e) => setInputSearch(e.target.value)}
                  placeholder={getSearchPlaceholder()}
                  className={`w-full px-4 py-3 pl-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1E1E3F] focus:border-transparent transition-all ${(isDomainFilterMode || (search && isDomainSearch(search))) ? 'border-[#4B4BA6] bg-[#F4F4FF]' : ''}`}
                />
                <svg 
                  className="w-6 h-6 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {search && isDomainSearch(search) && (
                  <div className="absolute right-16 top-1/2 -translate-y-1/2 text-[#4B4BA6] bg-[#F4F4FF] px-2 py-0.5 rounded text-xs font-medium">
                    Domain Search
                  </div>
                )}
                {inputSearch && (
                  <button
                    onClick={() => {
                      setInputSearch('');
                      setSearch('');
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    ✕
                  </button>
                )}
              </div>
              {(isDomainFilterMode || (search && isDomainSearch(search))) && (
                <div className="mt-2 text-xs flex items-start">
                  <svg className="w-4 h-4 mr-1 text-[#4B4BA6] shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 16V12M12 8H12.01M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" 
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <div className="text-gray-600">
                    <p className="font-medium text-[#4B4BA6]">Smart Domain Search</p>
                    <p>
                      {search ? (
                        <>Showing contacts with <span className="font-semibold">{search}</span> and related domains like <span className="font-semibold">{search.includes('.') ? search : `${search}.com`}</span></>
                      ) : (
                        <>Type a company or domain name (e.g., <span className="font-medium">amazon</span>, <span className="font-medium">gmail</span>) to filter your contacts</>
                      )}
                    </p>
                    {search && !search.includes('@') && !search.includes(' ') && (
                      <p className="mt-1 text-gray-500">
                        Note: Partial matches like "{search}" will match "{search}.com", "{search}.org", etc.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Domain Stats Section - Only show when domain filter mode is active */}
          {isDomainFilterMode && (
            <div className="mb-4">
              <DomainStats 
                contacts={displayContacts}
                extractDomain={extractDomain}
                selectedDomain={selectedDomain}
                onDomainSelect={handleDomainSelect}
              />
            </div>
          )}

          {/* Needs attention: the reconnect queue */}
          <ReconnectRail
            contacts={displayContacts}
            onSnoozed={handleSnoozed}
            onTouchLogged={handleTouchLogged}
            priorityEmails={priorityEmails}
          />

          {/* Enhanced Table Section */}
          <div className="bg-white rounded-3xl shadow-sm">
            <div className="p-4 flex justify-between border-b border-gray-100">
              <div className="flex items-center">
                <span className="text-sm font-medium text-gray-700">Your Network</span>
                <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-[#F4F4FF] text-[#1E1E3F]">
                  {filteredContacts.length} contacts
                </span>
                {isDomainFilterMode && search && isDomainSearch(search) && domainGroupedContacts && (
                  <span className="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-[#F4F4FF] text-[#1E1E3F]">
                    {domainGroupedContacts.length} domains
                  </span>
                )}
              </div>
              <ColumnCustomizer
                availableColumns={availableColumnsList}
                activeColumns={activeColumns}
                onColumnChange={(columns) => setActiveColumns(columns as ColumnKey[])}
                onAddColumn={handleAddColumn}
                onEditColumn={(key, newLabel) => {
                  // Persist renames of custom columns; the reconcile effect
                  // rebuilds the visible list from the definitions.
                  if (key.startsWith('custom_')) {
                    setCustomColumnDefs(prev =>
                      prev.some(def => def.key === key)
                        ? prev.map(def => def.key === key ? { ...def, label: newLabel } : def)
                        : [...prev, { key: key as CustomColumnKey, label: newLabel }]
                    );
                  }
                  // Also update availableColumnsList to show the new label in the UI
                  setAvailableColumnsList(prev => prev.map(col =>
                    col.key === key ? { ...col, label: newLabel } : col
                  ));
                }}
              />
            </div>

            {isDomainFilterMode && search && isDomainSearch(search) && domainGroupedContacts ? (
              // Domain-grouped view
              <div className="divide-y divide-gray-100">
                {domainGroupedContacts.map(([domain, domainContacts]) => (
                  <div key={domain} className="py-2">
                    <div className="px-4 py-2 bg-gray-50 flex items-center">
                      <svg className="w-4 h-4 mr-2 text-[#4B4BA6]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 21a9 9 0 100-18 9 9 0 000 18z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a4.5 4.5 0 000 18 4.5 4.5 0 000-18z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="font-medium text-sm text-[#1E1E3F]">{domain}</span>
                      <span className="ml-2 text-xs text-gray-500">({domainContacts.length} contacts)</span>
                    </div>
                    <ContactTable 
                      contacts={domainContacts}
                      onContactClick={setSelectedContact}
                      onContactUpdate={handleContactUpdate}
                onBulkTag={handleBulkTag}
                onMergePair={handleMergePairSelected}
                      currentPage={1}
                      itemsPerPage={domainContacts.length}
                      columns={visibleColumns}
                      className="divide-y divide-gray-100"
                      sortConfig={sortConfig}
                      onSort={handleSort}
                      showToast={showToast}
                      totalContacts={domainContacts.length}
                      onPageChange={() => {}}
                      onPageSizeChange={() => {}}
                      hideHeader={true}
                    />
                  </div>
                ))}
              </div>
            ) : (
              // Standard view
              <ContactTable 
                contacts={filteredContacts}
                onContactClick={setSelectedContact}
                onContactUpdate={handleContactUpdate}
                onBulkTag={handleBulkTag}
                onMergePair={handleMergePairSelected}
                currentPage={currentPage}
                itemsPerPage={itemsPerPage}
                columns={visibleColumns}
                className="divide-y divide-gray-100"
                sortConfig={sortConfig}
                onSort={handleSort}
                showToast={showToast}
                totalContacts={filteredContacts.length}
                onPageChange={(page) => setCurrentPage(page)}
                onPageSizeChange={(size) => setItemsPerPage(size)}
              />
            )}
          </div>
        </div>

        {selectedContact && (
          <ContactDetail
            contact={selectedContact}
            onClose={() => setSelectedContact(null)}
            onSave={(contact) => { handleContactUpdate(contact, selectedContact.email).catch(() => {}); }}
            onAddColumn={handleAddColumn}
          />
        )}

        {/* Group Modal */}
        <GroupModal
          isOpen={showGroupModal}
          onClose={() => {
            setShowGroupModal(false);
            setEditingGroup(null);
          }}
          contacts={contacts}
          onGroupCreate={handleGroupSave}
          editingGroup={editingGroup || undefined}
        />

        {/* Onboarding Prompt */}
        {showOnboarding && (
          <OnboardingPrompt 
            onStartCleanup={handleStartCleanup} 
            onSkip={handleSkipOnboarding} 
          />
        )}

        {/* Inbox Cleanup Assistant */}
        <QuickAddModal
          isOpen={showQuickAdd}
          onClose={() => setShowQuickAdd(false)}
          onAdded={mergeContactLocal}
          defaultMetAt={currentEvent?.name}
        />

        <TriageModal
          isOpen={showTriage}
          onClose={() => setShowTriage(false)}
          eventName={filter.startsWith('event-') ? filter.replace('event-', '') : ''}
          contacts={triageContacts}
          onSave={(contact) => { handleContactUpdate(contact, contact.email).catch(() => {}); }}
        />

        <MergeModal
          isOpen={showMergeModal}
          onClose={() => { setShowMergeModal(false); setManualPair(null); }}
          pairs={manualPair ? [manualPair] : duplicatePairs}
          onMerge={handleMerge}
          onDismiss={handleDismissPair}
        />

        {showCleanupAssistant && (
          <InboxCleanupAssistant 
            contacts={contacts}
            onMarkAsSpam={(emails) => {
              fetch('/api/contacts/spam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emails, isSpam: true }),
              }).catch(() => {});
              const updatedContacts = contacts.map((contact: Contact) => ({
                ...contact,
                isSpam: emails.includes(contact.email)
              } as ContactWithSpam));
              queryClient.setQueryData<ContactsData>(
                ['sentRecipients', session?.user?.email],
                session?.user?.email
                  ? persistContacts(session.user.email, updatedContacts)
                  : { contacts: updatedContacts, lastUpdated: new Date().toISOString() }
              );
            }}
            onUndo={(email) => {
              fetch('/api/contacts/spam', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emails: [email], isSpam: false }),
              }).catch(() => {});
              const updatedContacts = contacts.map((contact: Contact) => ({
                ...contact,
                isSpam: (contact as ContactWithSpam).isSpam === undefined ? false : 
                       email === contact.email ? false : (contact as ContactWithSpam).isSpam
              } as ContactWithSpam));
              queryClient.setQueryData<ContactsData>(
                ['sentRecipients', session?.user?.email],
                session?.user?.email
                  ? persistContacts(session.user.email, updatedContacts)
                  : { contacts: updatedContacts, lastUpdated: new Date().toISOString() }
              );
            }}
            onClose={() => {
              try {
                const key = `cleanup-state_${session?.user?.email}`;
                const state = JSON.parse(sessionStorage.getItem(key) ?? '{}');
                sessionStorage.setItem(key, JSON.stringify({ ...state, dismissedAt: new Date().toISOString() }));
              } catch {}
              setShowCleanupAssistant(false);
            }}
          />
        )}

        {/* Group Export Modal */}
        <GroupExportModal
          isOpen={showGroupExportModal}
          onClose={() => setShowGroupExportModal(false)}
          groupName={currentGroup?.name || 'All Contacts'}
          contacts={currentGroup 
            ? contacts.filter((contact: Contact) => currentGroup.members.includes(contact.email))
            : filteredContacts
          }
        />

        <ImportModal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          onImportComplete={handleImportComplete}
          defaultEventName={currentEvent?.name}
        />
      </div>
      )}
    </AppLayout>
  );
}

export default function ContactsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse">Loading contacts...</div>
      </div>
    }>
      <ContactsContent />
    </Suspense>
  );
}