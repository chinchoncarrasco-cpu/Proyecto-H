const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib'), crypto = require('node:crypto');
const root = path.join(__dirname, 'fixtures');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

// ZIP local: revisar todas las partes, comentarios y entradas, sin dependencias ni red.
function partesZip(bytes) {
    let eocd = bytes.length - 22;
    while (eocd >= 0 && bytes.readUInt32LE(eocd) !== 0x06054b50) eocd--;
    assert.ok(eocd >= 0); assert.equal(bytes.readUInt16LE(eocd + 20), 0, 'comentario del ZIP');
    const count = bytes.readUInt16LE(eocd + 10), entries = new Map();
    let cursor = bytes.readUInt32LE(eocd + 16);
    for (let i = 0; i < count; i++) {
        assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
        const method = bytes.readUInt16LE(cursor + 10), compressed = bytes.readUInt32LE(cursor + 20);
        const size = bytes.readUInt32LE(cursor + 24), nameLength = bytes.readUInt16LE(cursor + 28);
        const extraLength = bytes.readUInt16LE(cursor + 30), commentLength = bytes.readUInt16LE(cursor + 32);
        assert.equal(commentLength, 0, 'comentario de entrada');
        assert.equal(bytes.readUInt16LE(cursor + 8) & 1, 0, 'entrada cifrada no revisable');
        const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        const local = bytes.readUInt32LE(cursor + 42); assert.equal(bytes.readUInt32LE(local), 0x04034b50);
        const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
        const packed = bytes.subarray(start, start + compressed);
        assert.ok(method === 0 || method === 8, 'compresión no revisada');
        const data = method === 8 ? zlib.inflateRawSync(packed) : packed; assert.equal(data.length, size);
        if (!name.endsWith('/')) { assert.ok(!entries.has(name)); entries.set(name, data.toString('utf8')); }
        cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
const partesPermitidas = ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels',
    'xl/sharedStrings.xml', 'xl/styles.xml', 'xl/theme/theme1.xml', 'xl/workbook.xml', 'xl/worksheets/sheet58.xml'];

function revisarIdentificadores(texto) {
    for (const m of texto.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) assert.match(m[0], /^contacto\d{6}@example\.invalid$/);
    for (const m of texto.matchAll(/\+\d[\d ()-]{6,}\d/g)) assert.match(m[0], /^\+56 9 000\d{5}$/);
    for (const m of texto.matchAll(/\b\d{1,2}(?:\.\d{3}){2}-[\dkK]\b|\b\d{6,9}-[\dkK]\b/g)) {
        assert.match(m[0], /^99\.000\.\d{3}-[01]$/);
        const [n, digit] = m[0].replaceAll('.', '').split('-'); let sum = 0, factor = 2;
        for (const ch of [...n].reverse()) { sum += Number(ch) * factor; factor = factor === 7 ? 2 : factor + 1; }
        const d = 11 - sum % 11, correcto = d === 11 ? '0' : d === 10 ? 'K' : String(d);
        assert.notEqual(digit, correcto, 'el RUT ficticio no puede ser un documento válido');
    }
    for (const m of texto.matchAll(/\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/gi))
        assert.match(m[0], /^00000000-0000-4000-9000-\d{12}$/);
    assert.doesNotMatch(texto, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_|github_pat_|\bghp_[\w]{20,}|\bAKIA[A-Z0-9]{16}/);
}
for (const base of ['libro-jonathan-real', 'libro-reconciliacion-oct26-real']) test(`${base}: JSON/XLSX anonimizados, sin contactos reales ni partes privadas ocultas`, () => {
    const data = JSON.parse(fs.readFileSync(path.join(root, base + '.json'), 'utf8'));
    const bytes = fs.readFileSync(path.join(root, base + '.xlsx')), parts = partesZip(bytes);
    assert.equal(data.origen.anonimizacion.version, 1); assert.equal(data.origen.anonimizacion.tipo, 'derivado_anonimizado');
    assert.equal(data.origen.drive_id, undefined); assert.equal(data.origen.hoja, 'Oct26');
    assert.equal(hash(bytes), data.origen.sha256_fixture || data.origen.sha256_fixture_xlsx);
    assert.deepEqual([...parts.keys()].sort(), [...partesPermitidas].sort(), 'incluye sólo las ocho partes revisadas; sin autores, comentarios, vínculos ni embeddings');
    for (const xml of parts.values()) revisarIdentificadores(xml);
    revisarIdentificadores(JSON.stringify(data));
    assert.equal((parts.get('xl/workbook.xml').match(/<sheet\b/g) || []).length, 68, 'conserva las declaraciones de hojas, incluidas las ocultas');
    assert.match(parts.get('xl/workbook.xml'), /name="Oct26"/);
    for (const c of data.hoja.celdas) if (c.runs) assert.equal(c.runs.map(r => r.texto).join(''), c.valor);
    for (const r of data.db?.reservas || []) assert.match(r.titular_nombre, /^(?:Ficticio[a-z]+ Apellido[a-z]+|NO SHOW)$/i);
    for (const a of data.antes || []) assert.match(a.titular, /^Ficticio[a-z]+ Apellido[a-z]+$/i);
});
