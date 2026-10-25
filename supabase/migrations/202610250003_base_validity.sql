begin;

-- El cron puede indicar hasta cuándo vale cada base: hasta el siguiente cambio de apertura
-- (p. ej. las 09:00) o un margen de varios ciclos. Sin el campo se mantienen 60 minutos.
-- El servidor acota el valor: al menos 1 minuto y como mucho 3 horas desde la recepción.
-- Mismo contrato y permisos que en 202610230002_phase2_fusion.sql; solo cambia la validez.
create or replace function public.update_occupancy_bases(p_updates jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count integer := 0;
  v_now timestamptz;
begin
  if p_updates is null or jsonb_typeof(p_updates) <> 'array'
    or jsonb_array_length(p_updates) > 1000 then
    raise exception 'Se esperaba un array de hasta 1000 bases' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_updates) x
    where jsonb_typeof(x) <> 'object' or not (x ? 'library_id')
      or not (x ? 'predicted_base_pct') or not (x ? 'base_source')) then
    raise exception 'Base incompleta' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_updates) as x(library_id uuid)
    group by library_id having count(*) > 1) then
    raise exception 'Bibliotecas duplicadas en batch' using errcode = '22023';
  end if;
  -- Orden total para evitar interbloqueos entre batches simultáneos.
  for v_row in select * from jsonb_to_recordset(p_updates) as x(
    library_id uuid, google_live_pct integer, google_hist_pct integer,
    predicted_base_pct integer, base_source text, base_valid_until timestamptz
  ) order by library_id loop
    if v_row.library_id is null or v_row.base_source is null
      or length(v_row.base_source) not between 1 and 250 then
      raise exception 'Base inválida' using errcode = '22023';
    end if;
    v_now := clock_timestamp();
    update public.occupancy_status set
      google_live_pct = v_row.google_live_pct,
      google_hist_pct = v_row.google_hist_pct,
      predicted_base_pct = v_row.predicted_base_pct,
      base_source = v_row.base_source,
      base_observed_at = v_now,
      base_valid_until = least(
        v_now + interval '3 hours',
        greatest(
          v_now + interval '1 minute',
          coalesce(v_row.base_valid_until, v_now + interval '60 minutes')
        )
      )
      where library_id = v_row.library_id;
    if not found then
      raise exception 'Biblioteca sin estado' using errcode = '22023';
    end if;
    perform public.recalculate_library_occupancy(v_row.library_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.update_occupancy_bases(jsonb)
  from public, anon, authenticated;
grant execute on function public.update_occupancy_bases(jsonb) to service_role;
commit;
