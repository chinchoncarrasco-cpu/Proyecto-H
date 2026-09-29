const fs = require('node:fs');
const initTotalV3 = require('./total-v3-runtime.cjs');

const read = path => fs.readFileSync(path, 'utf8');

module.exports = async () => {
  const db = await initTotalV3();
  try {
    await db.exec(`
      alter table public.huespedes add column apellido text;
      alter table public.reservas add column cloudbeds_id text;
      alter table public.eventos_auditoria
        add column estadia_id uuid,
        add column cabana_id uuid,
        add column creado_en timestamptz not null default now();
      create table public.bloqueos_cabana(
        id uuid primary key default gen_random_uuid(),
        cabana_id uuid references public.cabanas(id),
        estado text,
        desde timestamptz,
        hasta timestamptz
      );
      create function private.haiku_usuario_activo()
      returns boolean language sql stable
      as $$select current_setting('haku.test_activo', true) is distinct from 'off'$$;
    `);
    await db.exec(read('supabase/migrations/20260910235134_haiku_total_financiero_v31_guard_servicios.sql'));
    await db.exec(read('supabase/migrations/20260902051904_haiku_modificacion_reserva_completa_v1.sql'));
    await db.exec(read('supabase/migrations/20260929043150_cloudbeds_writer_audit_w1.sql'));
    await db.exec(read('supabase/migrations/20260929170344_cloudbeds_writer_fullday_v31_w12.sql'));
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
};
