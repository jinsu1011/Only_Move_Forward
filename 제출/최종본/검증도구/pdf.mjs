import puppeteer from 'puppeteer-core'; import fs from 'fs'; import path from 'path';
const [html, pdfOut, prevDir] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--allow-file-access-from-files'] });
const p = await b.newPage();
await p.setViewport({ width: 1920, height: 1080 });
await p.goto('file://' + html, { waitUntil: 'load' });
await p.evaluate(() => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
const broken = await p.$$eval('img', is => is.filter(i => !i.naturalWidth).map(i => i.getAttribute('src')));
console.log('broken images', broken);
// 넘침 검사: 슬라이드 안에서 아래로 잘린 요소
const overflow = await p.$$eval('section.slide', ss => ss.map((s, i) => { const r = s.getBoundingClientRect(); let worst = 0; s.querySelectorAll('*').forEach(e => { if (e.closest('.shot')) return; const b = e.getBoundingClientRect(); if (b.height && !e.classList.contains('foot')) worst = Math.max(worst, b.bottom - r.top); }); return [i + 1, Math.round(worst)]; }).filter(([, w]) => w > 1040));
console.log('slides with content below 1040px:', JSON.stringify(overflow));
await p.pdf({ path: pdfOut, width: '1920px', height: '1080px', printBackground: true, pageRanges: '' });
fs.mkdirSync(prevDir, { recursive: true });
const n = await p.$$eval('section.slide', s => s.length);
await p.addStyleTag({ content: '@media screen{.slide{margin:0!important}} body{background:#fff}' });
for (let i = 0; i < n; i++) { const el = (await p.$$('section.slide'))[i]; await el.screenshot({ path: path.join(prevDir, `s${String(i + 1).padStart(2, '0')}.png`) }); }
console.log('slides', n); await b.close();
