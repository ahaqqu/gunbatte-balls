import http from 'http';
import fs from 'fs';
import path from 'path';
const root = process.cwd();
http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.join(root, u.slice(1));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(f);
    const ct = ext === '.html' ? 'text/html' : (ext === '.js' || ext === '.mjs') ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.json' ? 'application/json' : ext === '.png' ? 'image/png' : ext === '.zip' ? 'application/zip' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct });
    res.end(d);
  });
}).listen(8907, () => console.log('GunBatte Balls at http://localhost:8907/'));
