'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('Route error:', error);
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-semibold text-[#1E1E3F] mb-2">Something went wrong</h1>
        <p className="text-gray-600 mb-6">
          The page hit an unexpected error. Your data is safe — try again, or head back to your contacts.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={reset}
            className="px-5 py-2.5 text-sm font-medium text-white bg-[#1E1E3F] rounded-lg hover:bg-[#2D2D5F] transition-colors"
          >
            Try again
          </button>
          <a
            href="/contacts"
            className="px-5 py-2.5 text-sm font-medium text-[#1E1E3F] bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Go to contacts
          </a>
        </div>
      </div>
    </div>
  );
}
