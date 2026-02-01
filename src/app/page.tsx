import Link from 'next/link';

export default function Home() {
  return (
    <main
      className="flex flex-col items-center min-h-screen p-4 sm:p-8 md:p-12"
      style={{ background: 'var(--background)', color: 'var(--primary-text)' }}
    >
      <div className="w-full max-w-4xl">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: 'var(--accent)' }}>
          SGA Graph
        </h1>
        <p className="mt-3 text-lg" style={{ color: 'var(--secondary-text)' }}>
          Local graph viewer with the ArxiGraph black/yellow theme, MathJax rendering, definition bank UI,
          and Constellations node interactions.
        </p>

        <div className="mt-6 rounded-xl p-4" style={{ background: 'var(--surface1)', border: '1px solid var(--border-color)' }}>
          <h2 className="text-base font-semibold">How to use</h2>
          <ol className="mt-2 text-sm space-y-2" style={{ color: 'var(--secondary-text)' }}>
            <li>
              1) Put exported JSON files under <code>public/data</code>.
            </li>
            <li>
              2) Open <code>/graph/&lt;slug&gt;</code>, where <code>slug</code> is the filename without <code>.json</code>.
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              className="inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-semibold"
              style={{ background: 'var(--accent)', color: 'var(--background)' }}
              href="/graph/example"
            >
              Open example
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
