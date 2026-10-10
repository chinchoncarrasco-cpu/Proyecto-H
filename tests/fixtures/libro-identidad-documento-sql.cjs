// PostgreSQL efímero, exclusivamente identidades ficticias. No usa Supabase remoto.
const {preparar:base,read,rpc}=require('./airbnb-libro-writers-sql.cjs');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs'),path=require('node:path');
const migration=()=>fs.readdirSync(path.join(__dirname,'../../supabase/migrations'))
    .find(f=>f.endsWith('_libro_identidad_documento_guard.sql'));
async function preparar({aplicar=true}={}) {
    const h=await base();const {db}=h;
    try {
        await db.exec(`delete from reservas;
          create table huespedes(id uuid primary key default gen_random_uuid(),nombre text,
            tipo_documento text,numero_documento text,correo text,telefono text);
          create unique index huespedes_documento_uidx on huespedes(tipo_documento,numero_documento)
            where tipo_documento is not null and numero_documento is not null;
          alter table reservas alter column id set default gen_random_uuid(),
            add column titular_huesped_id uuid references huespedes,
            add column titular_tipo_documento text,add column correo_contacto text,
            add column telefono_contacto text,add column observaciones text,
            add column codigo_haiku text,add column cloudbeds_id text;
          alter table cabanas alter column numero type smallint,
            add column activa boolean default true,add column precio_base bigint default 100000;
          alter table reserva_estadias alter column id set default gen_random_uuid(),
            add column tipo_estadia text default 'alojamiento',add column adultos smallint default 1,
            add column ninos smallint default 0,add column mascotas smallint default 0,
            add column checkin_realizado_en timestamptz,add column checkin_realizado_por uuid,
            add column checkout_realizado_en timestamptz,add column checkout_realizado_por uuid;
          create table reserva_huespedes(reserva_id uuid references reservas,huesped_id uuid references huespedes,
            primary key(reserva_id,huesped_id));
          create table estadia_huespedes(estadia_id uuid references reserva_estadias,huesped_id uuid references huespedes,
            primary key(estadia_id,huesped_id));
          create table estadia_noches(id uuid primary key default gen_random_uuid(),
            estadia_id uuid references reserva_estadias,fecha date,tarifa bigint,origen_tarifa text,unique(estadia_id,fecha));
          alter table cargos alter column id set default gen_random_uuid(),
            add column estadia_noche_id uuid references estadia_noches,add column concepto text,
            add column moneda text,add column creado_por uuid;
          create function haiku_cabanas_disponibles(date,date,text) returns table(numero smallint)
            language sql as $$select numero from cabanas where activa$$;
          create table auditoria_identidad_fixture(tabla text,anterior jsonb,nuevo jsonb);
          create function auditar_identidad_fixture() returns trigger language plpgsql as $$begin
            insert into auditoria_identidad_fixture values(tg_table_name,to_jsonb(old),to_jsonb(new));
            return new;end$$;
          create trigger auditoria after insert or update on reservas for each row execute function auditar_identidad_fixture();
          create trigger auditoria after insert or update on huespedes for each row execute function auditar_identidad_fixture();
          create trigger auditoria after insert or update on pagos for each row execute function auditar_identidad_fixture();`);
        // Writer de alta versionado real; disponibilidad se acota al fixture sin solapamientos.
        await db.exec(rpc('20260902053250_crear_reserva_fullday_con_cargo.sql','haiku_crear_reserva'));
        const ids={reserva:randomUUID(),estadia:randomUUID(),guest:randomUUID(),owner:randomUUID(),cabana:randomUUID()};
        await db.query(`insert into huespedes(id,nombre,tipo_documento,numero_documento) values
          ($1,'Persona Ficticia A','pasaporte','FICTICIO-A'),($2,'Persona Ficticia B','pasaporte','FICTICIO-B')`,[ids.guest,ids.owner]);
        await db.query(`insert into reservas(id,titular_nombre,titular_tipo_documento,titular_numero_documento,
          titular_huesped_id,estado_reserva) values($1,'Persona Ficticia A','pasaporte','FICTICIO-A',$2,'confirmada')`,[ids.reserva,ids.guest]);
        await db.query('insert into cabanas(id,numero) values($1,1)',[ids.cabana]);
        await db.query(`insert into reserva_estadias(id,reserva_id,cabana_id,fecha_ingreso,fecha_salida,estado_estadia)
          values($1,$2,$3,'2026-10-13','2026-10-15','confirmada')`,[ids.estadia,ids.reserva,ids.cabana]);
        await db.query('insert into reserva_huespedes values($1,$2)',[ids.reserva,ids.guest]);
        await db.query('insert into estadia_huespedes values($1,$2)',[ids.estadia,ids.guest]);
        const original=(await db.query(`select prosrc,md5(replace(prosrc,E'\\r','')) huella
          from pg_proc where oid='private.haiku_libro_actualizar_v1(jsonb)'::regprocedure`)).rows[0];
        if(aplicar) {
            const f=migration();if(!f) throw Error('Falta migration de protección de identidad');
            await db.exec(read('supabase/migrations/'+f));
        }
        const item=(despues={titular_numero_documento:'FICTICIO-B'})=>({tipo:'reserva_actualizar',item_id:'identidad-ficticia',
          reserva_id:ids.reserva,estadia_id:ids.estadia,
          reserva:{antes:{titular_nombre:'Persona Ficticia A',titular_tipo_documento:'pasaporte',titular_numero_documento:'FICTICIO-A',observaciones:null},despues},
          estadia:{antes:{},despues:{}},cambios:[{campo:'Documento',proyecto:'FICTICIO-A',libro:despues.titular_numero_documento}]});
        const actualizar=i=>db.query('select private.haiku_libro_actualizar_v1($1::jsonb) r',[JSON.stringify(i)]).then(r=>r.rows[0].r);
        const lote=(items,op=randomUUID())=>db.query('select haiku_incorporar_libro_v1($1,$2::jsonb) r',[op,JSON.stringify(items)]).then(r=>r.rows[0].r);
        const snapshot=async()=>{
          const tables=['reservas','huespedes','reserva_huespedes','estadia_huespedes','reserva_estadias','pagos','pago_aplicaciones',
            'cargos','auditoria_identidad_fixture','private.haiku_libro_incorporaciones'];
          const out={};for(const t of tables) out[t]=(await db.query(`select coalesce(jsonb_agg(x order by x::text),'[]') rows from (select to_jsonb(t) x from ${t} t) s`)).rows[0].rows;
          return out;
        };
        return {...h,ids,item,actualizar,lote,snapshot,original};
    } catch(e) {await db.close();throw e;}
}
module.exports={preparar,migration};
