const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

const raiz = path.join(__dirname, '..');
const contexto = { window: {} };
vm.runInNewContext(readFileSync(path.join(raiz, 'js/cierre-plantilla-v1.js'), 'utf8'), contexto);
const plantillaInicial = JSON.parse(JSON.stringify(contexto.window.HAIKU_CIERRE_PLANTILLA_V1.base));
const migracion = readFileSync(path.join(raiz, 'supabase/migrations/20261112214058_cierre_plantilla_personificar.sql'), 'utf8');

const esquema = `
create role anon;
create role authenticated;
create schema private;
create schema auth;
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('fixture.uid', true), '')::uuid $$;
create function private.haiku_tiene_permiso(p text) returns boolean language sql stable as $$
select auth.uid() is not null and (
    p in ('cierres.ver', 'cierres.realizar') or
    current_setting('fixture.admin', true) = 'si'
) $$;
grant usage on schema private, auth to authenticated, anon;
create table public.turnos (
    id uuid primary key default gen_random_uuid(), fecha_operativa date not null, tipo_turno text not null,
    estado text, iniciado_por uuid, iniciado_en timestamptz, finalizado_por uuid, finalizado_en timestamptz,
    actualizado_en timestamptz default now(), unique(fecha_operativa, tipo_turno)
);
create table public.cierres_turno (
    id uuid primary key default gen_random_uuid(), turno_id uuid unique references public.turnos(id),
    estado text, snapshot jsonb, novedades text, resumen_entrega text, cerrado_por uuid, cerrado_en timestamptz,
    reabierto_por uuid, reabierto_en timestamptz, actualizado_en timestamptz default now()
);
create table public.cabanas (
    id uuid primary key default gen_random_uuid(), numero smallint not null, activa boolean not null default true
);
create table public.cierre_checklist_items (
    id uuid primary key default gen_random_uuid(), codigo text not null unique, nombre text not null, categoria text not null,
    obligatorio boolean not null, bloquea_cierre boolean not null, permiso_requerido text, activo boolean not null,
    orden_visual integer not null default 0, alcance text not null, tipo_respuesta text not null
);
create table public.cierre_respuestas (
    id uuid primary key default gen_random_uuid(), cierre_id uuid references public.cierres_turno(id),
    item_id uuid references public.cierre_checklist_items(id), cabana_id uuid references public.cabanas(id), estado text,
    valor jsonb, observacion text, confirmado_por uuid, confirmado_en timestamptz, origen text, actualizado_en timestamptz
);
create unique index globales on public.cierre_respuestas(cierre_id,item_id) where cabana_id is null;
create unique index por_cabana on public.cierre_respuestas(cierre_id,item_id,cabana_id) where cabana_id is not null;
create table public.evidencias (
    id uuid primary key default gen_random_uuid(), cierre_id uuid references public.cierres_turno(id),
    storage_bucket text, storage_path text, mime_type text, tamano_bytes bigint, descripcion text, subido_por uuid, creado_en timestamptz
);
grant select on all tables in schema public to authenticated;
grant insert, update on public.turnos, public.cierres_turno, public.cierre_respuestas to authenticated;

CREATE OR REPLACE FUNCTION public.haiku_asegurar_cierre_dia(p_fecha date, p_tipo_turno text DEFAULT 'cierre_diario'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'private', 'auth'
AS $function$
declare
    v_turno public.turnos%rowtype;
    v_cierre public.cierres_turno%rowtype;
begin
    if p_fecha is null then
        raise exception 'La fecha es obligatoria';
    end if;

    if not private.haiku_tiene_permiso('cierres.realizar') then
        raise exception 'Sin permiso para realizar cierres';
    end if;

    insert into public.turnos (
        fecha_operativa,
        tipo_turno,
        estado,
        iniciado_por,
        iniciado_en
    ) values (
        p_fecha,
        coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario'),
        'abierto',
        auth.uid(),
        now()
    )
    on conflict (fecha_operativa, tipo_turno)
    do nothing;

    select * into v_turno
    from public.turnos
    where fecha_operativa = p_fecha
      and tipo_turno = coalesce(nullif(btrim(p_tipo_turno), ''), 'cierre_diario')
    limit 1;

    if v_turno.id is null then
        raise exception 'No fue posible obtener el turno del día';
    end if;

    insert into public.cierres_turno (
        turno_id,
        estado,
        snapshot
    ) values (
        v_turno.id,
        'borrador',
        '{}'::jsonb
    )
    on conflict (turno_id)
    do nothing;

    select * into v_cierre
    from public.cierres_turno
    where turno_id = v_turno.id
    limit 1;

    if v_cierre.id is null then
        raise exception 'No fue posible obtener el cierre del día';
    end if;

    return jsonb_build_object(
        'turno_id', v_turno.id,
        'cierre_id', v_cierre.id,
        'turno_estado', v_turno.estado,
        'cierre_estado', v_cierre.estado,
        'fecha_operativa', v_turno.fecha_operativa,
        'tipo_turno', v_turno.tipo_turno
    );
end;
$function$;
`;

const q = (db, sql, params = []) => db.query(sql, params);
const valor = async (db, sql, params) => (await q(db, 'select ' + sql + ' as resultado', params)).rows[0].resultado;
const llave = 'llave_' + '1'.repeat(32);
const tarea = 'tarea_' + '2'.repeat(32);
const tareaCab = 'cabana_tarea_' + '3'.repeat(32);
const grupo = 'seccion_' + '4'.repeat(32);
const fechaHoy = "(now() at time zone 'America/Santiago')::date";
const fechaAyer = fechaHoy + ' - 1';
const fechaManana = fechaHoy + ' + 1';
const UUID_PUBLICACION = '0a000000-0000-0000-0000-000000000001';
const USUARIO = '0a000000-0000-0000-0000-000000000020';

async function preparar(db) {
    await db.exec(esquema);
    await db.exec('insert into public.cabanas(numero) values (1)');
    const { campos } = contexto.window.HAIKU_CIERRE_PLANTILLA_V1;
    const filas = [
        ...Object.values(campos).map(i => [
            i.codigo, i.texto || i.titulo || i.codigo, i.permiso || null, 'global',
            i.codigo === 'llaves_recepcion' ? 'json' : i.opciones || i.codigo === 'llaves_retiradas' ? 'opcion' : 'booleano'
        ]),
        ['cabana_ocupada', 'Ocupada', null, 'cabana', 'booleano'],
        ...plantillaInicial.cabanas.items.map(i => [i.id, i.texto, null, 'cabana', 'booleano'])
    ];
    for (const [codigo, nombre, permiso, alcance, tipo] of filas) {
        await q(db, `insert into public.cierre_checklist_items(codigo,nombre,categoria,obligatorio,
            bloquea_cierre,permiso_requerido,activo,alcance,tipo_respuesta)
            values ($1,$2,'base',$6,false,$3,true,$4,$5)`,
            [codigo, nombre, permiso, alcance, tipo, codigo !== 'llaves_recepcion']);
    }
    await db.exec(migracion);
    await db.exec(`
CREATE OR REPLACE FUNCTION public.haiku_validar_cierre_turno()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
    v_evaluacion record;
begin
    if new.estado in ('cerrado', 'cerrado_con_pendientes') then
        select * into v_evaluacion from private.haiku_evaluar_cierre(new.id);
        if v_evaluacion.bloqueo_global then
            raise exception 'No se puede cerrar el turno: existen controles globales bloqueantes pendientes';
        end if;
        if v_evaluacion.bloqueo_cabana then
            raise exception 'No se puede cerrar el turno: existen controles de cabaña bloqueantes pendientes';
        end if;
        if new.estado = 'cerrado' and not v_evaluacion.puede_cerrar_limpio then
            raise exception 'Use cerrado_con_pendientes o resuelva todos los controles obligatorios';
        end if;
    end if;
    return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.haiku_validar_respuesta_cierre()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_alcance text;
  v_permiso text;
begin
  select alcance, permiso_requerido
    into v_alcance, v_permiso
  from public.cierre_checklist_items
  where id = new.item_id;

  if v_alcance = 'global' and new.cabana_id is not null then
    raise exception 'Este control de cierre es global y no admite cabaña';
  end if;

  if v_alcance = 'cabana' and new.cabana_id is null then
    raise exception 'Este control de cierre requiere una cabaña';
  end if;

  if auth.uid() is not null and v_permiso is not null and new.estado <> 'pendiente' then
    if not private.haiku_tiene_permiso(v_permiso) then
      raise exception 'No posee el permiso requerido para confirmar este control' using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;
create trigger validar_cierre before update of estado on public.cierres_turno
    for each row execute function public.haiku_validar_cierre_turno();
create trigger validar_respuesta before insert or update on public.cierre_respuestas
    for each row execute function public.haiku_validar_respuesta_cierre();
`);
    await db.exec(`set fixture.uid = '${USUARIO}'; set fixture.admin = 'si'; set role authenticated;`);
}

const publicar = (db, version, solicitud, datos) =>
    valor(db, 'public.haiku_cierre_plantilla_publicar_v1($1,$2,$3::jsonb)', [version, solicitud, JSON.stringify(datos)]);
const turno = (db, fecha) => valor(db, `public.haiku_asegurar_cierre_dia(${fecha})`);
const vigente = (db, id) => valor(db, 'public.haiku_cierre_plantilla_turno_v1($1)', [id]);
const estado = (db, fecha) => valor(db, `public.haiku_estado_cierre_dia(${fecha})`);
const responder = (db, fecha, version, codigo, respuesta, cabana = null) =>
    valor(db, `public.haiku_guardar_respuesta_cierre_personificado_v1(${fecha},$1,
        'confirmado',$2::jsonb,null,$3::smallint,'cierre_diario',$4)`,
    [codigo, JSON.stringify(respuesta), cabana, version]);

test('Plantillas de cierre se publican con permiso, respetan turnos abiertos y mantienen las firmas de Mobile', async () => {
    const db = await PGlite.create();
    try {
        await preparar(db);
        assert.deepEqual(await valor(db, 'public.haiku_cierre_plantilla_editar_v1()'), { version: 1, plantilla: plantillaInicial });
        const previo = await turno(db, fechaAyer);
        const nuevo = await turno(db, fechaHoy);
        await responder(db, fechaAyer, 1, 'registro_guardado', true);
        assert.equal((await estado(db, fechaHoy)).total_requeridos, 24);

        const siguiente = structuredClone(plantillaInicial);
        siguiente.titulo = 'Entrega de recepción';
        siguiente.grupos.find(g => g.id === 'instalaciones').items[0].activo = false;
        siguiente.grupos.find(g => g.id === 'llaves').items[0].activo = false;
        siguiente.grupos.find(g => g.id === 'llaves').items.push({ id: llave, texto: 'Bodega', detalle: 'Plata', activo: true });
        siguiente.grupos.push({ id: grupo, titulo: 'Áreas comunes', items: [{ id: tarea, texto: 'Cerrar portón', activo: true }] });
        siguiente.cabanas.items.push({ id: tareaCab, texto: 'Revisar terraza', activo: true });
        siguiente.entrega.resumen = 'Entrega a recepción';

        await db.exec("set fixture.admin = 'no'");
        await assert.rejects(publicar(db, 1, UUID_PUBLICACION, siguiente), /Sin permiso/);
        await assert.rejects(valor(db, 'public.haiku_cierre_plantilla_editar_v1()'), /Sin permiso/);
        await db.exec("set fixture.admin = 'si'");
        const invalida = structuredClone(siguiente);
        invalida.grupos.find(g => g.id === 'caja').items[1].activo = false;
        await assert.rejects(publicar(db, 1, UUID_PUBLICACION, invalida), /Revisa las tareas/);
        const r = await publicar(db, 1, UUID_PUBLICACION, siguiente);
        assert.equal(r.version, 2);
        assert.deepEqual(await publicar(db, 1, UUID_PUBLICACION, siguiente), r);
        await assert.rejects(publicar(db, 1, '0a000000-0000-0000-0000-000000000002', siguiente), /cambió en otra sesión/);

        assert.deepEqual(await vigente(db, previo.cierre_id), { version: 1, plantilla: plantillaInicial, fijada: true });
        assert.deepEqual(await vigente(db, nuevo.cierre_id), { version: 2, plantilla: siguiente, fijada: false });
        assert.equal((await estado(db, fechaHoy)).total_requeridos, 25);
        await assert.rejects(responder(db, fechaHoy, 1, 'registro_guardado', true), /plantilla del turno cambió/);
        await assert.rejects(responder(db, fechaHoy, 2, 'tinaja_tonel_apagado', true), /no está activo/);
        await assert.rejects(responder(db, fechaAyer, 1, tarea, true), /no está activo/);

        await responder(db, fechaHoy, 2, tarea, true);
        await responder(db, fechaHoy, 2, tareaCab, true, 1);
        await responder(db, fechaHoy, 2, 'llaves_recepcion', { [llave]: true });
        const baseLlaves = Object.fromEntries(plantillaInicial.grupos.find(g => g.id === 'llaves').items.map((k, i) => [k.id, i !== 0]));
        await valor(db, `public.haiku_guardar_respuesta_cierre(${fechaHoy},'llaves_recepcion','confirmado',$1::jsonb)`,
            [JSON.stringify(baseLlaves)]);
        assert.equal((await estado(db, fechaHoy)).completados, 3);
        const llaves = await valor(db, `(select valor from public.cierre_respuestas r
            join public.cierre_checklist_items i on i.id=r.item_id where r.cierre_id=$1 and i.codigo='llaves_recepcion')`, [nuevo.cierre_id]);
        assert.equal(llaves[llave], true);
        await assert.rejects(responder(db, fechaHoy, 2, 'llaves_retiradas', 'si'), /Confirma las llaves/);
        await responder(db, fechaHoy, 2, 'llaves_recepcion', { [llave]: false });
        assert.equal((await estado(db, fechaHoy)).completados, 2);

        const tercera = { ...siguiente, titulo: 'Nuevo título para futuros turnos' };
        assert.equal((await publicar(db, 2, '0a000000-0000-0000-0000-000000000003', tercera)).version, 3);
        assert.equal((await vigente(db, nuevo.cierre_id)).version, 2);
        assert.equal((await vigente(db, (await turno(db, fechaManana)).cierre_id)).version, 3);

        await assert.rejects(valor(db, `public.haiku_cerrar_turno_personificado_v1(${fechaHoy},null,'cierre_diario',2)`), /resumen de entrega/);
        await valor(db, `public.haiku_guardar_novedades_cierre(${fechaHoy},'Novedad')`);
        const final = await valor(db, `public.haiku_cerrar_turno_personificado_v1(${fechaHoy},'Entrega','cierre_diario',2)`);
        assert.equal(final.cierre_estado, 'cerrado_con_pendientes');
        assert.equal(final.plantilla_version, 2);
        const snapshot = await valor(db, '(select snapshot from public.cierres_turno where id=$1)', [nuevo.cierre_id]);
        assert.equal(snapshot.plantilla_version, 2);
        assert.ok(snapshot.respuestas.some(fila => fila.nombre === 'Cerrar portón'));
        await assert.rejects(responder(db, fechaHoy, 2, tarea, true), /no admite edición/);
        await db.exec('reset role; set role anon');
        await assert.rejects(valor(db, 'public.haiku_cierre_plantilla_editar_v1()'), /permission denied/);
    } finally {
        await db.close();
    }
});
