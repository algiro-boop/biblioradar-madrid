-- Ampliaciones del catálogo sin cambiar la firma RPC ni sus permisos.
-- El cliente exige el tamaño completo esperado; el servidor valida mínimo y unicidad.
begin;

create or replace function public.sync_csv_catalog(p_rows jsonb,p_csv_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_active integer; v_inactive integer; v_day integer; v_hour integer; v_value jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<88
    or p_csv_sha256 is null or p_csv_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Se requiere el CSV completo de al menos 88 filas y SHA256' using errcode='22023';
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows)
    or (select count(distinct lower(trim(x->>'name'))) from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then
    raise exception 'Nombres o UUID duplicados' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('biblioradar:csv-refresh',0));
  -- Bloquear todo el catálogo en orden estable; no eliminar históricos ni reportes.
  perform id from public.libraries order by id for update;
  for r in select * from jsonb_to_recordset(p_rows) as x(
    id uuid,name text,tipo text,valoracion double precision,num_resenas integer,direccion text,telefono text,
    opening_hours jsonb,historical_popularity jsonb,lat double precision,lng double precision,
    institution public.institution_type,district text,source_url text
  ) order by id loop
    if r.name is null or length(trim(r.name))=0 or r.num_resenas<0
      or not coalesce(r.valoracion between 0 and 5,true)
      or r.opening_hours->>'timezone' is distinct from 'Europe/Madrid'
      or jsonb_typeof(r.opening_hours->'weekly') is distinct from 'object'
      or r.historical_popularity->>'model' is distinct from 'csv-v1'
      or jsonb_typeof(r.historical_popularity->'days') is distinct from 'object' then
      raise exception 'Fila CSV inválida' using errcode='22023';
    end if;
    for v_day in 1..7 loop
      if jsonb_typeof(r.opening_hours->'weekly'->v_day::text) not in ('array','null')
        or r.opening_hours->'weekly'->v_day::text is null then
        raise exception 'Horario semanal incompleto' using errcode='22023';
      end if;
      for v_hour in 6..23 loop
        v_value := r.historical_popularity->'days'->v_day::text->lpad(v_hour::text,2,'0');
        if v_value is null or jsonb_typeof(v_value) not in ('number','null') then
          raise exception 'Curva semanal incompleta' using errcode='22023';
        end if;
        if jsonb_typeof(v_value)='number' and not (v_value::text::numeric between 0 and 100) then
          raise exception 'Curva fuera de rango' using errcode='22023';
        end if;
      end loop;
    end loop;
    if not exists(select 1 from public.libraries where id=r.id) then
      if not (r.lat between 40 and 41 and r.lng between -4.5 and -3)
        or r.lat is null or r.lng is null or r.source_url is null or r.institution is null then
        raise exception 'Nueva ficha requiere coordenadas verificadas' using errcode='22023';
      end if;
      insert into public.libraries(id,source,source_id,source_url,name,institution,address,district,lat,lng)
        values(r.id,'csv-master',r.id::text,r.source_url,r.name,r.institution,r.direccion,coalesce(r.district,''),r.lat,r.lng);
    end if;
    update public.libraries set name=r.name,tipo=r.tipo,valoracion=r.valoracion,num_resenas=r.num_resenas,
      direccion=r.direccion,address=coalesce(nullif(r.direccion,''),address),telefono=r.telefono,
      opening_hours=r.opening_hours,historical_popularity=r.historical_popularity,is_active=true,csv_sha256=p_csv_sha256
      where id=r.id;
    -- La nueva curva no hereda el prior del CSV anterior.
    update public.occupancy_status set inertia_anchor=null,inertia_curve=null,inertia_at=null,prior_occupancy=null
      where library_id=r.id;
  end loop;
  update public.libraries set is_active=false
    where id not in(select (x->>'id')::uuid from jsonb_array_elements(p_rows) x);
  update public.occupancy_status s set prior_occupancy=null,bayesian_occupancy=null,final_occupancy_pct=null,
    predicted_base_pct=null,google_live_pct=null,google_hist_pct=null,base_observed_at=null,base_valid_until=null,
    confidence_score=0,is_open_now=false,active_reports_count=0,crowd_pct=null,
    primary_source='Fuera del catálogo activo',base_source='Fuera del catálogo activo'
    from public.libraries l where l.id=s.library_id and not l.is_active;
  perform public.refresh_csv_occupancy(false);
  select count(*) filter(where is_active),count(*) filter(where not is_active) into v_active,v_inactive from public.libraries;
  if v_active<>jsonb_array_length(p_rows) then raise exception 'Catálogo incompleto' using errcode='22023'; end if;
  return jsonb_build_object('active',v_active,'inactive',v_inactive,'csv_sha256',p_csv_sha256);
end;
$$;


commit;
