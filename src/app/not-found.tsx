import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-6xl font-bold text-[#1E1E3F] mb-4">404</p>
        <h1 className="text-xl font-semibold text-[#1E1E3F] mb-2">Page not found</h1>
        <p className="text-gray-600 mb-6">That page doesn&apos;t exist (or doesn&apos;t anymore).</p>
        <Link
          href="/contacts"
          className="inline-block px-5 py-2.5 text-sm font-medium text-white bg-[#1E1E3F] rounded-lg hover:bg-[#2D2D5F] transition-colors"
        >
          Go to contacts
        </Link>
      </div>
    </div>
  );
}
