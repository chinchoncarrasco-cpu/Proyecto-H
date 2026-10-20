-- Revisión de una tinaja existente por un administrador. Nunca crea otro
-- servicio ni cambia cantidad, precio, cargos, pagos o aplicaciones.
alter table public.servicios add column libro_revision_admin_v1 jsonb;

create table private.haiku_libro_revision_admin_ops_v1 (
  operacion_id uuid primary key,
  usuario_id uuid not null,
  solicitud_hash text not null,
  resultado jsonb,
  creado_en timestamptz not null default now()
);
alter table private.haiku_libro_revision_admin_ops_v1 enable row level security;
revoke all on private.haiku_libro_revision_admin_ops_v1 from public,anon,authenticated;

create function private.haiku_libro_es_admin_v1() returns boolean
language sql stable security definer set search_path=pg_catalog,public,private
as $$
  select auth.uid() is not null and coalesce(private.haiku_usuario_activo(),false) and exists(
    select 1 from public.usuario_roles ur join public.roles r on r.id=ur.rol_id
    where ur.usuario_id=auth.uid() and r.codigo='administrador' and r.activo
  );
$$;
revoke all on function private.haiku_libro_es_admin_v1() from public,anon,authenticated;

create function private.haiku_libro_estado_admin_v1(s public.servicios) returns jsonb
language sql immutable set search_path=pg_catalog,public,private
as $$select jsonb_build_object(
  'id',s.id,'reserva_id',s.reserva_id,'estadia_id',s.estadia_id,
  'catalogo_servicio_id',s.catalogo_servicio_id,'recurso_id',s.recurso_id,
  'fecha_servicio',s.fecha_servicio,'hora_inicio',left(s.hora_inicio::text,5),
  'hora_fin',left(s.hora_fin::text,5),'cantidad',s.cantidad,'personas',s.personas,
  'total',s.total,'precio_unitario_aplicado',s.precio_unitario_aplicado,
  'monto_adicional',s.monto_adicional,'tipo_cobro',s.tipo_cobro,'estado_servicio',s.estado_servicio
);$$;
revoke all on function private.haiku_libro_estado_admin_v1(public.servicios) from public,anon,authenticated;

create function private.haiku_libro_admin_finanzas_v1(p_reserva uuid) returns jsonb
language sql volatile set search_path=pg_catalog,public,private
as $$select jsonb_build_object(
  'reserva',(select to_jsonb(r)-'actualizado_en' from public.reservas r where r.id=p_reserva),
  'estadias',(select jsonb_agg(to_jsonb(e) order by e.id) from public.reserva_estadias e where e.reserva_id=p_reserva),
  'cargos',(select jsonb_agg(to_jsonb(c)-array['concepto','actualizado_en'] order by c.id) from public.cargos c where c.reserva_id=p_reserva),
  'pagos',(select jsonb_agg(to_jsonb(p) order by p.id) from public.pagos p where p.reserva_id=p_reserva),
  'aplicaciones',(select jsonb_agg(to_jsonb(a) order by a.id) from public.pago_aplicaciones a join public.cargos c on c.id=a.cargo_id where c.reserva_id=p_reserva),
  'ajustes',(select jsonb_agg(to_jsonb(a) order by a.id) from public.cargo_ajustes a join public.cargos c on c.id=a.cargo_id where c.reserva_id=p_reserva)
);$$;
revoke all on function private.haiku_libro_admin_finanzas_v1(uuid) from public,anon,authenticated;

create function private.haiku_libro_guard_revision_admin_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog,public,private
as $$
begin
  if (tg_op='INSERT' and new.libro_revision_admin_v1 is not null) or
     (tg_op='UPDATE' and new.libro_revision_admin_v1 is distinct from old.libro_revision_admin_v1) then
    if private.haiku_libro_es_admin_v1() is distinct from true or
       new.libro_revision_admin_v1->>'usuario' is distinct from auth.uid()::text or
       new.libro_revision_admin_v1->>'operacion_id' is distinct from nullif(current_setting('app.haiku_libro_revision_admin_v1',true),'') or
       new.libro_revision_admin_v1->'estado' is distinct from private.haiku_libro_estado_admin_v1(new) then
      raise exception 'La revisión administrativa requiere su confirmación protegida' using errcode='42501';
    end if;
  end if;
  return new;
end;$$;
revoke all on function private.haiku_libro_guard_revision_admin_v1() from public,anon,authenticated;
create trigger libro_guard_revision_admin_v1 before insert or update on public.servicios
for each row execute function private.haiku_libro_guard_revision_admin_v1();

create function private.haiku_libro_revision_servicio_admin_impl_v1(
  p_operacion_id uuid,p_servicio_id uuid,p_item_id text,p_firma text,p_esperado jsonb,
  p_modo text,p_codigo text,p_inicio time,p_fin time,p_motivo text,p_conservar_importe boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private
as $$
declare
  v_uid uuid:=auth.uid(); v_hash text; v_op private.haiku_libro_revision_admin_ops_v1%rowtype;
  v_s public.servicios%rowtype; v_nuevo public.servicios%rowtype; v_final public.servicios%rowtype;
  v_r public.reservas%rowtype; v_e public.reserva_estadias%rowtype;
  v_catalogo public.catalogo_servicios%rowtype; v_codigo text; v_finanzas jsonb; v_revision jsonb;
  v_reserva uuid; v_resultado jsonb;
begin
  if private.haiku_libro_es_admin_v1() is distinct from true or private.haiku_tiene_permiso('servicios.editar') is distinct from true then
    raise exception 'Sólo un administrador activo con permiso para editar servicios puede confirmar esta revisión' using errcode='42501';
  end if;
  if p_operacion_id is null or p_servicio_id is null or p_item_id is null or p_item_id not like 'srv:%' or length(p_item_id)>256 or
     nullif(btrim(p_firma),'') is null or length(p_firma)>16000 or jsonb_typeof(p_esperado) is distinct from 'object' or
     p_modo is null or p_modo not in ('conservar','actualizar') or p_codigo is null or p_codigo not in ('tinajaTonel','tinajaJacuzzi') or
     p_inicio is null or p_fin is null or p_fin<=p_inicio or p_conservar_importe is distinct from true or
     nullif(btrim(p_motivo),'') is null or length(p_motivo)>1000 then
    raise exception 'Completa la decisión, el motivo y la confirmación del importe';
  end if;
  v_hash:=md5(jsonb_build_object('servicio',p_servicio_id,'item',p_item_id,'firma',p_firma,'esperado',p_esperado,
    'modo',p_modo,'codigo',p_codigo,'inicio',p_inicio,'fin',p_fin,'motivo',btrim(p_motivo))::text);
  insert into private.haiku_libro_revision_admin_ops_v1(operacion_id,usuario_id,solicitud_hash)
    values(p_operacion_id,v_uid,v_hash) on conflict(operacion_id) do nothing;
  select * into v_op from private.haiku_libro_revision_admin_ops_v1 where operacion_id=p_operacion_id for update;
  if v_op.usuario_id is distinct from v_uid or v_op.solicitud_hash is distinct from v_hash then
    raise exception 'La operación pertenece a otro usuario o solicitud' using errcode='42501';
  end if;
  if v_op.resultado is not null then return v_op.resultado||jsonb_build_object('reintento',true); end if;

  select reserva_id into v_reserva from public.servicios where id=p_servicio_id;
  if not found then raise exception 'No se encontró el servicio registrado'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_reserva::text,0));
  perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('reserva_finanzas',v_reserva::text));
  select * into v_r from public.reservas where id=v_reserva for update;
  select * into v_s from public.servicios where id=p_servicio_id for update;
  select * into v_e from public.reserva_estadias where id=v_s.estadia_id for update;
  if private.haiku_libro_estado_admin_v1(v_s) is distinct from p_esperado-'actualizado_en' or
     v_s.actualizado_en is distinct from (p_esperado->>'actualizado_en')::timestamptz then
    raise exception 'El servicio cambió desde la revisión; vuelve a consultar' using errcode='40001';
  end if;
  select codigo into v_codigo from public.catalogo_servicios where id=v_s.catalogo_servicio_id;
  if v_codigo not in ('tinajaTonel','tinajaJacuzzi') or v_codigo is null or v_r.id is null or
     v_r.estado_reserva not in ('pendiente','confirmada','hospedada','checked_out') or
     v_e.reserva_id is distinct from v_reserva or v_e.estado_estadia not in ('pendiente','confirmada','hospedada','checked_out') or
     v_s.estado_servicio not in ('programado','en_proceso','realizado') or
     v_s.fecha_servicio<v_e.fecha_ingreso or v_s.fecha_servicio>v_e.fecha_salida then
    raise exception 'Revisa la identidad y el estado de la tinaja antes de confirmar';
  end if;
  v_nuevo:=v_s;
  if p_modo='actualizar' then
    select * into v_catalogo from public.catalogo_servicios where codigo=p_codigo and activo;
    if not found or v_s.personas<1 or v_s.personas>coalesce(v_catalogo.capacidad_maxima,3) or
       p_inicio<time '08:00' or p_fin>time '23:15' or
       (v_e.tipo_estadia='fullday' and (p_inicio<time '09:30' or p_fin>time '21:30')) then
      raise exception 'El tipo, las personas o el horario requieren revisión';
    end if;
    v_nuevo.catalogo_servicio_id:=v_catalogo.id;v_nuevo.hora_inicio:=p_inicio;v_nuevo.hora_fin:=p_fin;
    if v_nuevo.catalogo_servicio_id<>v_s.catalogo_servicio_id then v_nuevo.recurso_id:=null; end if;
    perform pg_advisory_xact_lock(private.haiku_libro_lock_key_v1('tinaja_horario',
      coalesce(v_nuevo.recurso_id,v_nuevo.catalogo_servicio_id)::text||':'||v_nuevo.fecha_servicio::text));
    if exists(select 1 from public.servicios s where s.id<>v_s.id and s.fecha_servicio=v_s.fecha_servicio
      and s.estado_servicio not in ('cancelado','no_show') and
      (s.recurso_id=v_nuevo.recurso_id or (s.recurso_id is null or v_nuevo.recurso_id is null) and s.catalogo_servicio_id=v_nuevo.catalogo_servicio_id)
      and s.hora_inicio<p_fin and s.hora_fin>p_inicio) then
      raise exception 'El horario elegido se superpone con otra tinaja';
    end if;
  elsif p_codigo is distinct from v_codigo or p_inicio is distinct from v_s.hora_inicio or p_fin is distinct from v_s.hora_fin then
    raise exception 'Conservar requiere mantener el tipo y horario registrados';
  end if;
  v_finanzas:=private.haiku_libro_admin_finanzas_v1(v_reserva);
  v_revision:=jsonb_build_object('version',1,'item_id',p_item_id,'firma',p_firma,'modo',p_modo,
    'motivo',btrim(p_motivo),'usuario',v_uid,'operacion_id',p_operacion_id,'fecha',now(),
    'estado',private.haiku_libro_estado_admin_v1(v_nuevo));
  perform set_config('app.haiku_origen','haku',true);
  perform set_config('app.haiku_operacion_id',p_operacion_id::text,true);
  perform set_config('app.haiku_libro_revision_admin_v1',p_operacion_id::text,true);
  -- No incluir columnas financieras en SET. Sólo cambiar catálogo cuando
  -- corresponde; una aceptación del registro no dispara su sincronización.
  if v_nuevo.catalogo_servicio_id is distinct from v_s.catalogo_servicio_id then
    update public.servicios set catalogo_servicio_id=v_nuevo.catalogo_servicio_id,recurso_id=v_nuevo.recurso_id,
      hora_inicio=v_nuevo.hora_inicio,hora_fin=v_nuevo.hora_fin,libro_revision_admin_v1=v_revision
      where id=v_s.id returning * into v_final;
  else
    update public.servicios set hora_inicio=v_nuevo.hora_inicio,hora_fin=v_nuevo.hora_fin,libro_revision_admin_v1=v_revision
      where id=v_s.id returning * into v_final;
  end if;
  if (to_jsonb(v_final)-array['catalogo_servicio_id','recurso_id','hora_inicio','hora_fin','libro_revision_admin_v1','actualizado_en']) is distinct from
     (to_jsonb(v_s)-array['catalogo_servicio_id','recurso_id','hora_inicio','hora_fin','libro_revision_admin_v1','actualizado_en']) or
     private.haiku_libro_estado_admin_v1(v_final) is distinct from v_revision->'estado' or
     private.haiku_libro_admin_finanzas_v1(v_reserva) is distinct from v_finanzas then
    raise exception 'El cambio alteraría importes, pagos o comprobantes; no se guardó la revisión';
  end if;
  if (select count(*) from public.eventos_auditoria a where a.entidad_tipo='servicios' and a.entidad_id=v_s.id
      and a.usuario_id=v_uid and a.origen='haku' and a.datos_contexto->>'operacion_id'=p_operacion_id::text
      and exists(select 1 from jsonb_array_elements(a.cambios) c where c->>'campo'='libro_revision_admin_v1'))<>1 then
    raise exception 'No se pudo acreditar la decisión en el historial';
  end if;
  v_resultado:=jsonb_build_object('ok',true,'operacion_id',p_operacion_id,'servicio_id',v_s.id,'total',v_final.total,'revision',v_revision);
  update private.haiku_libro_revision_admin_ops_v1 set resultado=v_resultado where operacion_id=p_operacion_id;
  return v_resultado;
end;$$;
revoke all on function private.haiku_libro_revision_servicio_admin_impl_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean) from public,anon,authenticated;
grant execute on function private.haiku_libro_revision_servicio_admin_impl_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean) to authenticated;

create function public.haiku_libro_revision_servicio_admin_v1(
  p_operacion_id uuid,p_servicio_id uuid,p_item_id text,p_firma text,p_esperado jsonb,
  p_modo text,p_codigo text,p_inicio time,p_fin time,p_motivo text,p_conservar_importe boolean
) returns jsonb language sql security invoker set search_path=pg_catalog,public,private
as $$select private.haiku_libro_revision_servicio_admin_impl_v1(
  p_operacion_id,p_servicio_id,p_item_id,p_firma,p_esperado,p_modo,p_codigo,p_inicio,p_fin,p_motivo,p_conservar_importe
);$$;
revoke all on function public.haiku_libro_revision_servicio_admin_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean) from public,anon,authenticated;
grant execute on function public.haiku_libro_revision_servicio_admin_v1(uuid,uuid,text,text,jsonb,text,text,time,time,text,boolean) to authenticated;
