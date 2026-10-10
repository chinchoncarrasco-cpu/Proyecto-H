-- No reasocia ni fusiona huéspedes. Un documento ocupado o una identidad
-- compartida incompatible exige revisión humana; el lote conserva su atomicidad.
begin;
do $migration$
declare
  f record;
  despues record;
  original text;
  nuevo text;
  antiguo text;
  reemplazo text;
begin
  select p.*,l.lanname into f from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=to_regprocedure('private.haiku_libro_actualizar_v1(jsonb)');
  -- Cadena versionada: prioridad, ocupación conocida y Airbnb. Nunca reemplazar
  -- silenciosamente otro cuerpo desplegado ni perder su rama financiera.
  if not found or f.lanname<>'plpgsql' or f.prosecdef or f.prorettype<>'jsonb'::regtype
    or f.proretset or f.proargnames is distinct from array['p_item']
    or regexp_replace(array_to_string(f.proconfig,','),'\s','','g') is distinct from 'search_path=pg_catalog,public,private'
    or md5(replace(f.prosrc,E'\r',''))<>'b9b1a3567ddc9b6ed79b9bca5867a143' then
    raise exception 'Writer Libro no coincide con la definición auditada; revisar antes de aplicar protección de identidad';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.oid=to_regclass('public.huespedes_documento_uidx')
      and i.indrelid='public.huespedes'::regclass and i.indisunique and i.indisvalid and i.indnkeyatts=2
      and i.indexprs is null and
        (select array_agg(a.attname::text order by k.orden) from unnest(i.indkey) with ordinality k(attnum,orden)
          join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum where k.orden<=2)=array['tipo_documento','numero_documento']
      and regexp_replace(lower(pg_get_expr(i.indpred,i.indrelid)),'[\s()]','','g') in
        ('tipo_documentoisnotnullandnumero_documentoisnotnull','numero_documentoisnotnullandtipo_documentoisnotnull')
  ) then
    raise exception 'Índice de documentos inesperado; revisar restricciones antes de aplicar';
  end if;
  original:=replace(pg_get_functiondef(f.oid),E'\r','');
  nuevo:=replace(original,'v_date_change boolean;',
    'v_date_change boolean; v_h public.huespedes%rowtype; v_compartido boolean; v_constraint text;');
  antiguo:=$old$    v_before:=jsonb_build_object('reserva',to_jsonb(v_r),'estadia',to_jsonb(v_e));$old$;
  reemplazo:=$new$    -- Bloquear el registro actual antes de comprobar sus referencias. Los FK
    -- no pueden incorporar nuevas referencias a este huésped durante la edición.
    v_compartido:=false;
    if v_r.titular_huesped_id is not null then
      select * into v_h from public.huespedes where id=v_r.titular_huesped_id for update;
      if not found then
        raise exception 'La asociación del titular requiere revisión manual; vuelve a preparar'
          using errcode='HLI02',detail=jsonb_build_object('item_id',p_item->>'item_id','motivo','asociacion_invalida')::text;
      end if;
      select exists(select 1 from public.reservas where id<>v_r.id and titular_huesped_id=v_h.id)
        or exists(select 1 from public.reserva_huespedes where reserva_id<>v_r.id and huesped_id=v_h.id)
        or exists(select 1 from public.estadia_huespedes eh join public.reserva_estadias e on e.id=eh.estadia_id
          where e.reserva_id<>v_r.id and eh.huesped_id=v_h.id) into v_compartido;
    end if;
    -- Igualdad exacta del índice. Nunca inferir equivalencia de personas por nombre.
    if v_nr.titular_tipo_documento is not null and v_nr.titular_numero_documento is not null and exists(
      select 1 from public.huespedes h where h.tipo_documento=v_nr.titular_tipo_documento
        and h.numero_documento=v_nr.titular_numero_documento and h.id is distinct from v_r.titular_huesped_id
    ) then
      raise exception 'El documento pertenece a otro huésped; requiere revisión manual. No se guardó el lote'
        using errcode='HLI01',detail=jsonb_build_object('item_id',p_item->>'item_id','motivo','documento_otro_huesped')::text;
    end if;
    if v_compartido and (v_r.titular_nombre is distinct from v_nr.titular_nombre
      or v_r.titular_tipo_documento is distinct from v_nr.titular_tipo_documento
      or v_r.titular_numero_documento is distinct from v_nr.titular_numero_documento)
      and (v_h.nombre is distinct from v_nr.titular_nombre
      or v_h.tipo_documento is distinct from v_nr.titular_tipo_documento
      or v_h.numero_documento is distinct from v_nr.titular_numero_documento) then
      raise exception 'El huésped está compartido y la identidad difiere; requiere revisión manual. No se guardó el lote'
        using errcode='HLI02',detail=jsonb_build_object('item_id',p_item->>'item_id','motivo','huesped_compartido')::text;
    end if;
    v_before:=jsonb_build_object('reserva',to_jsonb(v_r),'estadia',to_jsonb(v_e));$new$;
  if length(original)-length(replace(original,antiguo,''))<>length(antiguo) then
    raise exception 'Punto de validación del writer inesperado';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  antiguo:=$old$    -- Do not alter a shared guest record that also belongs to another reservation.
    if v_r.titular_huesped_id is not null and not exists(select 1 from public.reservas where id<>v_r.id and titular_huesped_id=v_r.titular_huesped_id) then
      update public.huespedes set nombre=v_nr.titular_nombre,numero_documento=v_nr.titular_numero_documento,tipo_documento=v_nr.titular_tipo_documento,
        correo=v_nr.correo_contacto,telefono=v_nr.telefono_contacto where id=v_r.titular_huesped_id;
    end if;$old$;
  reemplazo:=$new$    if v_r.titular_huesped_id is not null and not v_compartido then
      begin
        update public.huespedes set nombre=v_nr.titular_nombre,numero_documento=v_nr.titular_numero_documento,tipo_documento=v_nr.titular_tipo_documento,
          correo=v_nr.correo_contacto,telefono=v_nr.telefono_contacto where id=v_r.titular_huesped_id;
      exception when unique_violation then
        -- El índice sigue siendo autoridad ante una ocupación concurrente.
        -- No filtrar el documento ni reutilizar el payload como retry de red.
        get stacked diagnostics v_constraint=constraint_name;
        if v_constraint is distinct from 'huespedes_documento_uidx' then raise; end if;
        raise exception 'El documento pertenece a otro huésped; requiere revisión manual. No se guardó el lote'
          using errcode='HLI01',detail=jsonb_build_object('item_id',p_item->>'item_id','motivo','documento_otro_huesped')::text;
      end;
    end if;$new$;
  if length(original)-length(replace(original,antiguo,''))<>length(antiguo) then
    raise exception 'Punto de actualización del huésped inesperado';
  end if;
  nuevo:=replace(nuevo,antiguo,reemplazo);
  execute nuevo;
  select * into despues from pg_proc where oid=f.oid;
  if despues.proowner is distinct from f.proowner or despues.proacl is distinct from f.proacl
    or despues.prosecdef is distinct from f.prosecdef or despues.proconfig is distinct from f.proconfig then
    raise exception 'La protección alteró owner/ACL/security/search_path';
  end if;
end;
$migration$;
commit;
