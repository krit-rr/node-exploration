import React from 'react';
import { Dialog } from '@headlessui/react';

interface OnboardingPromptProps {
  onStartCleanup: () => void;
  onSkip: () => void;
}

export default function OnboardingPrompt({ onStartCleanup, onSkip }: OnboardingPromptProps) {
  return (
    <Dialog open onClose={onSkip} className="relative z-50">
      <div className="fixed inset-0 bg-black bg-opacity-50" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <Dialog.Panel className="bg-white rounded-xl shadow-lg p-6 max-w-md w-full text-center">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Ready to Declutter Your Inbox?
          </h2>
          <p className="text-gray-600 mb-6">
            Our Inbox Cleanup Assistant can help organize your contacts for better insights.
          </p>
          <div className="flex justify-center gap-4">
            <button
              onClick={onStartCleanup}
              className="px-4 py-2 bg-[#1E1E3F] text-white rounded-lg hover:bg-[#2D2D5F] transition-colors"
            >
              Yes, Let’s Clean Up
            </button>
            <button
              onClick={onSkip}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Skip for Now
            </button>
          </div>
        </Dialog.Panel>
      </div>
    </Dialog>
  );
}
