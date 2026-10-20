import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Contact } from '@/types';
import { Dialog } from '@headlessui/react';
import { analyzeContact, SpamDetectionResult } from '../../utils/spamDetection';
import CleanupStep1 from './CleanupStep1';
import CleanupStep2 from './CleanupStep2';
import CleanupStep3 from './CleanupStep3';

interface InboxCleanupAssistantProps {
  contacts: Contact[];
  onMarkAsSpam: (emails: string[]) => void;
  onUndo: (email: string) => void;
  onClose: () => void;
}

interface FlaggedContact {
  contact: Contact;
  analysis: SpamDetectionResult;
}

type CategoryType = 'ignore' | 'review' | 'keep';

interface ContactCategory {
  email: string;
  category: CategoryType;
}

export default function InboxCleanupAssistant({ 
  contacts, 
  onMarkAsSpam, 
  onClose
}: InboxCleanupAssistantProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [flaggedContacts, setFlaggedContacts] = useState<FlaggedContact[]>([]);
  const [spamContacts, setSpamContacts] = useState<Set<string>>(new Set());
  const [categorizedContacts, setCategorizedContacts] = useState<ContactCategory[]>([]);

  // Memoize the flagged contacts calculation to prevent infinite loops
  const analyzedContacts = useMemo(() => {
    return contacts
      .filter(contact => !spamContacts.has(contact.email))
      .map(contact => ({
        contact,
        analysis: analyzeContact(contact)
      }))
      .filter(result => result.analysis.isSpam);
  }, [contacts, spamContacts]);

  useEffect(() => {
    setFlaggedContacts(analyzedContacts);
    
    // Only reset categorizations when the flagged contacts actually change
    if (analyzedContacts.length > 0) {
      // Use a deep comparison to detect real changes
      const existingEmails = new Set(flaggedContacts.map(fc => fc.contact.email));
      const newEmails = new Set(analyzedContacts.map(fc => fc.contact.email));
      
      // Check if the sets are different
      let isDifferent = existingEmails.size !== newEmails.size;
      if (!isDifferent) {
        // Check if all elements in existingEmails are in newEmails
        for (const email of existingEmails) {
          if (!newEmails.has(email)) {
            isDifferent = true;
            break;
          }
        }
      }
      
      if (isDifferent) {
        setCategorizedContacts([]);
      }
    }
  }, [analyzedContacts]);

  const handleCategorization = useCallback((categories: { [email: string]: CategoryType }) => {
    const newCategories = Object.entries(categories).map(([email, category]) => ({
      email,
      category,
    }));
    setCategorizedContacts(newCategories);
  }, []);

  const handleComplete = useCallback(() => {
    // Apply the categorizations
    const toArchive = categorizedContacts
      .filter(c => c.category === 'ignore')
      .map(c => c.email);
    
    if (toArchive.length > 0) {
      setSpamContacts(prev => {
        const newSpamContacts = new Set(prev);
        toArchive.forEach(email => newSpamContacts.add(email));
        return newSpamContacts;
      });
      
      onMarkAsSpam(toArchive);
    }
    onClose();
  }, [categorizedContacts, onMarkAsSpam, onClose]);

  const renderStep = useCallback(() => {
    switch (currentStep) {
      case 1:
        return <CleanupStep1 
                 flaggedCount={flaggedContacts.length} 
                 onNext={() => setCurrentStep(2)} 
                 onSkip={onClose}
                 spamResults={flaggedContacts.map(fc => ({
                   email: fc.contact.email,
                   result: fc.analysis
                 }))}
                 totalContactsCount={contacts.length}
                 currentStep={currentStep}
                 totalSteps={3}
               />;
      case 2:
        return <CleanupStep2 
                 contacts={flaggedContacts.map(fc => fc.contact)} 
                 actions={flaggedContacts}
                 onNext={() => setCurrentStep(3)} 
                 onBack={() => setCurrentStep(1)} 
                 onSkip={onClose}
                 currentStep={currentStep}
                 totalSteps={3}
                 totalContactsCount={contacts.length}
                 onCategorize={handleCategorization}
               />;
      case 3:
        return <CleanupStep3 
                 actions={flaggedContacts} 
                 categorizations={categorizedContacts}
                 onReview={() => setCurrentStep(2)}
                 onBack={() => setCurrentStep(2)} 
                 onComplete={handleComplete}
                 currentStep={currentStep}
                 totalSteps={3}
               />;
      default:
        return (
          <div className="text-center">
            <h3 className="text-lg font-semibold text-gray-900">All Steps Completed!</h3>
            <p className="text-gray-600">Your contacts are organized and ready for better insights.</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors"
            >
              Finish
            </button>
          </div>
        );
    }
  }, [
    currentStep, 
    flaggedContacts, 
    contacts.length, 
    onClose, 
    handleCategorization, 
    categorizedContacts, 
    handleComplete
  ]);

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black bg-opacity-50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel
          className="bg-white rounded-xl shadow-lg pt-12 px-6 pb-6 max-w-lg w-full relative max-h-[90vh] overflow-y-auto"
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 transition-colors group"
          >
            <div className="relative">
              <span className="sr-only">Close</span>
              <svg 
                className="w-5 h-5 text-gray-400 group-hover:text-gray-600" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M6 18L18 6M6 6l12 12" 
                />
              </svg>
            </div>
          </button>

          {/* Step Content */}
          {renderStep()}
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
