import { prepareChunk, queryCJIC } from './cjic-engine.mjs';

const chunks = new Map();
let manifestPromise;
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CJIC data returned ${response.status}. Run npm run data:cjic to prepare the downloaded files.`);
  return response.json();
}
self.addEventListener('message', async ({ data: { id, basePath, filters } }) => {
  try {
    const root = `${basePath}/data/michigan-cjic/prepared`;
    manifestPromise ??= json(`${root}/manifest.json`).catch((error) => { manifestPromise = undefined; throw error; });
    const manifest = await manifestPromise;
    const requests = filters.sources.flatMap((source) => manifest.sources[source].chunks
      .filter((chunk) => filters.period === 'all' || String(chunk.year) === filters.period)
      .map((chunk) => ({ ...chunk, source })));
    const loaded = [];
    // Bound parallel JSON decoding so loading all years stays usable on mobile.
    for (let index = 0; index < requests.length; index += 2) {
      loaded.push(...await Promise.all(requests.slice(index, index + 2).map((request) => {
        if (!chunks.has(request.file)) chunks.set(request.file, json(`${root}/${request.file}`)
          .then((data) => prepareChunk(request.source, request.year, data))
          .catch((error) => { chunks.delete(request.file); throw error; }));
        return chunks.get(request.file);
      })));
    }
    self.postMessage({ id, result: queryCJIC(manifest, loaded, filters) });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
