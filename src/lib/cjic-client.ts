import type { CJICManifest, CJICResponse, CJICSource } from './crime';

type Filters = { sources: CJICSource[]; period: string; category: string; races: string[]; search: string; offset?: number; limit?: number; scope?: string; analysisOnly?: boolean };
let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, { resolve: (result: CJICResponse) => void; reject: (reason: Error) => void; cleanup: () => void }>();
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export async function fetchCJICManifest(signal: AbortSignal): Promise<CJICManifest> {
  const response = await fetch(`${basePath}/data/michigan-cjic/prepared/manifest.json`, { signal });
  if (!response.ok) throw new Error('CJIC files are not prepared. Run npm run data:cjic and refresh.');
  return response.json();
}

export function fetchCJIC(filters: Filters, signal: AbortSignal): Promise<CJICResponse> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  worker ??= new Worker(`${basePath}/cjic-worker.mjs`, { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<{ id: number; result?: CJICResponse; error?: string }>) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    request.cleanup();
    if (data.error || !data.result) request.reject(new Error(data.error || 'CJIC query failed'));
    else request.resolve(data.result);
  };
  worker.onerror = () => {
    for (const request of pending.values()) { request.cleanup(); request.reject(new Error('CJIC data worker could not start. Refresh to retry.')); }
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const abort = () => { pending.delete(id); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) });
    worker!.postMessage({ id, basePath, filters });
  });
}
