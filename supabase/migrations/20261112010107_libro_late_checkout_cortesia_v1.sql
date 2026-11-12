-- Late Check-out puede guardarse a $0 desde la revisión del Libro con salida explícita.
begin;

do $migration$
declare
  anterior pg_proc%rowtype;
  posterior pg_proc%rowtype;
  definicion text;
  cuerpo text;
  cambio record;
  restriccion text := $old$not c.permite_cortesia or codigo not like 'tinaja%'$old$;
  permiso text := $new$not c.permite_cortesia or (codigo not like 'tinaja%' and codigo <> 'lateCheckout')$new$;
  entrada text := $entry$  if not p_item ? 'servicio_manual_v1' then return null; end if;$entry$;
  entrada_con_guardia text := $manual$  if not p_item ? 'servicio_manual_v1' then
    if codigo='lateCheckout' and p_item->>'tipo_cobro'='cortesia' then
      raise exception 'Confirma esta cortesía de Late Check-out en la revisión manual del Libro';
    end if;
    return null;
  end if;$manual$;
  ancla text := $anchor$  unitario := coalesce((p_item->>'precio_manual')::bigint,c.precio_base,0);$anchor$;
  evidencia text := $guard$  if codigo='lateCheckout' and p_item->>'tipo_cobro'='cortesia' and (
      d->'evidencia_original'->>'intencion_cobro' is distinct from 'cortesia'
      or coalesce(d->'evidencia_original'->>'texto','') !~* '\m(co+rtes[ií]a|regalo)\M'
      or coalesce(d->'evidencia_original'->>'texto','') ~* '\m(no([[:space:]]+es)?|sin)[[:space:]]+(co+rtes[ií]a|regalo)\M'
      or coalesce(d->'evidencia_original'->>'monto','0') <> '0'
      or e.fecha_ingreso >= e.fecha_salida or e.tipo_estadia = 'full_day'
      or hora is distinct from '12:00'::time
      or (d->'evidencia_original'->>'hora_fin' is not null and d->'evidencia_original'->>'hora' is distinct from '12:00')
      or left(fin::text,5) is distinct from coalesce(d->'evidencia_original'->>'hora_fin',d->'evidencia_original'->>'hora')
      or p_item->>'precio_manual' is not null) then
    raise exception 'La cortesía de Late Check-out requiere la hora de salida explícita del Libro y total cero';
  end if;
$guard$;
begin
  select * into anterior from pg_proc
    where oid=to_regprocedure('private.haiku_libro_servicio_manual_validar_v1(jsonb)');
  if not found or anterior.prosecdef or anterior.proowner <> 'postgres'::regrole then
    raise exception 'Contrato inesperado de validación de servicios manuales';
  end if;
  if position(permiso in anterior.prosrc)>0 and position(evidencia in anterior.prosrc)>0
     and position(entrada_con_guardia in anterior.prosrc)>0 then
    return;
  end if;
  definicion := pg_get_functiondef(anterior.oid);
  cuerpo := anterior.prosrc;
  for cambio in select * from (values
      (restriccion,permiso),(entrada,entrada_con_guardia),(ancla,evidencia||ancla)
    ) patrones(antes,despues)
  loop
    if (length(cuerpo)-length(replace(cuerpo,cambio.antes,'')))/length(cambio.antes)<>1 then
      raise exception 'La validación de servicios cambió; revisar antes de habilitar la cortesía';
    end if;
    cuerpo := replace(cuerpo,cambio.antes,cambio.despues);
    definicion := replace(definicion,cambio.antes,cambio.despues);
  end loop;
  execute definicion;
  select * into posterior from pg_proc where oid=anterior.oid;
  if posterior.proacl is distinct from anterior.proacl or posterior.proowner is distinct from anterior.proowner
     or posterior.prosecdef is distinct from anterior.prosecdef or posterior.proconfig is distinct from anterior.proconfig
     or posterior.prosrc is distinct from cuerpo then
    raise exception 'La validación debe conservar permisos y el resto del contrato de servicios';
  end if;
end;
$migration$;

do $catalogo$
begin
  if (select count(*) from public.catalogo_servicios
      where codigo='lateCheckout' and activo and unidad='hora' and duracion_minutos is null) <> 1 then
    raise exception 'Late Check-out debe ser un servicio activo de extensión por hora';
  end if;
  update public.catalogo_servicios set permite_cortesia=true
    where codigo='lateCheckout' and permite_cortesia is distinct from true;
end;
$catalogo$;

commit;
