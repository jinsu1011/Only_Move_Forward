// 실행 중인 웹(5180)을 실제로 조작하며 화면을 캡처한다. 데모 계정은 가상 이메일만 사용한다.
import puppeteer from 'puppeteer-core';
import path from 'path';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5180';
const EMAIL = `demo${Date.now().toString(36)}@example.com`;
const PW = 'drive2026';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
const apiLog = [];
page.on('response', (r) => { if (r.url().includes('/api/v1/')) apiLog.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
page.on('pageerror', (e) => log('PAGE ERROR', e.message));

async function shot(name, full = false) {
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
  log('shot', name);
}
async function clickText(sel, text, timeout = 15000) {
  const h = await page.waitForFunction(
    (s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.includes(t) && !e.disabled),
    { timeout }, sel, text,
  );
  await h.asElement().click();
}
const go = (p) => page.goto(BASE + p, { waitUntil: 'networkidle0' });

// 1. 소개
await go('/');
await shot('C-01_서비스소개');

// 2. 회원가입 (입력 오류 → 정상)
await go('/signup');
await page.type('#email', EMAIL);
await page.type('#pw', 'short');
await page.type('#nick', '초보운전');
await shot('C-02_회원가입_비밀번호규칙');
await page.click('#pw', { clickCount: 3 });
await page.type('#pw', PW);
await clickText('button', '가입하고 시작하기');
await page.waitForFunction(() => location.pathname === '/app');
await sleep(800);
await shot('C-04_대시보드_첫방문');

// 3. 로그인 오류 (별도 시크릿 창)
const ctx = await browser.createBrowserContext();
const p2 = await ctx.newPage();
await p2.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 });
await p2.goto(BASE + '/login', { waitUntil: 'networkidle0' });
await p2.type('#email', EMAIL);
await p2.type('#pw', 'wrong2026');
await (await p2.$('form button.primary')).click();
await p2.waitForSelector('.notice.red', { timeout: 10000 });
await sleep(400);
await p2.screenshot({ path: path.join(OUT, 'C-03_로그인_오류.png') });
log('shot C-03_로그인_오류');
await ctx.close();

// 4. 필기 연습
await go('/written');
await clickText('button', '10문항');
await shot('C-05_필기_설정');
await clickText('button.btn.lg.primary', '');
await page.waitForFunction(() => /\/written\/attempts\/[^/]+$/.test(location.pathname));
await page.waitForSelector('.option');
const total = await page.$$eval('.qnav button, [class*="answered"], .grid button', () => 0).catch(() => 0);
for (let i = 0; i < 40; i++) {
  const opts = await page.$$('.option');
  await opts[(i * 3) % opts.length].click();
  await sleep(350);
  if (i === 2) await shot('C-06_필기_문제풀이');
  const next = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('다음 →') && !b.disabled));
  if (!next.asElement()) break;
  await next.asElement().click();
  await sleep(250);
}
await clickText('button', '제출하기');
await sleep(400);
await shot('C-07_필기_제출확인');
await clickText('button', '제출하고 채점');
await page.waitForFunction(() => location.pathname.endsWith('/result'));
await sleep(800);
await shot('C-08_필기_결과', true);

// 5. 오답 해설 + AI 해설
const wrong = await page.evaluateHandle(() => [...document.querySelectorAll('a')].find((a) => a.textContent.includes('오답 해설 보기')));
if (wrong.asElement()) await wrong.asElement().click();
else await (await page.$('a[href^="/written/answers/"]')).click();
await page.waitForFunction(() => location.pathname.startsWith('/written/answers/'));
await sleep(800);
await shot('C-09_오답해설', true);
await clickText('button.btn.primary.block', '');
log('AI 해설 요청');
await page.waitForFunction(
  () => !document.querySelector('button.btn.primary.block') || document.body.innerText.includes('다시 요청') || document.body.innerText.includes('실패'),
  { timeout: 90000 },
).catch(() => log('AI 해설 대기 시간 초과'));
await sleep(1000);
await shot('C-10_AI오답해설', true);

// 6. 주행 홈 → 도로 코스 키보드 준비
await go('/drive');
await clickText('.seg button', '키보드');
await sleep(300);
await shot('C-11_주행_코스선택', true);
const setupLinks = await page.$$eval('a[href^="/drive/setup/"]', (as) => as.map((a) => ({ href: a.getAttribute('href'), text: a.closest('.card')?.innerText ?? '' })));
const road = setupLinks.find((l) => l.text.includes('도로')) ?? setupLinks[setupLinks.length - 1];
const func = setupLinks.find((l) => l.text.includes('기본조작')) ?? setupLinks[0];

// 센서 연결 화면(연결 전 상태)
await go(road.href);
await clickText('.seg button', '센서');
await sleep(600);
await shot('C-12_센서_연결안내');
await clickText('.seg button', '키보드');
await page.keyboard.press('KeyR');
await sleep(400);
await shot('C-13_키보드_입력확인_전');
for (const k of ['KeyA', 'KeyD', 'KeyW', 'KeyS']) { await page.keyboard.press(k); await sleep(200); }
await sleep(400);
await shot('C-14_키보드_READY');

// 7. 도로주행
await page.keyboard.press('Enter');
await page.waitForFunction(() => location.pathname.startsWith('/drive/session/'), { timeout: 15000 });
log('주행 시작');
await sleep(1200);
await shot('C-15_주행_카운트다운');
await sleep(3000);
await page.keyboard.down('KeyW');
await sleep(7000);
await shot('C-16_도로주행_진행');
await page.keyboard.up('KeyW');
await page.keyboard.press('Escape');
await sleep(600);
await shot('C-17_주행_일시정지');
await clickText('button', '계속 주행');
await sleep(800);
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyA');
await sleep(2500);
await page.keyboard.up('KeyA');
await sleep(3000);
await page.keyboard.up('KeyW');
await sleep(500);
await clickText('button', '주행 종료');
await page.waitForFunction(() => location.pathname.startsWith('/drive/result/'), { timeout: 60000 });
await sleep(1200);
await shot('C-18_주행_결과', true);

// 8. 기본조작 코스도 한 번(결과 다양화)
await go(func.href);
await page.keyboard.press('Enter');
await page.waitForFunction(() => location.pathname.startsWith('/drive/session/'), { timeout: 15000 }).catch(() => log('기본조작 시작 실패'));
await sleep(4200);
await page.keyboard.down('KeyW');
await sleep(5000);
await shot('C-19_기본조작_진행');
await page.keyboard.up('KeyW');
await clickText('button', '주행 종료');
await page.waitForFunction(() => location.pathname.startsWith('/drive/result/'), { timeout: 60000 }).catch(() => {});
await sleep(800);

// 9. AI 리포트
await go('/report');
await shot('C-20_AI리포트_생성전');
await clickText('button.btn.lg.primary', '');
log('AI 리포트 요청');
await page.waitForFunction(() => document.querySelectorAll('h2').length && !document.body.innerText.includes('아직 리포트가 없습니다') && !document.querySelector('button.btn.lg.primary[disabled]'), { timeout: 120000 }).catch(() => log('리포트 대기 시간 초과'));
await sleep(1500);
await shot('C-21_AI리포트', true);

// 10. 기록이 쌓인 대시보드
await go('/app');
await sleep(800);
await shot('C-22_대시보드_기록', true);

// 11. 없는 주소
await go('/not-found-page');
await shot('C-23_없는페이지');

console.log('API calls:\n' + [...new Set(apiLog)].join('\n'));
await browser.close();
