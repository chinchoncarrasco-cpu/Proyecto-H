const assert = require("node:assert/strict");
const fs = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");

const leer = path => fs.readFileSync(path, "utf8");
const ids = Object.fromEntries(["usuario", "reserva", "otra", "estadia", "estadia2", "cabana", "catalogo", "recurso",
    "servicio", "conflicto", "pago", "cargo", "pago2", "cargo2"].map((k, i) =>
    [k, "00000000-0000-4000-8000-" + String(i + 1).padStart(12, "0")]));
const version = "2026-09-10T10:00:00+00:00";

async function probar() {
    const db = new PGlite();
    const consulta = (sql, params) => db.query(sql, params);
    const dato = async (sql, params) => (await consulta(sql, params)).rows[0];
    try {
        await db.exec(leer("tests/fixtures/bove-schema.sql") + `
          grant usage on schema public, private, auth to authenticated, anon;
          create or replace function private.haiku_tiene_permiso(p text) returns boolean language sql as $$
            select coalesce(current_setting('haku.test_permit',true),'on') <> 'off'
          $$;
          create function private.haiku_usuario_activo() returns boolean language sql as $$ select auth.uid() is not null $$;
          create function private.haiku_libro_lock_key_v1(text,text) returns bigint language sql as
            $$ select hashtextextended($1 || ':' || $2,0) $$;

          alter table public.reservas add column estado_reserva text, add column grupo_reserva_id uuid, add column titular_nombre text,
            add column titular_huesped_id uuid, add column titular_numero_documento text, add column correo_contacto text,
            add column telefono_contacto text, add column observaciones text;
          create table public.cabanas (id uuid primary key,numero smallint,activa boolean,precio_base bigint);
          create table public.reserva_estadias (id uuid primary key,reserva_id uuid,cabana_id uuid,
            fecha_ingreso date,fecha_salida date,estado_estadia text,tipo_estadia text,
            adultos smallint default 2,ninos smallint default 0,mascotas smallint default 0);
          create table public.huespedes (id uuid primary key,nombre text,apellido text,creado_en timestamptz default now());
          create table public.reserva_huespedes (reserva_id uuid,huesped_id uuid);
          create table public.catalogo_servicios (id uuid primary key, codigo text, activo boolean);
          create table public.recursos_servicio (id uuid primary key,nombre text,activo boolean);
          create table public.servicios (id uuid primary key,reserva_id uuid,estadia_id uuid,catalogo_servicio_id uuid,recurso_id uuid,
            fecha_servicio date,hora_inicio time,hora_fin time,total bigint,estado_servicio text,actualizado_en timestamptz);
          create table public.pagos (id uuid primary key default gen_random_uuid(),reserva_id uuid,pago_grupo_id uuid,pago_origen_id uuid,
            monto bigint,moneda text,tipo_movimiento text,etapa_operativa text,medio_pago text,estado text,fecha_pago timestamptz,
            folio text,codigo_autorizacion text,bove text,referencia_externa text,observaciones text,creado_por uuid,verificado_por uuid,
            verificado_en timestamptz,datos_origen jsonb,actualizado_en timestamptz default now());
          create table public.cargos (id uuid primary key,reserva_id uuid,tipo_cargo text,estado text);
          create table public.pago_aplicaciones (pago_id uuid references public.pagos,cargo_id uuid references public.cargos,monto_aplicado bigint);
          create function public.haiku_ficha_reserva_core(uuid) returns jsonb language sql as
            $$ select jsonb_build_object('reserva',jsonb_build_object('id',id,'titular_nombre',titular_nombre,'correo_contacto',correo_contacto),
              'estadias',(select jsonb_agg(e order by e.id) from public.reserva_estadias e where e.reserva_id=$1)) from public.reservas where id=$1 $$;
          create function public.haiku_modificar_reserva_completa(uuid,text,smallint,date,date,text,smallint,smallint,smallint,text,text,text,text,jsonb,bigint,jsonb)
          returns jsonb language plpgsql as $$
            begin
              if $14->>'2026-09-10' <> '90000' then raise exception 'Tarifa fixture no conservada'; end if;
              update public.reserva_estadias set fecha_salida=$5 where reserva_id=$1;
              return jsonb_build_object('reserva_id',$1);
            end;
          $$;
          create function public.haiku_actualizar_ocupacion_reserva(uuid,smallint,smallint,smallint) returns jsonb language plpgsql as
            $$ begin update public.reserva_estadias set adultos=$2,ninos=$3,mascotas=$4 where reserva_id=$1;
              return jsonb_build_object('reserva_id',$1); end $$;
          create function public.haiku_corregir_abono(uuid,bigint,text,timestamptz,text,text,text,text,text) returns jsonb language plpgsql as
            $$ begin update public.pagos set monto=$2 where id=$1; return jsonb_build_object('pago_id',$1); end $$;
          create function public.haiku_editar_pago_confirmado_saldo(uuid,text,text,text,text,text) returns jsonb language plpgsql as
            $$ begin update public.pagos set folio=$4 where id=$1; return jsonb_build_object('pago_id',$1); end $$;
          create function public.version_operativa_fixture() returns trigger language plpgsql as
            $$ begin new.actualizado_en=clock_timestamp();return new;end $$;
          create trigger pagos_version before update on public.pagos for each row execute function public.version_operativa_fixture();
          create trigger servicios_version before update on public.servicios for each row execute function public.version_operativa_fixture();

          insert into public.reservas(id,estado_reserva,titular_nombre,actualizado_en) values
            ('${ids.reserva}','confirmada','Ana Ejemplo','${version}'),('${ids.otra}','confirmada','Otra Persona','${version}');
          insert into public.cabanas values ('${ids.cabana}',3,true,90000);
          insert into public.reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia,tipo_estadia) values
            ('${ids.estadia}','${ids.reserva}','${ids.cabana}','2026-09-10','2026-09-12','confirmada','alojamiento'),
            ('${ids.estadia2}','${ids.otra}','${ids.cabana}','2026-09-12','2026-09-13','confirmada','alojamiento');
          insert into public.catalogo_servicios values ('${ids.catalogo}','tinajaTonel',true);
          insert into public.recursos_servicio values ('${ids.recurso}','Tinaja Tonel de Madera',true);
          insert into public.servicios values
            ('${ids.servicio}','${ids.reserva}','${ids.estadia}','${ids.catalogo}','${ids.recurso}','2026-09-10','18:00','19:00',30000,'programado','${version}'),
            ('${ids.conflicto}','${ids.reserva}','${ids.estadia}','${ids.catalogo}','${ids.recurso}','2026-09-11','20:30','21:30',30000,'programado','${version}');
          insert into public.pagos(id,reserva_id,monto,moneda,tipo_movimiento,etapa_operativa,medio_pago,estado,fecha_pago,
            referencia_externa,actualizado_en) values
            ('${ids.pago}','${ids.reserva}',80000,'CLP','pago','abono','transferencia','confirmado','${version}','REF-001','${version}'),
            ('${ids.pago2}','${ids.otra}',90000,'CLP','pago','abono','transferencia','confirmado','${version}','REF-002','${version}');
          insert into public.cargos values ('${ids.cargo}','${ids.reserva}','alojamiento','activo'),('${ids.cargo2}','${ids.otra}','alojamiento','activo');
          insert into public.pago_aplicaciones values ('${ids.pago}','${ids.cargo}',80000),('${ids.pago2}','${ids.cargo2}',90000);
          insert into public.saldos_fixture values ('${ids.reserva}',50000,160000),('${ids.otra}',0,90000);
        ` + leer("tests/fixtures/bove-rpc-originales.sql"));
        await db.exec(leer("supabase/migrations/20260910180000_bove_registro_atomico.sql"));
        await db.exec(leer("supabase/migrations/20261112153527_haku_operaciones_chat.sql"));

        const permisos = await consulta(`
          select p.proname,p.prosecdef,
            has_function_privilege('anon',p.oid,'execute') as anonimo,
            has_function_privilege('authenticated',p.oid,'execute') as autenticado
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('haiku_editar_reserva_asistente_v1',
            'haiku_reprogramar_servicio_asistente_v1','haiku_pago_asistente_v1','haiku_guardar_bove_asistente_v1')
        `);
        assert.equal(permisos.rows.length, 4);
        assert.ok(permisos.rows.every(p => p.autenticado && !p.anonimo && !p.prosecdef));

        await consulta("select set_config('request.jwt.claim.sub',$1,false)", [ids.usuario]);
        await db.exec("set role authenticated");
        const mover = (dia, hora, v = version) => dato(
            "select public.haiku_reprogramar_servicio_asistente_v1($1,$2,$3,$4,$5) as r",
            [ids.servicio, ids.estadia, v, dia, hora]);
        await assert.rejects(mover("2026-09-11","20:00"), /ocupada/);
        await assert.rejects(mover("2026-09-13","18:00"), /fecha del servicio/);
        assert.equal((await mover("2026-09-11","18:15")).r.hora_fin, "19:15:00");
        await assert.rejects(mover("2026-09-11","19:00"), /cambiaron/);

        await db.exec("reset role");
        const leerFicha = async () => (await dato("select public.haiku_ficha_reserva_core($1) as r", [ids.reserva])).r;
        const ficha = await leerFicha();
        await db.exec("set role authenticated");
        const editar = (p, nuevo, base = null) => dato("select public.haiku_editar_reserva_asistente_v1($1,$2,$3,$4,$5) as r",
            [ids.reserva, ids.estadia, p, nuevo, base]);
        const contacto = { campo:"correo_contacto",valor:"reservas@example.com" };
        assert.equal((await editar(ficha,contacto)).r.reserva_id, ids.reserva);
        await assert.rejects(editar(ficha,contacto), /reserva cambió/);
        await db.exec("reset role");
        const conContacto = await leerFicha();
        assert.equal(conContacto.reserva.correo_contacto, contacto.valor);
        await db.exec("set role authenticated");
        assert.equal((await editar(conContacto, {cabana_numero:3,fecha_ingreso:"2026-09-10",fecha_salida:"2026-09-11",
            tarifas:{"2026-09-10":90000}},90000)).r.reserva_id, ids.reserva);
        await db.exec("reset role");
        const conFechas = await leerFicha();
        assert.deepEqual(conFechas.reserva, conContacto.reserva);
        await db.exec("set role authenticated");
        assert.equal((await editar(conFechas, {campo:"ocupacion",adultos:3,ninos:0,mascotas:0})).r.reserva_id, ids.reserva);

        const pago = (id, accion, cambios = {}, motivo = null, v = version) => dato(
            "select public.haiku_pago_asistente_v1($1,$2,$3,$4,$5) as r", [id,v,accion,cambios,motivo]);
        await assert.rejects(pago(ids.pago,"anular"), /motivo/);
        await assert.rejects(pago(ids.pago,"corregir",{monto:300000}), /saldo a favor/);
        assert.equal((await pago(ids.pago,"corregir",{monto:90000})).r.ok,true);
        await assert.rejects(pago(ids.pago,"anular",{},"Duplicado"), /pago cambió/);
        const reembolso = { fecha_pago:"2026-09-10",medio_pago:"transferencia",comprobante:"DEV-123" };
        const devolucion = await pago(ids.pago2,"devolucion",reembolso,"Duplicado");
        assert.ok(devolucion.r.devolucion_id);
        await assert.rejects(pago(ids.pago2,"devolucion",reembolso,"Duplicado"), /devolución registrada/);

        const bove = (tipo, numero, v = version, estadia = ids.estadia2) => dato(
            "select public.haiku_guardar_bove_asistente_v1($1,$2,$3,$4,$5) as r",
            [ids.otra,v,JSON.stringify([{id:estadia,cabana_numero:3,fecha_ingreso:"2026-09-12",fecha_salida:"2026-09-13",
                tipo_estadia:"alojamiento",estado_estadia:"confirmada"}]),tipo,numero]);
        await assert.rejects(bove("alojamiento","19800",version,ids.estadia), /estadía cambió/);
        assert.equal((await bove("alojamiento","19800")).r.bove,"19800");
        await assert.rejects(bove("alojamiento","19801"), /reserva cambió/);
        await assert.rejects(pago(ids.pago2,"anular",{},"Duplicado"), /devolución registrada/);

        await db.exec("reset role");
        const aplicada = await dato("select cargo_id,monto_aplicado from public.pago_aplicaciones where pago_id=$1",
            [devolucion.r.devolucion_id]);
        assert.deepEqual(aplicada,{cargo_id:ids.cargo2,monto_aplicado:90000});
        const guardado = await dato("select total,hora_inicio,hora_fin from public.servicios where id=$1",[ids.servicio]);
        assert.deepEqual(guardado,{total:30000,hora_inicio:"18:15:00",hora_fin:"19:15:00"});
        const versionPago = (await dato("select actualizado_en::text as v from public.pagos where id=$1",[ids.pago])).v;
        await db.exec("set role authenticated");
        assert.equal((await pago(ids.pago,"anular",{},"Duplicado",versionPago)).r.ok,true);
        await db.exec("set haku.test_permit='off'");
        await assert.rejects(mover("2026-09-11","18:00"), /permiso/);
        await db.exec("reset role; set role anon");
        await assert.rejects(mover("2026-09-11","18:00"), /permission denied/);
        console.log("SQL de Haku verificado en PostgreSQL aislado");
    } finally {
        await db.close();
    }
}

probar().catch(error => { console.error(error); process.exitCode = 1; });
