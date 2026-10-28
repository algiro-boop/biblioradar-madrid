-- Idempotente; aplicar después de 202610260004. No elimina fichas ni reportes.
begin;
alter table public.libraries
  add column if not exists tipo text,
  add column if not exists valoracion double precision,
  add column if not exists num_resenas integer,
  add column if not exists direccion text,
  add column if not exists telefono text,
  add column if not exists opening_hours jsonb,
  add column if not exists historical_popularity jsonb,
  add column if not exists is_active boolean not null default true,
  add column if not exists csv_sha256 text;
alter table public.occupancy_status
  add column if not exists prior_occupancy integer check (prior_occupancy between 0 and 100),
  add column if not exists bayesian_occupancy integer check (bayesian_occupancy between 0 and 100),
  add column if not exists confidence_score double precision check (confidence_score between 0 and 1),
  add column if not exists is_open_now boolean,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists inertia_anchor numeric,
  add column if not exists inertia_curve numeric,
  add column if not exists inertia_at timestamptz;
create index if not exists libraries_active_idx on public.libraries(is_active);
create index if not exists user_reports_csv_recent_idx on public.user_reports(created_at desc,library_id,device_hash);

create or replace function public.csv_open_at(p_hours jsonb, p_now timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Madrid';
  v_slots jsonb;
  v_slot jsonb;
  v_minutes numeric := extract(hour from v_local)*60 + extract(minute from v_local)
    + extract(second from v_local)/60;
begin
  if p_hours->'date_overrides' ? v_local::date::text then
    v_slots := p_hours->'date_overrides'->v_local::date::text;
  else
    v_slots := p_hours->'weekly'->extract(isodow from v_local)::integer::text;
  end if;
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then return null; end if;
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    if v_minutes >= split_part(v_slot->>0, ':', 1)::integer*60 + split_part(v_slot->>0, ':', 2)::integer
      and v_minutes < split_part(v_slot->>1, ':', 1)::integer*60 + split_part(v_slot->>1, ':', 2)::integer then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function public.csv_curve_at(p_history jsonb, p_hours jsonb, p_now timestamptz)
returns numeric language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Madrid';
  v_hour integer := extract(hour from v_local);
  v_day text := extract(isodow from v_local)::integer::text;
  v_fraction numeric := extract(minute from v_local)/60 + extract(second from v_local)/3600;
  v_left numeric;
  v_right numeric;
  v_slot jsonb;
  v_end numeric;
begin
  if public.csv_open_at(p_hours, p_now) is not true then return null; end if;
  v_left := (p_history->'days'->v_day->>lpad(v_hour::text,2,'0'))::numeric;
  -- No interpolar hacia una hora cerrada ni a través de la pausa de mediodía.
  -- Si el cierre cae entre dos puntos, se reduce suavemente hasta cero al cerrar.
  for v_slot in select value from jsonb_array_elements(
    coalesce(p_hours->'date_overrides'->v_local::date::text, p_hours->'weekly'->v_day)) loop
    v_end := split_part(v_slot->>1,':',1)::numeric + split_part(v_slot->>1,':',2)::numeric/60;
    if v_hour + v_fraction < v_end and v_hour >= split_part(v_slot->>0,':',1)::numeric then
      if v_end <= v_hour + 1 then
        return case when v_left is null then null else v_left * (v_end-v_hour-v_fraction)/(v_end-v_hour) end;
      end if;
    end if;
  end loop;
  if v_hour < 23 then
    v_right := (p_history->'days'->v_day->>lpad((v_hour+1)::text,2,'0'))::numeric;
  end if;
  if v_fraction = 0 or v_right is null then return v_left; end if;
  if v_left is null then return null; end if;
  return v_left*(1-v_fraction)+v_right*v_fraction;
end;
$$;

-- Preservar el motor anterior solo para filas que aún no se hayan importado del CSV.
do $$ begin
  if to_regprocedure('public.recalculate_library_occupancy_legacy(uuid)') is null then
    alter function public.recalculate_library_occupancy(uuid) rename to recalculate_library_occupancy_legacy;
  end if;
end $$;

create or replace function public.recalculate_csv_occupancy(p_library_id uuid, p_now timestamptz default clock_timestamp())
returns void language plpgsql security definer set search_path = '' as $$
declare
  l public.libraries%rowtype;
  s public.occupancy_status%rowtype;
  v_open boolean;
  v_csv numeric;
  v_mu numeric;
  v_k numeric;
  v_a numeric;
  v_b numeric;
  v_weight numeric := 0;
  v_weighted numeric := 0;
  v_count integer := 0;
  v_final integer;
  v_prior integer;
  v_conf numeric := 0;
  v_spatial numeric := 0;
  v_anchor numeric;
  v_anchor_curve numeric;
  v_anchor_at timestamptz;
  v_now_local timestamp := p_now at time zone 'Europe/Madrid';
  v_month integer := extract(month from v_now_local);
  v_day text := (p_now at time zone 'Europe/Madrid')::date::text;
  v_bucket timestamptz := to_timestamp(floor(extract(epoch from p_now)/1800)*1800);
  v_report record;
  v_fallback boolean := false;
begin
  select * into l from public.libraries where id=p_library_id;
  if not found then raise exception 'Biblioteca inexistente' using errcode='22023'; end if;
  if not l.is_active then return; end if;
  select * into s from public.occupancy_status where library_id=p_library_id for update;
  if not found then
    insert into public.occupancy_status(library_id) values(p_library_id);
    select * into s from public.occupancy_status where library_id=p_library_id for update;
  end if;
  v_open := public.csv_open_at(l.opening_hours,p_now);
  if v_open is false then
    v_final := 0; v_prior := 0; v_conf := 1;
  elsif v_open is true then
    v_csv := public.csv_curve_at(l.historical_popularity,l.opening_hours,p_now);
    v_fallback := v_csv is null;
    -- Heurística solo si faltan puntos abiertos, nunca rellena el CSV con datos inventados.
    v_csv := coalesce(v_csv, 40);
    v_mu := v_csv/100;
    if v_month in (12,1,5,6) then v_mu := v_mu*1.20;
    elsif v_month=8 then v_mu := v_mu*.75; end if;
    if coalesce(l.opening_hours->'holidays','[]'::jsonb) ? v_day then v_mu := v_mu*.85; end if;
    -- Vecinos: evidencia directa reciente, no sus posteriores (evita feedback circular).
    with latest as (
      select distinct on(r.library_id,r.device_hash) r.*, n.lat,n.lng,n.num_resenas,
        public.csv_curve_at(n.historical_popularity,n.opening_hours,r.created_at) expected
      from public.user_reports r join public.libraries n on n.id=r.library_id
      where n.is_active and n.id<>l.id and n.historical_popularity->>'model'='csv-v1'
        and r.created_at between greatest(p_now-interval '90 minutes',
          (v_now_local::date::timestamp at time zone 'Europe/Madrid')) and p_now
        and r.reported_value between 0 and 100
      order by r.library_id,r.device_hash,r.created_at desc,r.id desc
    ), neighbors as (
      select library_id, min(num_resenas) reviews,
        6371000*2*asin(sqrt(least(1.0, power(sin(radians(lat-l.lat)/2),2)
          +cos(radians(lat))*cos(radians(l.lat))*power(sin(radians(lng-l.lng)/2),2)))) meters,
        sum((reported_value-expected)/100*exp(-ln(2::numeric)*extract(epoch from(p_now-created_at))/2400))
          /nullif(sum(exp(-ln(2::numeric)*extract(epoch from(p_now-created_at))/2400)),0) anomaly
      from latest where expected is not null group by library_id,lat,lng
    )
    select coalesce(sum(greatest(-.15,least(.15,anomaly)) * (1-meters/2500) * ln(2+coalesce(reviews,0)))
      /nullif(sum((1-meters/2500)*ln(2+coalesce(reviews,0))),0),0)*.25 into v_spatial
      from neighbors where meters<2500 and abs(anomaly)>=.10;
    v_mu := v_mu+v_spatial;
    -- Ancla fija por media hora; usar el PRIOR anterior evita volver a contar sus reportes.
    v_anchor := s.inertia_anchor; v_anchor_curve := s.inertia_curve; v_anchor_at := s.inertia_at;
    if v_anchor_at is null or v_anchor_at<v_bucket then
      v_anchor := s.prior_occupancy::numeric/100;
      v_anchor_curve := public.csv_curve_at(l.historical_popularity,l.opening_hours,s.updated_at)/100;
      v_anchor_at := v_bucket;
    end if;
    if v_anchor is not null and p_now-s.updated_at between interval '0 seconds' and interval '3 hours'
      and s.is_open_now is true then
      v_mu := .8*v_mu + .2*(v_anchor + v_csv/100-coalesce(v_anchor_curve,v_csv/100));
    end if;
    v_mu := greatest(.02,least(.98,v_mu));
    v_k := case when v_fallback then 6 else least(24,8+2*ln(1+greatest(0,coalesce(l.num_resenas,0)))) end;
    v_prior := round(v_mu*100)::integer;
    v_a := v_mu*v_k; v_b := (1-v_mu)*v_k;
    for v_report in
      select distinct on(device_hash) reported_value,created_at
      from public.user_reports where library_id=l.id
        and created_at between p_now-interval '90 minutes' and p_now and reported_value between 0 and 100
      order by device_hash,created_at desc,id desc
    loop
      v_count := v_count+1;
      v_weight := 20*exp(-ln(2::numeric)*extract(epoch from(p_now-v_report.created_at))/2400);
      v_a := v_a+v_weight*v_report.reported_value/100;
      v_b := v_b+v_weight*(1-v_report.reported_value/100::numeric);
      v_weighted := v_weighted+v_weight*v_report.reported_value;
    end loop;
    v_weight := v_a+v_b-v_k;
    v_final := round(v_a/(v_a+v_b)*100)::integer;
    v_conf := v_weight/(v_k+v_weight);
  end if;
  update public.occupancy_status set
    prior_occupancy=v_prior,bayesian_occupancy=v_final,confidence_score=v_conf,is_open_now=v_open,
    google_live_pct=null,google_hist_pct=null,
    predicted_base_pct=v_prior,final_occupancy_pct=v_final,
    crowd_pct=case when v_weight>0 then round(v_weighted/v_weight)::integer else null end,
    active_reports_count=v_count,
    base_source=case when v_open is null then 'Horario no informado en CSV'
      when not v_open then 'Cerrada según horario CSV' else 'Prior contextual CSV' end,
    primary_source=case when v_open is null then 'Horario no informado en CSV'
      when not v_open then 'Cerrada según horario CSV'
      else 'Estimación bayesiana · CSV' || case when v_fallback then ' (curva incompleta)' else '' end
        || format(' + %s reporte(s)',v_count) end,
    base_observed_at=p_now,base_valid_until=p_now+interval '30 minutes',
    inertia_anchor=v_anchor,inertia_curve=v_anchor_curve,inertia_at=v_anchor_at
    where library_id=l.id;
end;
$$;

create or replace function public.recalculate_library_occupancy(p_library_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.libraries where id=p_library_id and historical_popularity->>'model'='csv-v1') then
    perform public.recalculate_csv_occupancy(p_library_id);
  else
    perform public.recalculate_library_occupancy_legacy(p_library_id);
  end if;
end;
$$;

create or replace function public.refresh_csv_occupancy(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l record; v_count integer:=0; v_now timestamptz:=clock_timestamp();
begin
  -- Una ejecución cron/sync a la vez, sin bloquear al usuario ni perder reportes.
  if not pg_try_advisory_xact_lock(hashtextextended('biblioradar:csv-refresh',0)) then
    return jsonb_build_object('skipped',true,'reason','refresh_running');
  end if;
  for l in select id from public.libraries where is_active and historical_popularity->>'model'='csv-v1' order by id loop
    if not p_dry_run then perform public.recalculate_csv_occupancy(l.id,v_now); end if;
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('libraries',v_count,'dry_run',p_dry_run);
end;
$$;

create or replace function public.sync_csv_catalog(p_rows jsonb,p_csv_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; v_active integer; v_inactive integer; v_day integer; v_hour integer; v_value jsonb;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<>88
    or p_csv_sha256 is null or p_csv_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Se requiere el CSV completo de 88 filas y SHA256' using errcode='22023';
  end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_rows) x)<>88
    or (select count(distinct lower(trim(x->>'name'))) from jsonb_array_elements(p_rows) x)<>88 then
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
  if v_active<>88 then raise exception 'Catálogo incompleto' using errcode='22023'; end if;
  return jsonb_build_object('active',v_active,'inactive',v_inactive,'csv_sha256',p_csv_sha256);
end;
$$;

-- Impedir reportes nuevos en centros archivados sin modificar la firma pública existente.
create or replace function public.csv_report_active_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.libraries where id=new.library_id and is_active) then
    raise exception 'Biblioteca fuera del catálogo activo' using errcode='22023';
  end if;
  return new;
end;
$$;
drop trigger if exists reports_active_guard on public.user_reports;
create trigger reports_active_guard before insert on public.user_reports
  for each row execute function public.csv_report_active_guard();
-- reports_recalculate de la Fase 2 ya llama a la nueva función en la misma transacción.

revoke all on function public.csv_open_at(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.csv_curve_at(jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.recalculate_library_occupancy_legacy(uuid) from public,anon,authenticated;
revoke all on function public.recalculate_library_occupancy(uuid) from public,anon,authenticated;
revoke all on function public.recalculate_csv_occupancy(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.refresh_csv_occupancy(boolean) from public,anon,authenticated;
revoke all on function public.sync_csv_catalog(jsonb,text) from public,anon,authenticated;
revoke all on function public.csv_report_active_guard() from public,anon,authenticated;
grant execute on function public.recalculate_library_occupancy(uuid) to service_role;
grant execute on function public.recalculate_csv_occupancy(uuid,timestamptz) to service_role;
grant execute on function public.refresh_csv_occupancy(boolean) to service_role;
grant execute on function public.sync_csv_catalog(jsonb,text) to service_role;
commit;
