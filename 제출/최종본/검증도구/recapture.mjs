// 이미 만든 데모 계정으로 로그인해 AI 해설 결과 화면과 주행 결과 화면을 다시 캡처한다.
import puppeteer from 'puppeteer-core';
import path from 'path';

const [OUT, EMAIL, ANSWER_ID, SESSION_ID] = process.argv.slice(2);
const BASE = 'http://127.0.0.1:5180';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
await page.type('#email', EMAIL);
await page.type('#pw', 'drive2026');
await (await page.$('form button.primary')).click();
await page.waitForFunction(() => location.pathname === '/app');

await page.goto(`${BASE}/written/answers/${ANSWER_ID}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.body.innerText.includes('다시 요청') || (document.body.innerText.includes('인용') && !document.body.innerText.includes('작성하는 중')), { timeout: 30000 }).catch(() => console.log('AI 결과 표시 없음'));
await sleep(800);
await page.screenshot({ path: path.join(OUT, 'C-10_AI오답해설.png'), fullPage: true });
console.log('shot C-10');

await page.goto(`${BASE}/drive/result/${SESSION_ID}`, { waitUntil: 'networkidle0' });
await sleep(4000);
await page.screenshot({ path: path.join(OUT, 'C-18_주행_결과.png'), fullPage: true });
console.log('shot C-18');
await browser.close();
