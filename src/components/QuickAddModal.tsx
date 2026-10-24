'use client';

import { useState } from 'react';
import { Dialog } from '@headlessui/react';
import { Contact } from '@/types';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdded: (contact: Contact) => void;
}

/** Hallway capture: a contact in ten seconds, context included. */
export default function QuickAddModal({ isOpen, onClose, onAdded }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [metAt, setMetAt] = useState('');
  const [introducedBy, setIntroducedBy] = useState('');
  const [tags, setTags] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(''); setEmail(''); setMetAt(''); setIntroducedBy(''); setTags(''); setNotes(''); };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          metAt,
          introducedBy,
          notes,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add contact');
      const { persisted: _p, ...contact } = data;
      onAdded(contact as Contact);
      toast.success(`${contact.name} added`);
      reset();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add contact');
    } finally {
      setSaving(false);
    }
  };

  const field = "w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1E1E3F]/20 focus:border-[#1E1E3F] text-sm";

  return (
    <Dialog open={isOpen} onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-xl shadow-lg w-full max-w-md p-6">
          <Dialog.Title className="text-lg font-semibold text-[#1E1E3F] mb-1">Add contact</Dialog.Title>
          <p className="text-sm text-gray-500 mb-4">Capture someone while the context is fresh.</p>
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="space-y-3"
          >
            <input className={field} placeholder="Name" value={name} onChange={e => setName(e.target.value)} autoFocus required />
            <input className={field} placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required />
            <input className={field} placeholder="Where you met (e.g. SF Climate Summit)" value={metAt} onChange={e => setMetAt(e.target.value)} />
            <input className={field} placeholder="Introduced by (optional)" value={introducedBy} onChange={e => setIntroducedBy(e.target.value)} />
            <input className={field} placeholder="Tags, comma separated (investor, climate)" value={tags} onChange={e => setTags(e.target.value)} />
            <textarea className={field} placeholder="Note to self" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !name.trim() || !email.trim()}
                className="px-4 py-2 text-sm font-medium bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] disabled:opacity-50 transition-colors"
              >
                {saving ? 'Adding…' : 'Add contact'}
              </button>
            </div>
          </form>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
