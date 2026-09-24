-- Conservar los cinco estados existentes y admitir "no requiere" hacia adelante.
-- No reclasifica ni modifica filas historicas con estado cancelado.
alter table public.aseos
    drop constraint aseos_estado_valido,
    add constraint aseos_estado_valido check (
        estado = any (array[
            'pendiente'::text,
            'asignado'::text,
            'en_proceso'::text,
            'completado'::text,
            'cancelado'::text,
            'no_requiere'::text
        ])
    );
