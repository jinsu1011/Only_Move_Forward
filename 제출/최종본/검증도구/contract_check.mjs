// 수집한 실제 응답을 OpenAPI 응답 스키마로 검증한다. 명세에 없는 필드도 찾아낸다(additionalProperties 엄격 모드).
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import fs from 'fs';

const [yml, dump] = process.argv.slice(2);
const api = await SwaggerParser.dereference(yml);
const calls = JSON.parse(fs.readFileSync(dump, 'utf8'));

// OpenAPI 3.0 → JSON Schema: nullable 처리, 선언 안 된 필드 금지(명시적으로 허용한 곳 제외)
function conv(s, strict) {
  if (Array.isArray(s)) return s.map((x) => conv(x, strict));
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (['example', 'examples', 'readOnly', 'writeOnly', 'nullable', 'xml', 'discriminator'].includes(k)) continue;
    o[k] = ['properties'].includes(k) ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, conv(pv, strict)])) : conv(v, strict);
  }
  if (strict && o.type === 'object' && o.properties && o.additionalProperties === undefined && !s.allOf) o.additionalProperties = false;
  if (s.nullable) return { anyOf: [{ type: 'null' }, o] };
  return o;
}
// allOf 합성 스키마는 additionalProperties=false 를 쓰면 서로 막으므로, 병합한 뒤 검사한다
function merge(s) {
  if (Array.isArray(s)) return s.map(merge);
  if (!s || typeof s !== 'object') return s;
  let o = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, merge(v)]));
  if (o.allOf) {
    const parts = o.allOf; delete o.allOf;
    const m = { type: 'object', properties: {}, required: [] };
    for (const p of [...parts, o]) {
      if (p.properties) Object.assign(m.properties, p.properties);
      if (p.required) m.required.push(...p.required);
      for (const k of ['description', 'nullable', 'additionalProperties', 'enum', 'type', 'format', 'items', 'oneOf']) if (p[k] !== undefined && k !== 'type') m[k] = p[k];
      if (p.type && p.type !== 'object') m.type = p.type;
    }
    if (!Object.keys(m.properties).length) delete m.properties;
    if (!m.required.length) delete m.required;
    o = m;
  }
  return o;
}

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
let fail = 0;
const covered = new Set();
for (const c of calls) {
  const op = api.paths[c.path]?.[c.method];
  if (!op) { console.log('NO OPERATION', c.method, c.path); fail++; continue; }
  covered.add(`${c.method.toUpperCase()} ${c.path} ${c.status}`);
  const resp = op.responses[String(c.status)];
  if (!resp) { console.log('UNDOCUMENTED STATUS', c.method, c.path, c.status); fail++; continue; }
  const schema = resp.content?.['application/json']?.schema;
  if (!schema) { if (c.body !== null) { console.log('BODY NOT DOCUMENTED', c.method, c.path, c.status); fail++; } continue; }
  const v = ajv.compile(conv(merge(schema), true));
  if (!v(c.body)) {
    fail++;
    console.log('MISMATCH', c.method, c.path, c.status);
    for (const e of v.errors.slice(0, 8)) console.log('   ', e.instancePath || '/', e.message, JSON.stringify(e.params));
  }
}
const allOps = Object.entries(api.paths).flatMap(([p, o]) => Object.keys(o).map((m) => `${m.toUpperCase()} ${p}`));
const hitOps = new Set([...covered].map((x) => x.split(' ').slice(0, 2).join(' ')));
console.log(`calls ${calls.length}, operations exercised ${hitOps.size}/${allOps.length}, failures ${fail}`);
const missing = allOps.filter((o) => !hitOps.has(o));
if (missing.length) console.log('not exercised:', missing.join(', '));
process.exit(fail ? 1 : 0);
