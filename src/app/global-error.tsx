'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error('Global error:', error);
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#FAFAFA' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <h1 style={{ color: '#1E1E3F', fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
            <p style={{ color: '#4B5563', marginBottom: 24 }}>
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button
              onClick={reset}
              style={{ background: '#1E1E3F', color: 'white', border: 0, borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
