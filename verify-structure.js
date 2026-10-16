import { existsSync } from 'node:fs';
import { join } from 'node:path';
const expected = ['server.js','package.json','public/index.html'];
const missing = expected.filter(p=>!existsSync(join(process.cwd(),p)));
if(missing.length){console.error('KHÔNG ĐÚNG CẤU TRÚC REPO: thiếu '+missing.join(', ')+' trong '+process.cwd());process.exit(1);}
console.log('OK: repo root, public/index.html, backend are present.');
