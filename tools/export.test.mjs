import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

test('static export has deployable assets, workers, snapshots and correct base paths', async () => {
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const root = process.env.INFRINGE_DIST_DIR || 'out';
  const html = await readFile(resolve(root, 'index.html'), 'utf8');
  assert.ok(html.includes(`href="${base}/"`), 'Home link must stay within the deployment path');
  const assets = [...html.matchAll(/(?:src|href)="([^"?#]+)(?:[^\"]*)"/g)].map((match) => match[1]).filter((path) => path.startsWith('/') && !path.startsWith('//'));
  for (const path of assets) {
    assert.ok(path === `${base}/` || path.startsWith(`${base}/`), `Asset escaped deployment path: ${path}`);
    const file = path.slice(base.length).replace(/^\//, '') || 'index.html';
    await stat(resolve(root, file));
  }
  await Promise.all(['cjic-worker.mjs', 'cjic-engine.mjs', 'vendor/maplibre/6.7.0/maplibre-gl-worker.mjs', '404.html', 'data/local-news/incidents.json', 'data/local-news/articles.json'].map((file) => stat(resolve(root, file))));
  const manifest = JSON.parse(await readFile(resolve(root, 'data/michigan-cjic/prepared/manifest.json'), 'utf8'));
  for (const source of Object.values(manifest.sources)) for (const chunk of source.chunks) await stat(resolve(root, 'data/michigan-cjic/prepared', chunk.file));
});
