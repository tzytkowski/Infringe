import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const port = Number(process.env.PORT || 3001);
const prefix = process.env.NEXT_PUBLIC_BASE_PATH || '';
const root = resolve('out');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mjs': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) {
    response.writeHead(404).end();
    return;
  }
  const relative = pathname.slice(prefix.length).replace(/^\/+/, '') || 'index.html';
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const target = (await stat(file)).isDirectory() ? resolve(file, 'index.html') : file;
    const content = await readFile(target);
    response.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream' }).end(content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Pages preview: http://127.0.0.1:${port}${prefix}/`));
