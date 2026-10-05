'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import toast from 'react-hot-toast';
import { Contact } from '@/types';
import { adaptContacts } from '@/utils/contactAdapter';

export type ContactsData = {
  contacts: Contact[];
  lastUpdated: string;
};

// Helper function to get the consistent storage key
export const getContactsStorageKey = (userEmail: string | null | undefined): string => {
  if (!userEmail) {
    throw new Error('User email is required for storage key');
  }
  return `contacts_${userEmail}`;
};

/**
 * Write the canonical persisted shape and return the matching query-cache
 * value. Every cache writer must go through this (or produce the identical
 * shape): the queryFn validates userEmail and expects
 * { contacts, lastUpdated, userEmail } in localStorage.
 */
export function persistContacts(userEmail: string, contacts: Contact[]): ContactsData {
  const lastUpdated = new Date().toISOString();
  try {
    localStorage.setItem(
      getContactsStorageKey(userEmail),
      JSON.stringify({ contacts, lastUpdated, userEmail })
    );
  } catch (error) {
    console.error('Failed to persist contacts to localStorage:', error);
  }
  return { contacts, lastUpdated };
}

/**
 * The one contacts query: a single key, shape, and fetcher shared by every
 * page, with localStorage as a read-through cache in front of /api/contacts.
 */
export function useContacts() {
  const { data: session } = useSession();

  return useQuery<ContactsData>(
    ['sentRecipients', session?.user?.email],
    async () => {
      // Ensure we have a valid session
      if (!session?.user?.email) {
        throw new Error('No active session');
      }

      // Check if we have cached data in localStorage
      const storageKey = getContactsStorageKey(session.user.email);
      const cachedData = localStorage.getItem(storageKey);

      if (cachedData) {
        try {
          const parsedData = JSON.parse(cachedData);

          // Validate the structure of cached data
          if (!parsedData || typeof parsedData !== 'object') {
            console.warn('Invalid cached data structure, clearing cache');
            localStorage.removeItem(storageKey);
            throw new Error('Invalid cached data structure');
          }

          // If the cached data belongs to a different user, clear it
          if (parsedData.userEmail && parsedData.userEmail !== session.user.email) {
            console.warn('Cached data belongs to different user, clearing cache');
            localStorage.removeItem(storageKey);
            throw new Error('Invalid cached data');
          }

          // Handle both old and new data structures
          let contacts = [];
          if (Array.isArray(parsedData)) {
            // Old format: direct array of contacts
            contacts = parsedData;
          } else if (Array.isArray(parsedData.contacts)) {
            // New format: { contacts: [], lastUpdated: string }
            contacts = parsedData.contacts;
          } else {
            console.warn('Invalid contacts data structure, clearing cache');
            localStorage.removeItem(storageKey);
            throw new Error('Invalid contacts data');
          }

          // Show a non-intrusive toast notification
          setTimeout(() => {
            toast.success('Contacts loaded from cache', {
              duration: 2000,
              position: 'bottom-right',
              style: { backgroundColor: '#F4F4FF', color: '#1E1E3F' }
            });
          }, 500);

          return {
            contacts: adaptContacts(contacts),
            lastUpdated: parsedData.lastUpdated || new Date().toISOString()
          };
        } catch (error) {
          // If there's any error parsing the cache, clear it
          console.error('Error parsing cached data:', error);
          localStorage.removeItem(storageKey);
        }
      }

      const response = await fetch('/api/contacts');
      if (!response.ok) {
        throw new Error('Failed to fetch contacts');
      }

      const data = await response.json();
      const rawContacts = data.contacts || [];
      const { lastUpdated } = persistContacts(session.user.email, rawContacts);

      return {
        contacts: adaptContacts(rawContacts),
        lastUpdated
      };
    },
    {
      enabled: !!session?.user?.email,
      staleTime: 30 * 60 * 1000, // 30 minutes
      cacheTime: 60 * 60 * 1000, // keep in memory at least as long as it stays fresh
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false
    }
  );
}
