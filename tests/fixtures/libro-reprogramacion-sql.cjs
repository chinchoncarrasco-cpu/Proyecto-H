// Únicamente datos inventados en PostgreSQL embebido. Nunca acepta conexión remota.
const {preparar:base}=require('./libro-identidad-documento-sql.cjs');
const {PGlite}=require('@electric-sql/pglite'),{btree_gist}=require('@electric-sql/pglite/contrib/btree_gist');
const fs=require('fs'),path=require('path'),{randomUUID}=require('crypto');
const read=p=>fs.readFileSync(path.join(__dirname,'../..',p),'utf8').replace(/\r\n/g,'\n');
const migration='supabase/migrations/20261117005357_libro_reprogramacion_estadia_atomica.sql';
async function crear(){const h=await base({db:new PGlite({extensions:{btree_gist}})}),{db}=h;try{
 await db.exec(`
 create function private.haiku_usuario_activo() returns boolean language sql as $$select auth.uid() is not null$$;
 create or replace function private.haiku_tiene_permiso(p text) returns boolean language sql as $$select current_setting('reprog.deny_permission',true) is distinct from p$$;
 alter table cargo_ajustes add column reserva_id uuid;
 alter table cargos add column actualizado_en timestamptz default now();
 alter table reserva_estadias add column actualizado_en timestamptz default now();
 alter table catalogo_servicios add column activo boolean default true,add column requiere_horario boolean default true;
 alter table servicios add column recurso_id uuid,add column hora_inicio time,add column hora_fin time,
  add column actualizado_en timestamptz default now(),add column observaciones text,add column libro_revision_admin_v1 jsonb,add column creado_por uuid;
 create table recursos_servicio(id uuid primary key,nombre text,activo boolean default true);
 create table bloqueos_cabana(id uuid primary key,cabana_id uuid,desde timestamptz,hasta timestamptz,estado text);
 create table notas(id uuid primary key default gen_random_uuid(),reserva_id uuid,estadia_id uuid,cabana_id uuid,
  tipo text,fecha_operacion date,texto text,creado_en timestamptz default now(),actualizado_en timestamptz default now());
 create unique index notas_operativas_resumen_unicas on notas(fecha_operacion,cabana_id,texto) where tipo='operativa_resumen';
 create extension btree_gist;
 alter table reserva_estadias add constraint estancia_no_solapada exclude using gist(cabana_id with =,daterange(fecha_ingreso,fecha_salida,'[)') with &&) where(estado_estadia not in('cancelada','no_show'));
 alter table servicios add constraint recurso_no_solapado exclude using gist(recurso_id with =,tsrange(fecha_servicio+hora_inicio,fecha_servicio+hora_fin,'[)') with &&) where(recurso_id is not null and hora_inicio is not null and hora_fin is not null and estado_servicio not in('cancelado','no_show'));
 `);
 await db.exec(read('tests/fixtures/reprogramacion-guardas.sql'));
 await db.exec(`create trigger rango before update on reserva_estadias for each row execute function haiku_validar_cambio_rango_estadia();
 create trigger tarifa_cabana after update of cabana_id on reserva_estadias for each row execute function private.haiku_sincronizar_tarifas_catalogo_por_cambio_cabana();
 create trigger valida_noche before insert or update on estadia_noches for each row execute function haiku_validar_estadia_noche();
 create trigger cargo_noche after insert or update on estadia_noches for each row execute function haiku_sincronizar_cargo_noche();
 create trigger valida_servicio before insert or update on servicios for each row execute function haiku_validar_servicio();
 create trigger cargo_servicio after insert or update on servicios for each row execute function haiku_sincronizar_cargo_servicio();
 create function private.haiku_editar_reserva_asistente_impl_v1(uuid,uuid,jsonb,jsonb,bigint) returns jsonb language sql as $$select jsonb_build_object('reserva_id',$1)$$;`);
 await db.exec(read(migration));
 const id={...h.ids,late:randomUUID(),early:randomUUID(),jacuzzi:randomUUID(),antiguo:randomUUID(),anterior:randomUUID(),realizado:randomUUID(),
  nota:randomUUID(),notaManual:randomUUID(),estadiaAnterior:randomUUID(),cabanaDestino:randomUUID(),recurso:randomUUID(),catJacuzzi:randomUUID(),catLate:randomUUID(),catEarly:randomUUID(),catMasaje:randomUUID()};
 await db.query('update cabanas set numero=9,precio_base=144000 where id=$1',[id.cabana]);
 await db.query("update reserva_estadias set fecha_ingreso='2026-11-15',fecha_salida='2026-11-16' where id=$1",[id.estadia]);
 await db.query('insert into cabanas(id,numero,precio_base) values($1,4,200000)',[id.cabanaDestino]);
 await db.query("insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia) values($1,$2,$3,'2026-10-03','2026-10-04','checked_out')",[id.estadiaAnterior,id.reserva,id.cabana]);
 await db.query("insert into estadia_noches(estadia_id,fecha,tarifa,origen_tarifa) values($1,'2026-11-15',144000,'catalogo')",[id.estadia]);
 await db.query("insert into catalogo_servicios(id,codigo,nombre,categoria) values($1,'lateCheckout','Late Check-out','servicio'),($2,'earlyCheckin','Early Check-in','servicio'),($3,'tinajaJacuzzi','Jacuzzi','tinaja'),($4,'masaje30','Masaje','masaje')",[id.catLate,id.catEarly,id.catJacuzzi,id.catMasaje]);
 await db.query("insert into recursos_servicio values($1,'Tinaja Jacuzzi',true)",[id.recurso]);
 for(const [sid,est,cat,dia,inicio,fin,estado]of [[id.late,id.estadia,id.catLate,'2026-11-16','12:00','14:00','programado'],[id.early,id.estadia,id.catEarly,'2026-11-15','10:00','12:00','programado'],
  [id.jacuzzi,id.estadia,id.catJacuzzi,'2026-11-15','18:30','19:30','programado'],[id.antiguo,id.estadia,id.catJacuzzi,'2026-10-03','20:00','21:00','programado'],
  [id.anterior,id.estadiaAnterior,id.catJacuzzi,'2026-10-03','10:00','11:00','programado'],[id.realizado,id.estadia,id.catMasaje,'2026-11-15','17:00','17:30','realizado']]){
  await db.query('insert into servicios(id,reserva_id,estadia_id,catalogo_servicio_id,recurso_id,fecha_servicio,hora_inicio,hora_fin,estado_servicio,total,observaciones) values($1,$2,$3,$4,$5,$6,$7,$8,$9,30000,$10)',[sid,id.reserva,est,cat,cat===id.catJacuzzi?id.recurso:null,dia,inicio,fin,estado,'Indicación manual intacta.']);
 }
 await db.query("insert into notas(id,reserva_id,estadia_id,cabana_id,tipo,fecha_operacion,texto) values($1,$2,$3,$4,'operativa_resumen','2026-11-15','Llegada 19:00 · Dejar dos batas'),($5,$2,null,null,'general',null,'Comentario general intacto')",[id.nota,id.reserva,id.estadia,id.cabana,id.notaManual]);
 const c=(await db.query('select id from cargos where estadia_id=$1',[id.estadia])).rows[0].id;
 const p=randomUUID();await db.query("insert into pagos(id,reserva_id,monto,moneda,tipo_movimiento,estado,fecha_pago) values($1,$2,100000,'CLP','pago','confirmado','2026-11-01')",[p,id.reserva]);
 await db.query('insert into pago_aplicaciones(pago_id,cargo_id,monto_aplicado) values($1,$2,100000)',[p,c]);
 const destino=(cabana=9)=>({cabana_numero:cabana,fecha_ingreso:'2026-12-28',fecha_salida:'2026-12-29'});
 const plan=async(d=destino())=>(await db.query('select public.haiku_reprogramacion_preparar_v1($1,$2,$3::jsonb) r',[id.reserva,id.estadia,JSON.stringify(d)])).rows[0].r;
 const decisiones=p=>Object.fromEntries(p.items.map(i=>[i.id,i.inicial||'revision']).map(([k,v])=>[k,p.items.find(i=>i.id===k).opciones.includes(v)?v:'conservar']));
 const aplicar=async(p,d=decisiones(p),op=randomUUID())=>(await db.query('select public.haiku_reprogramar_estadia_v1($1,$2::jsonb,$3::jsonb) r',[op,JSON.stringify(p),JSON.stringify(d)])).rows[0].r;
 const snapshot=async()=>{const out={};for(const t of ['reserva_estadias','estadia_noches','notas','servicios','cargos','pagos','pago_aplicaciones','cargo_ajustes'])out[t]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') r from ${t} t`)).rows[0].r;return out;};
 return {...h,id,destino,plan,decisiones,aplicar,snapshot,read,migration};
 }catch(e){await db.close();throw e;}}
module.exports={crear,read,migration};
