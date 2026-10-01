const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const anterior = read('supabase/migrations/20260907150000_listado_reservas_operativo_v1.sql');
const actual = read('supabase/migrations/20261001173412_corregir_listado_titular_reserva.sql');

function reemplazarUnaVez(fuente, original, reemplazo, etiqueta) {
    assert.equal(fuente.split(original).length - 1, 1, `${etiqueta}: bloque base único`);
    return fuente.replace(original, reemplazo);
}

function limpiar(valor) {
    const limpio = String(valor || '').trim();
    return limpio || null;
}

function proyectarListado({ reserva, huesped, resto = {} }) {
    const titularReserva = limpiar(reserva.titular_nombre);
    const nombre = titularReserva || limpiar(huesped.nombre);
    const apellido = titularReserva ? null : limpiar(huesped.apellido);
    const busqueda = [
        nombre,
        apellido,
        titularReserva,
        limpiar(huesped.nombre),
        limpiar(huesped.apellido),
        limpiar(reserva.codigo_haiku),
        resto.cabanas,
        resto.correo,
        resto.telefono,
        resto.documento,
        resto.estado,
        resto.plan_tarifario
    ].filter(Boolean).join(' ').toLowerCase();
    return {
        nombre,
        apellido,
        encuentra: termino => busqueda.includes(String(termino).trim().toLowerCase())
    };
}

test('la migration conserva firma, volatilidad, invocador y privilegio mínimo', () => {
    const cabecera = actual.slice(0, actual.indexOf('\n)\nreturns jsonb'));
    assert.equal((cabecera.match(/^\s+p_[a-z_]+/gm) || []).length, 17);
    assert.match(actual, /returns jsonb\nlanguage sql\nstable\nsecurity invoker\n/);
    assert.match(actual, /revoke all on function public\.haiku_listar_reservas_v1\([\s\S]*?\) from public;/);
    assert.match(actual, /revoke all on function public\.haiku_listar_reservas_v1\([\s\S]*?\) from anon;/);
    assert.equal((actual.match(/grant execute on function public\.haiku_listar_reservas_v1\(/g) || []).length, 1);
    assert.match(actual, /grant execute on function public\.haiku_listar_reservas_v1\([\s\S]*?\) to authenticated;/);
    assert.doesNotMatch(actual, /\b(?:insert into|update|delete from)\b/i);
});

test('el titular operativo de la reserva gana y no mezcla el apellido histórico', () => {
    const fila = proyectarListado({
        reserva: { titular_nombre: 'Nombre Reserva', codigo_haiku: 'H-20261027-01-172EE2' },
        huesped: { nombre: 'Nombre Antiguo', apellido: 'Apellido Antiguo' }
    });
    assert.equal(fila.nombre, 'Nombre Reserva');
    assert.equal(fila.apellido, null);
    assert.equal([fila.nombre, fila.apellido].filter(Boolean).join(' '), 'Nombre Reserva');
});

test('busca por titular de reserva, alias maestro y codigo_haiku; el fallback maestro sigue vigente', () => {
    const fila = proyectarListado({
        reserva: { titular_nombre: 'Nombre Reserva', codigo_haiku: 'H-20261027-01-172EE2' },
        huesped: { nombre: 'Nombre Antiguo', apellido: 'Apellido Antiguo' }
    });
    assert.equal(fila.encuentra('Nombre Reserva'), true);
    assert.equal(fila.encuentra('Nombre Antiguo'), true);
    assert.equal(fila.encuentra('H-20261027-01-172EE2'), true);

    const fallback = proyectarListado({
        reserva: { titular_nombre: '   ', codigo_haiku: 'H-FALLBACK' },
        huesped: { nombre: 'Nombre Antiguo', apellido: 'Apellido Antiguo' }
    });
    assert.equal(fallback.nombre, 'Nombre Antiguo');
    assert.equal(fallback.apellido, 'Apellido Antiguo');
});

test('paginación, filtros, montos y catálogos quedan iguales fuera del cambio focalizado', () => {
    let esperada = anterior;
    esperada = reemplazarUnaVez(esperada,
        `    coalesce(nullif(btrim(h.nombre), ''), nullif(btrim(r.titular_nombre), '')) as nombre,
    nullif(btrim(h.apellido), '') as apellido,`,
        `    coalesce(nullif(btrim(r.titular_nombre), ''), nullif(btrim(h.nombre), '')) as nombre,
    case
      when nullif(btrim(r.titular_nombre), '') is null
        then nullif(btrim(h.apellido), '')
      else null::text
    end as apellido,
    nullif(btrim(r.titular_nombre), '') as busqueda_titular_reserva,
    nullif(btrim(r.codigo_haiku), '') as busqueda_codigo_haiku,
    nullif(btrim(h.nombre), '') as busqueda_huesped_nombre,
    nullif(btrim(h.apellido), '') as busqueda_huesped_apellido,`,
        'prioridad visible');
    esperada = reemplazarUnaVez(esperada,
        `         b.nombre,
         b.apellido,
         b.cabanas,`,
        `         b.nombre,
         b.apellido,
         b.busqueda_titular_reserva,
         b.busqueda_huesped_nombre,
         b.busqueda_huesped_apellido,
         b.busqueda_codigo_haiku,
         b.cabanas,`,
        'alias de búsqueda');
    esperada = reemplazarUnaVez(esperada,
        `      select jsonb_agg(to_jsonb(p) - 'orden_interno' order by p.orden_interno)
      from pagina p`,
        `      select jsonb_agg(
        to_jsonb(p)
          - 'orden_interno'
          - 'busqueda_titular_reserva'
          - 'busqueda_codigo_haiku'
          - 'busqueda_huesped_nombre'
          - 'busqueda_huesped_apellido'
        order by p.orden_interno
      )
      from pagina p`,
        'campos internos fuera del JSON');

    assert.equal(actual.trim(), esperada.trim());
    for (const contrato of [
        /limit least\(greatest\(coalesce\(p_limite, 25\), 1\), 100\)/,
        /offset greatest\(coalesce\(p_offset, 0\), 0\)/,
        /p_estado[\s\S]*?r\.estado_reserva = p_estado/,
        /p_categoria = any\(coalesce\(e\.categorias, array\[\]::text\[\]\)\)/,
        /s\.total_alojamiento[^\n]*precio_total/,
        /s\.pagado_alojamiento[^\n]*abono/,
        /s\.saldo_alojamiento[^\n]*saldo_pendiente/,
        /'categorias_disponibles'/,
        /'estados_disponibles'/
    ]) assert.match(actual, contrato);
});
