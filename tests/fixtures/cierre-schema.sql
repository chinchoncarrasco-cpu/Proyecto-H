-- Fixture local, columnas/constraints/catalogo leidos de produccion 2026-10-01.
-- Auth y resolucion de permisos son dobles controlados; no replica RLS ni auditoria general.
create schema auth;
create schema private;
create role anon;
create role authenticated;
create table public.usuarios(id uuid primary key);
insert into public.usuarios values ('00000000-0000-0000-0000-000000000001');
create function auth.uid() returns uuid language sql as $$
 select '00000000-0000-0000-0000-000000000001'::uuid
$$;
create function private.haiku_tiene_permiso(p text) returns boolean language sql as $$
 select p = any(string_to_array(current_setting('test.permisos', true), ','))
$$;
create table public.cabanas (
  id uuid default gen_random_uuid() not null,
  numero int2 not null,
  nombre text,
  tipo text,
  capacidad_adultos int2,
  capacidad_ninos int2,
  capacidad_total int2,
  acepta_mascotas bool default false not null,
  precio_base int8,
  activa bool default true not null,
  orden_visual int2,
  cloudbeds_room_id text,
  cloudbeds_room_type_id text,
  creado_en timestamptz default now() not null,
  actualizado_en timestamptz default now() not null
);
alter table public.cabanas add primary key(id);
create table public.turnos (
  id uuid default gen_random_uuid() not null,
  fecha_operativa date not null,
  tipo_turno text not null,
  estado text default 'abierto'::text not null,
  iniciado_por uuid,
  iniciado_en timestamptz,
  finalizado_por uuid,
  finalizado_en timestamptz,
  observaciones text,
  creado_en timestamptz default now() not null,
  actualizado_en timestamptz default now() not null
);
alter table public.turnos add constraint turnos_cierre_coherente CHECK (((estado <> 'cerrado'::text) OR ((finalizado_por IS NOT NULL) AND (finalizado_en IS NOT NULL))));
alter table public.turnos add constraint turnos_estado_valido CHECK ((estado = ANY (ARRAY['abierto'::text, 'cerrado'::text])));
alter table public.turnos add constraint turnos_finalizado_por_fkey FOREIGN KEY (finalizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.turnos add constraint turnos_iniciado_por_fkey FOREIGN KEY (iniciado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.turnos add constraint turnos_pkey PRIMARY KEY (id);
alter table public.turnos add constraint turnos_tiempos_validos CHECK (((iniciado_en IS NULL) OR (finalizado_en IS NULL) OR (finalizado_en >= iniciado_en)));
alter table public.turnos add constraint turnos_tipo_no_vacio CHECK ((btrim(tipo_turno) <> ''::text));
create table public.cierres_turno (
  id uuid default gen_random_uuid() not null,
  turno_id uuid not null,
  estado text default 'borrador'::text not null,
  resumen_entrega text,
  novedades text,
  snapshot jsonb default '{}'::jsonb not null,
  cerrado_por uuid,
  cerrado_en timestamptz,
  reabierto_por uuid,
  reabierto_en timestamptz,
  motivo_reapertura text,
  recibido_por uuid,
  recibido_en timestamptz,
  creado_en timestamptz default now() not null,
  actualizado_en timestamptz default now() not null
);
alter table public.cierres_turno add constraint cierres_cerrado_por_fkey FOREIGN KEY (cerrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.cierres_turno add constraint cierres_reabierto_por_fkey FOREIGN KEY (reabierto_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.cierres_turno add constraint cierres_recibido_por_fkey FOREIGN KEY (recibido_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.cierres_turno add constraint cierres_turno_cierre_coherente CHECK (((estado <> ALL (ARRAY['cerrado'::text, 'cerrado_con_pendientes'::text])) OR ((cerrado_por IS NOT NULL) AND (cerrado_en IS NOT NULL))));
alter table public.cierres_turno add constraint cierres_turno_estado_valido CHECK ((estado = ANY (ARRAY['borrador'::text, 'cerrado'::text, 'cerrado_con_pendientes'::text, 'reabierto'::text])));
alter table public.cierres_turno add constraint cierres_turno_pkey PRIMARY KEY (id);
alter table public.cierres_turno add constraint cierres_turno_reapertura_coherente CHECK (((estado <> 'reabierto'::text) OR ((reabierto_por IS NOT NULL) AND (reabierto_en IS NOT NULL) AND (motivo_reapertura IS NOT NULL) AND (btrim(motivo_reapertura) <> ''::text))));
alter table public.cierres_turno add constraint cierres_turno_recepcion_coherente CHECK ((((recibido_por IS NULL) AND (recibido_en IS NULL)) OR ((recibido_por IS NOT NULL) AND (recibido_en IS NOT NULL))));
alter table public.cierres_turno add constraint cierres_turno_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE RESTRICT;
alter table public.cierres_turno add constraint cierres_turno_turno_id_key UNIQUE (turno_id);
create table public.cierre_checklist_items (
  id uuid default gen_random_uuid() not null,
  codigo text not null,
  nombre text not null,
  categoria text,
  obligatorio bool default true not null,
  bloquea_cierre bool default false not null,
  permiso_requerido text,
  activo bool default true not null,
  orden_visual int4,
  creado_en timestamptz default now() not null,
  actualizado_en timestamptz default now() not null,
  alcance text default 'global'::text not null,
  tipo_respuesta text default 'booleano'::text not null
);
alter table public.cierre_checklist_items add constraint cierre_checklist_alcance_valido CHECK ((alcance = ANY (ARRAY['global'::text, 'cabana'::text])));
alter table public.cierre_checklist_items add constraint cierre_checklist_codigo_no_vacio CHECK ((btrim(codigo) <> ''::text));
alter table public.cierre_checklist_items add constraint cierre_checklist_items_codigo_key UNIQUE (codigo);
alter table public.cierre_checklist_items add constraint cierre_checklist_items_pkey PRIMARY KEY (id);
alter table public.cierre_checklist_items add constraint cierre_checklist_nombre_no_vacio CHECK ((btrim(nombre) <> ''::text));
alter table public.cierre_checklist_items add constraint cierre_checklist_permiso_no_vacio CHECK (((permiso_requerido IS NULL) OR (btrim(permiso_requerido) <> ''::text)));
alter table public.cierre_checklist_items add constraint cierre_checklist_tipo_respuesta_valido CHECK ((tipo_respuesta = ANY (ARRAY['booleano'::text, 'opcion'::text, 'texto'::text, 'json'::text])));
create table public.cierre_respuestas (
  id uuid default gen_random_uuid() not null,
  cierre_id uuid not null,
  item_id uuid not null,
  estado text default 'pendiente'::text not null,
  observacion text,
  confirmado_por uuid,
  confirmado_en timestamptz,
  creado_en timestamptz default now() not null,
  actualizado_en timestamptz default now() not null,
  cabana_id uuid,
  valor jsonb,
  origen text default 'usuario'::text not null
);
alter table public.cierre_respuestas add constraint cierre_respuestas_cabana_id_fkey FOREIGN KEY (cabana_id) REFERENCES cabanas(id) ON DELETE RESTRICT;
alter table public.cierre_respuestas add constraint cierre_respuestas_cierre_id_fkey FOREIGN KEY (cierre_id) REFERENCES cierres_turno(id) ON DELETE RESTRICT;
alter table public.cierre_respuestas add constraint cierre_respuestas_confirmacion_coherente CHECK (((estado = 'pendiente'::text) OR (origen <> 'usuario'::text) OR ((confirmado_por IS NOT NULL) AND (confirmado_en IS NOT NULL))));
alter table public.cierre_respuestas add constraint cierre_respuestas_confirmado_por_fkey FOREIGN KEY (confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.cierre_respuestas add constraint cierre_respuestas_estado_valido CHECK ((estado = ANY (ARRAY['pendiente'::text, 'confirmado'::text, 'no_corresponde'::text])));
alter table public.cierre_respuestas add constraint cierre_respuestas_item_id_fkey FOREIGN KEY (item_id) REFERENCES cierre_checklist_items(id) ON DELETE RESTRICT;
alter table public.cierre_respuestas add constraint cierre_respuestas_no_corresponde_observacion CHECK (((estado <> 'no_corresponde'::text) OR ((observacion IS NOT NULL) AND (btrim(observacion) <> ''::text))));
alter table public.cierre_respuestas add constraint cierre_respuestas_origen_valido CHECK ((origen = ANY (ARRAY['usuario'::text, 'importacion'::text, 'sistema'::text])));
alter table public.cierre_respuestas add constraint cierre_respuestas_pkey PRIMARY KEY (id);
create unique index turnos_fecha_tipo_test on public.turnos(fecha_operativa,tipo_turno);
CREATE INDEX cierre_respuestas_item_idx ON public.cierre_respuestas USING btree (item_id);
CREATE INDEX cierre_respuestas_confirmado_por_idx ON public.cierre_respuestas USING btree (confirmado_por);
CREATE UNIQUE INDEX cierre_respuestas_global_uidx ON public.cierre_respuestas USING btree (cierre_id, item_id) WHERE (cabana_id IS NULL);
CREATE UNIQUE INDEX cierre_respuestas_cabana_uidx ON public.cierre_respuestas USING btree (cierre_id, item_id, cabana_id) WHERE (cabana_id IS NOT NULL);
CREATE INDEX cierre_respuestas_cabana_id_idx ON public.cierre_respuestas USING btree (cabana_id);
create table public.evidencias(id uuid default gen_random_uuid(), cierre_id uuid, storage_bucket text, storage_path text, mime_type text, tamano_bytes bigint, descripcion text, subido_por uuid, creado_en timestamptz default now());
create table public.eventos_auditoria(usuario_id uuid, accion text, tipo_evento text, entidad_tipo text, entidad_id uuid, turno_id uuid, descripcion text, cambios jsonb, datos_contexto jsonb, origen text);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('salida_temprana','Salida temprana revisada','salidas','global',true,false,'opcion',null,true,10);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('salio_antes','Salida anticipada revisada','salidas','global',true,false,'opcion',null,true,20);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('llaves_retiradas','Llaves retiradas revisadas','salidas','global',true,false,'opcion',null,true,30);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('registro_guardado','Registro guardado','salidas','global',true,false,'booleano',null,true,40);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('reserva_marcada','Reserva marcada','salidas','global',true,false,'booleano',null,true,50);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('pago_registrado','Pago registrado','salidas','global',true,false,'booleano',null,true,60);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('llaves_recepcion','Llaves de recepción','recepcion','global',false,false,'json',null,true,70);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('manager_pagos','Manager · Pagos','manager','global',true,false,'booleano','cierres.validar_pagos',true,80);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('manager_caja','Manager · Caja','manager','global',true,false,'booleano','cierres.validar_caja',true,90);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('manager_vale_salida','Manager · Vale de salida','manager','global',true,false,'booleano','cierres.validar_vale_salida',true,100);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('detalles_cabanas','Detalles de cabañas revisados','pendientes','global',true,false,'opcion',null,true,110);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('pendientes_hacer','Pendientes por hacer revisados','pendientes','global',true,false,'opcion',null,true,120);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('hay_novedades','Novedades revisadas','pendientes','global',true,false,'opcion',null,true,130);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('tinaja_tonel_apagado','Tinaja Tonel apagada','tinajas','global',true,false,'booleano',null,true,140);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('tinaja_jacuzzi_apagado','Jacuzzi apagado','tinajas','global',true,false,'booleano',null,true,150);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('tinaja_tonel_funcionamiento','Funcionamiento Tonel revisado','tinajas','global',true,false,'booleano',null,true,160);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('tinaja_jacuzzi_funcionamiento','Funcionamiento Jacuzzi revisado','tinajas','global',true,false,'booleano',null,true,170);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('tinaja_cojines_retirados','Cojines de tinajas retirados','tinajas','global',true,false,'booleano',null,true,180);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_ocupada','Cabaña ocupada / no revisar','cabanas','cabana',true,false,'booleano',null,true,200);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_perillas','Perillas revisadas','cabanas','cabana',true,false,'booleano',null,true,210);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_gas','Gas revisado','cabanas','cabana',true,false,'booleano',null,true,220);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_refri','Refrigerador revisado','cabanas','cabana',true,false,'booleano',null,true,230);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_calefactor','Calefactor revisado','cabanas','cabana',true,false,'booleano',null,true,240);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_tv','TV revisada','cabanas','cabana',true,false,'booleano',null,true,250);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_ac','A/C revisado','cabanas','cabana',true,false,'booleano',null,true,260);
insert into public.cierre_checklist_items (codigo,nombre,categoria,alcance,obligatorio,bloquea_cierre,tipo_respuesta,permiso_requerido,activo,orden_visual) values ('cabana_luces','Luces revisadas','cabanas','cabana',true,false,'booleano',null,true,270);
