'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="fallback-page"><span className="fallback-brand">INFRINGE</span><h1>The dashboard couldn’t load</h1><p>Try again, or open the default view to clear the current selection.</p><div><button type="button" onClick={reset}>Try again</button><a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}>Open default view</a></div></main>;
}
