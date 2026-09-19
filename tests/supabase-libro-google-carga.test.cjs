const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const panel = fs.readFileSync(require.resolve('../panel.html'), 'utf8');
const fecha = fs.readFileSync(require.resolve('../js/supabase-fecha-operativa-v1.js'), 'utf8');
const google = fs.readFileSync(require.resolve('../js/supabase-libro-google-readonly-v1.js'), 'utf8');

test('el panel carga directamente el conector Google después del lector del Libro',()=>{
 const lector=panel.indexOf("'supabase-libro-reserva-v1'");
 const conector=panel.indexOf("'supabase-libro-google-readonly-v1'");
 const semantica=panel.indexOf("'haiku-libro-semantica-v1'");
 assert.ok(lector>=0&&conector>lector&&semantica>conector);
 assert.doesNotMatch(fecha,/supabase-libro-google-readonly-v1|data-haiku-libro-google-v1/);
});

test('el conector conserva acceso Drive de sólo lectura y construye su control visible',()=>{
 assert.match(google,/drive\.readonly/);
 assert.match(google,/id="haiku-libro-google-conectar">Conectar Google/);
 assert.match(google,/Fuente fijada por ID\. Nunca escribe ni modifica el archivo de Google/);
 assert.doesNotMatch(google,/files\.(?:create|update|delete)|method\s*:\s*["'](?:POST|PATCH|PUT|DELETE)/i);
});
