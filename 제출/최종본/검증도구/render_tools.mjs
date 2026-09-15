import { Parser } from '@dbml/core';
import puppeteer from 'puppeteer-core';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
const [dbmlPath, ymlPath, out] = process.argv.slice(2);
const T = process.cwd();
const db = new Parser().parse(fs.readFileSync(dbmlPath, 'utf8'), 'dbml').schemas[0];
const refs = db.refs.map(r => { const [a, b] = r.endpoints; return { from: a.tableName, fromF: a.fieldNames[0], fromRel: a.relation, to: b.tableName, toF: b.fieldNames[0], toRel: b.relation }; });
const fkOf = new Set(refs.flatMap(r => [r.fromRel === '*' ? `${r.from}.${r.fromF}` : null, r.toRel === '*' ? `${r.to}.${r.toF}` : null, (r.fromRel === '1' && r.toRel === '1') ? (r.fromF !== 'id' ? `${r.from}.${r.fromF}` : `${r.to}.${r.toF}`) : null]).filter(Boolean));
const pkComposite = t => (t.indexes || []).filter(i => i.pk).flatMap(i => i.columns.map(c => c.value));
function mermaid(tables, withCols, extraTables = []) {
  const names = new Set(tables.map(t => t.name));
  let s = 'erDiagram\n';
  for (const t of tables) {
    s += `  ${t.name} {\n`;
    const cpk = pkComposite(t);
    for (const f of t.fields) {
      const keys = [];
      if (f.pk || cpk.includes(f.name)) keys.push('PK');
      if (fkOf.has(`${t.name}.${f.name}`)) keys.push('FK');
      if (f.unique && !f.pk) keys.push('UK');
      const typ = f.type.type_name.replace(/\((\d+)\)/, '($1)').replace(/[^A-Za-z0-9_()]/g, '_');
      if (withCols || keys.length) s += `    ${typ} ${f.name}${keys.length ? ' ' + keys.join(',') : ''}\n`;
    }
    s += '  }\n';
  }
  for (const n of extraTables) s += `  ${n} {\n    uuid id PK\n  }\n`;
  const all = new Set([...names, ...extraTables]);
  for (const r of refs) {
    if (!all.has(r.from) || !all.has(r.to)) continue;
    if (!names.has(r.from) && !names.has(r.to)) continue;
    // r.from(*) -> r.to(1) : many-to-one
    const one = r.fromRel === '*' ? r.to : r.from, many = r.fromRel === '*' ? r.from : r.to, fk = r.fromRel === '*' ? r.fromF : r.toF;
    const card = r.fromRel === '1' && r.toRel === '1' ? '||--o|' : '||--o{';
    const oneT = (r.fromRel === '1' && r.toRel === '1') ? (r.fromF === 'id' ? r.from : r.to) : one, manyT = (r.fromRel === '1' && r.toRel === '1') ? (r.fromF === 'id' ? r.to : r.from) : many;
    s += `  ${oneT} ${card} ${manyT} : "${fk}"\n`;
  }
  return s;
}
const diagrams = { 'ERD_전체': mermaid(db.tables, true) };
for (const g of db.tableGroups) {
  const tabs = g.tables.map(x => db.tables.find(t => t.name === (x.tableName ?? x.name)));
  const names = new Set(tabs.map(t => t.name));
  const ext = [...new Set(refs.flatMap(r => names.has(r.from) && !names.has(r.to) ? [r.to] : names.has(r.to) && !names.has(r.from) ? [r.from] : []))];
  diagrams[`ERD_그룹_${g.name}`] = mermaid(tabs, true, ext);
}
fs.mkdirSync(path.join(T, 'erd'), { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--no-first-run', '--allow-file-access-from-files'] });
const page = await browser.newPage();
for (const [name, src] of Object.entries(diagrams)) {
  fs.writeFileSync(path.join(T, 'erd', name + '.mmd'), src);
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff"><pre class="mermaid">${src.replace(/</g, '&lt;')}</pre>
<script src="file://${T}/node_modules/mermaid/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:false, theme:'neutral', er:{fontSize:14, useMaxWidth:false}, fontFamily:'Apple SD Gothic Neo, sans-serif'});
mermaid.run().then(()=>{document.title='done'}).catch(e=>{document.title='err:'+e.message});</script>`;
  const f = path.join(T, 'erd', name + '.html'); fs.writeFileSync(f, html);
  await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
  await page.goto('file://' + f); await page.waitForFunction(() => document.title.length > 0, { timeout: 30000 });
  const title = await page.title(); if (title !== 'done') { console.log(name, title); continue; }
  const el = await page.$('pre.mermaid svg'); const box = await el.boundingBox();
  await page.setViewport({ width: Math.ceil(box.width) + 20, height: Math.ceil(box.height) + 20, deviceScaleFactor: 2 });
  await (await page.$('pre.mermaid svg')).screenshot({ path: path.join(out, name + '.png') });
  console.log('ERD', name, Math.round(box.width), 'x', Math.round(box.height));
}
// Swagger UI (로컬 파일, 외부 전송 없음)
const spec = yaml.load(fs.readFileSync(ymlPath, 'utf8'));
const sw = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${T}/node_modules/swagger-ui-dist/swagger-ui.css"><body><div id="ui"></div>
<script src="file://${T}/node_modules/swagger-ui-dist/swagger-ui-bundle.js"></script>
<script>window.errs=[];const ui=SwaggerUIBundle({spec:${JSON.stringify(spec)},dom_id:'#ui',deepLinking:false,defaultModelsExpandDepth:-1,onComplete:()=>{document.title='done'}});</script>`;
const swf = path.join(T, 'swagger.html'); fs.writeFileSync(swf, sw);
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 });
await page.goto('file://' + swf); await page.waitForFunction(() => document.title === 'done', { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
const errBox = await page.$('.errors-wrapper'); console.log('swagger errors box:', errBox ? await page.$eval('.errors-wrapper', e => e.innerText.slice(0, 300)) : 'none');
const opCount = await page.$$eval('.opblock', e => e.length); console.log('swagger rendered operations', opCount);
await page.screenshot({ path: path.join(out, 'Swagger_API목록.png'), fullPage: true });
await page.click('#operations-driving-createTrainingSession .opblock-summary'); await new Promise(r => setTimeout(r, 600));
const op = await page.$('#operations-driving-createTrainingSession'); await op.screenshot({ path: path.join(out, 'Swagger_주행시작_상세.png') });
await browser.close();
