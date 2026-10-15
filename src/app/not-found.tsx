export default function NotFound() {
  return <main className="fallback-page"><span className="fallback-brand">INFRINGE</span><h1>This page isn’t available</h1><p>Return to the crime atlas to explore the data.</p><a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}>Open the dashboard</a></main>;
}
