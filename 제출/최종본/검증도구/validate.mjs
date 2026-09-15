import SwaggerParser from '@apidevtools/swagger-parser';
import { Parser } from '@dbml/core';
import fs from 'fs';
const [yml, dbml] = process.argv.slice(2);
try { const api = await SwaggerParser.validate(yml);
  const ops = Object.entries(api.paths).flatMap(([p, o]) => Object.keys(o).map(m => `${m.toUpperCase()} ${p}`));
  console.log('OPENAPI OK', api.openapi, 'paths', Object.keys(api.paths).length, 'operations', ops.length, 'schemas', Object.keys(api.components.schemas).length);
} catch (e) { console.log('OPENAPI FAIL', e.message); }
try { const db = new Parser().parse(fs.readFileSync(dbml, 'utf8'), 'dbml');
  const s = db.schemas[0]; console.log('DBML OK tables', s.tables.length, 'refs', s.refs.length, 'enums', s.enums.length, 'groups', s.tableGroups.length);
} catch (e) { console.log('DBML FAIL', JSON.stringify(e.diags?.map(d => [d.message, d.location?.start]) ?? e.message)); }
