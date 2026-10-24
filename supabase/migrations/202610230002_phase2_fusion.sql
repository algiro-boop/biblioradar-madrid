begin;

alter table public.occupancy_status
  add column base_source text not null default 'Sin datos de ocupación',
  add column base_observed_at timestamptz,
  add column base_valid_until timestamptz;

-- Los consumidores solo pueden leer el agregado. La recomputación es privilegiada.
create function public.recalculate_library_occupancy(p_library_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_base integer;
  v_source text;
  v_valid_until timestamptz;
  v_now timestamptz;
  v_count integer;
  v_weight numeric;
  v_mean numeric;
  v_confidence numeric;
  v_final integer;
begin
  -- Mismo bloqueo para cron y reportes. El agregado se consulta DESPUÉS de adquirirlo.
  select predicted_base_pct, base_source, base_valid_until
    into v_base, v_source, v_valid_until
    from public.occupancy_status where library_id = p_library_id for update;
  if not found then
    raise exception 'Biblioteca sin estado' using errcode = '22023';
  end if;
  v_now := clock_timestamp();
  -- Un dato antiguo no recupera apariencia de actualidad por recibir nuevos reportes.
  if v_valid_until is not null and v_valid_until <= v_now then
    v_base := null;
    v_source := 'Base caducada';
  end if;
  select count(*)::integer, coalesce(sum(w), 0), sum(reported_value * w) / nullif(sum(w), 0)
    into v_count, v_weight, v_mean
    from (
      select reported_value, exp(-extract(epoch from (v_now - created_at)) / 2700) as w
      from public.user_reports
      where library_id = p_library_id
        and created_at >= v_now - interval '90 minutes' and created_at <= v_now
    ) recent;
  v_confidence := least(0.85::numeric, v_weight * 0.35);
  if v_count = 0 then
    v_final := v_base;
  elsif v_base is null then
    -- Sin base, usar solo reportes: no inventar una ocupación cero como contraparte.
    v_final := round(v_mean)::integer;
  else
    v_final := round(v_mean * v_confidence + v_base * (1 - v_confidence))::integer;
  end if;
  update public.occupancy_status set
    predicted_base_pct = v_base,
    crowd_pct = round(v_mean)::integer,
    active_reports_count = v_count,
    final_occupancy_pct = v_final,
    primary_source = case when v_count > 0 then
      format('Reportado por %s estudiante(s)%s', v_count,
        case when v_base is null then ' · sin base disponible' else ' + ' || v_source end)
      else v_source end
    where library_id = p_library_id;
end;
$$;

create function public.report_recalculate_occupancy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.recalculate_library_occupancy(new.library_id);
  return new;
end;
$$;
create trigger reports_recalculate after insert on public.user_reports
  for each row execute function public.report_recalculate_occupancy();

-- Un batch completo se aplica en una transacción. No admite escribir el agregado final.
-- La API nunca calcula la fusión con una copia potencialmente obsoleta de los reportes.
create function public.update_occupancy_bases(p_updates jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
  v_count integer := 0;
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
    predicted_base_pct integer, base_source text
  ) order by library_id loop
    if v_row.library_id is null or v_row.base_source is null
      or length(v_row.base_source) not between 1 and 250 then
      raise exception 'Base inválida' using errcode = '22023';
    end if;
    update public.occupancy_status set
      google_live_pct = v_row.google_live_pct,
      google_hist_pct = v_row.google_hist_pct,
      predicted_base_pct = v_row.predicted_base_pct,
      base_source = v_row.base_source,
      base_observed_at = clock_timestamp(),
      base_valid_until = clock_timestamp() + interval '60 minutes'
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

revoke all on function public.recalculate_library_occupancy(uuid)
  from public, anon, authenticated;
revoke all on function public.report_recalculate_occupancy()
  from public, anon, authenticated;
revoke all on function public.update_occupancy_bases(jsonb)
  from public, anon, authenticated;
grant execute on function public.recalculate_library_occupancy(uuid) to service_role;
grant execute on function public.update_occupancy_bases(jsonb) to service_role;
commit;
