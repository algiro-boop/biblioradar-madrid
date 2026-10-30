-- Curve-relative report memory. Forecasts are never stored back into the input curve or prior.
begin;
alter table public.occupancy_status
  add column if not exists report_memory_pct integer check(report_memory_pct between 0 and 100),
  add column if not exists report_memory_at timestamptz,
  add column if not exists report_memory_count integer not null default 0 check(report_memory_count>=0);

-- Beginning of the continuous open interval containing p_now, including adjacent slots.
-- CSV opening intervals are same-day; no memory is carried into a new local date.
create or replace function public.csv_session_start(p_hours jsonb,p_now timestamptz)
returns timestamptz language plpgsql stable set search_path='' as $$
declare v_local timestamp:=p_now at time zone 'Europe/Madrid';v_slots jsonb; r record;
  v_min numeric:=extract(hour from v_local)*60+extract(minute from v_local)+extract(second from v_local)/60;
  v_start integer;v_end integer;
begin
  v_slots:=coalesce(p_hours->'date_overrides'->v_local::date::text,
    p_hours->'weekly'->extract(isodow from v_local)::integer::text);
  if jsonb_typeof(v_slots) is distinct from 'array' then return null;end if;
  for r in select split_part(x->>0,':',1)::integer*60+split_part(x->>0,':',2)::integer a,
      split_part(x->>1,':',1)::integer*60+split_part(x->>1,':',2)::integer b
    from jsonb_array_elements(v_slots) x order by 1,2 loop
    if v_start is null then v_start:=r.a;v_end:=r.b;
    elsif r.a<=v_end then v_end:=greatest(v_end,r.b);
    else
      if v_min>=v_start and v_min<v_end then
        return (v_local::date::timestamp+make_interval(mins=>v_start)) at time zone 'Europe/Madrid';
      end if;
      v_start:=r.a;v_end:=r.b;
    end if;
  end loop;
  if v_min>=v_start and v_min<v_end then
    return (v_local::date::timestamp+make_interval(mins=>v_start)) at time zone 'Europe/Madrid';
  end if;
  return null;
end;
$$;

-- Baseline at the observation time: the same calendar context, without any posterior.
create or replace function public.csv_context_baseline(p_history jsonb,p_hours jsonb,p_now timestamptz)
returns numeric language plpgsql stable set search_path='' as $$
declare v_local timestamp:=p_now at time zone 'Europe/Madrid';v_month integer:=extract(month from v_local);
  v_pct numeric:=coalesce(public.csv_curve_at(p_history,p_hours,p_now),40);
begin
  if v_month in (12,1,5,6) then v_pct:=v_pct*1.20;
  elsif v_month=8 then v_pct:=v_pct*.75;end if;
  if coalesce(p_hours->'holidays','[]'::jsonb) ? v_local::date::text then v_pct:=v_pct*.85;end if;
  return greatest(2,least(98,v_pct));
end;
$$;

-- The correction has a two-hour half-life, follows the centre's curve and weakens
-- faster below the observation-time baseline. Taper to zero from hour five to six.
create or replace function public.report_memory_forecast(
  p_current numeric,p_anchor_base numeric,p_residual numeric,p_age_seconds numeric
) returns integer language sql immutable set search_path='' as $$
  select case when p_current is null or p_anchor_base is null or p_residual is null
    or p_age_seconds is null or p_age_seconds<0 or p_age_seconds>=21600 then null
    else round(greatest(0,least(100,p_current+p_residual
      *exp(-ln(2::numeric)*p_age_seconds/7200)
      *case when p_residual>0 then power(least(1,greatest(0,p_current)/greatest(1,p_anchor_base)),2) else 1 end
      *least(1,(21600-p_age_seconds)/3600))))::integer end;
$$;

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
  v_archetype boolean := false;
  v_full_at timestamptz;
  v_full_id uuid;
  v_full_support integer;
  v_conflicting integer;
  v_display integer;
  v_session timestamptz;
  v_memory_at timestamptz;
  v_memory_pct integer;
  v_memory_count integer := 0;
  v_memory_base numeric;
  v_memory_residual numeric;
begin
  select * into l from public.libraries where id=p_library_id;
  if not found then raise exception 'Biblioteca inexistente' using errcode='22023'; end if;
  if not l.is_active then return; end if;
  select * into s from public.occupancy_status where library_id=p_library_id for update;
  if not found then
    insert into public.occupancy_status(library_id) values(p_library_id);
    select * into s from public.occupancy_status where library_id=p_library_id for update;
  end if;
  v_archetype := coalesce(l.historical_popularity->'provenance'->>'kind' = 'archetype', false);
  v_open := public.csv_open_at(l.opening_hours,p_now);
  if v_open is false then
    v_final := 0; v_prior := 0; v_conf := 1;
  elsif v_open is true then
    v_session := public.csv_session_start(l.opening_hours,p_now);
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
    v_k := case when v_fallback or v_archetype then 6 else least(24,8+2*ln(1+greatest(0,coalesce(l.num_resenas,0)))) end;
    v_prior := round(v_mu*100)::integer;
    v_a := v_mu*v_k; v_b := (1-v_mu)*v_k;
    for v_report in
      select distinct on(device_hash) reported_value,created_at
      from public.user_reports where library_id=l.id
        and created_at between greatest(p_now-interval '90 minutes',v_session) and p_now and reported_value between 0 and 100
      order by device_hash,created_at desc,id desc
    loop
      v_count := v_count+1;
      v_weight := 40*exp(-ln(2::numeric)*extract(epoch from(p_now-v_report.created_at))/2400);
      v_a := v_a+v_weight*v_report.reported_value/100;
      v_b := v_b+v_weight*(1-v_report.reported_value/100::numeric);
      v_weighted := v_weighted+v_weight*v_report.reported_value;
    end loop;
    v_weight := v_a+v_b-v_k;
    v_final := round(v_a/(v_a+v_b)*100)::integer;
    v_conf := v_weight/(v_k+v_weight);
    -- A forecast anchored ONLY in raw observations, never in our previous posterior.
    -- The newest cohort replaces older evidence, including newer low-occupancy reports.
    with latest as (
      select distinct on(device_hash) id,reported_value,created_at
      from public.user_reports where library_id=l.id
        and created_at between greatest(p_now-interval '6 hours',v_session) and p_now
        and reported_value between 0 and 100
      order by device_hash,created_at desc,id desc
    ) select max(created_at) into v_memory_at from latest;
    if v_memory_at is not null then
      with latest as (
        select distinct on(device_hash) id,reported_value,created_at
        from public.user_reports where library_id=l.id
          and created_at between greatest(p_now-interval '6 hours',v_session) and p_now
          and reported_value between 0 and 100
        order by device_hash,created_at desc,id desc
      ), cohort as (
        select *, public.csv_context_baseline(l.historical_popularity,l.opening_hours,created_at) baseline,
          exp(-ln(2::numeric)*extract(epoch from(v_memory_at-created_at))/900) w
        from latest where created_at>=v_memory_at-interval '15 minutes'
      ) select count(*),sum(w*baseline)/nullif(sum(w),0),
        sum(w*(reported_value-baseline))/nullif(sum(w),0)
        into v_memory_count,v_memory_base,v_memory_residual from cohort;
      v_memory_pct := public.report_memory_forecast(v_mu*100,v_memory_base,v_memory_residual,
        extract(epoch from(p_now-v_memory_at)));
      if v_memory_pct is null then v_memory_at:=null;v_memory_count:=0;end if;
    end if;
    -- One latest vote per device. A new full report always takes effect at once.
    with latest as (
      select distinct on(device_hash) id,reported_value,created_at
      from public.user_reports where library_id=l.id
        and created_at between greatest(p_now-interval '90 minutes',v_session) and p_now
        and reported_value between 0 and 100
      order by device_hash,created_at desc,id desc
    )
    select created_at,id into v_full_at,v_full_id from latest
      where reported_value=100 and created_at>p_now-interval '15 minutes'
      order by created_at desc,id desc limit 1;
    if v_full_at is not null then
      with latest as (
        select distinct on(device_hash) id,reported_value,created_at
        from public.user_reports where library_id=l.id
          and created_at between greatest(p_now-interval '90 minutes',v_session) and p_now
          and reported_value between 0 and 100
        order by device_hash,created_at desc,id desc
      )
      select count(*) filter(where reported_value=100 and created_at>p_now-interval '15 minutes'),
        count(*) filter(where reported_value<100 and (created_at,id)>(v_full_at,v_full_id))
        into v_full_support,v_conflicting from latest;
      if v_conflicting>=v_full_support then v_full_at:=null; end if;
    end if;

  end if;
  v_display := case when v_open is true
    then public.report_display_pct(coalesce(v_memory_pct,v_final),v_full_at,p_now) else v_final end;
  update public.occupancy_status set
    prior_occupancy=v_prior,bayesian_occupancy=v_final,confidence_score=v_conf,is_open_now=v_open,
    google_live_pct=null,google_hist_pct=null,
    predicted_base_pct=v_prior,final_occupancy_pct=v_display,full_reported_at=v_full_at,
    report_memory_pct=v_memory_pct,report_memory_at=v_memory_at,report_memory_count=v_memory_count,
    crowd_pct=case when v_weight>0 then round(v_weighted/v_weight)::integer else null end,
    active_reports_count=v_count,
    base_source=case when v_open is null then 'Horario no informado en CSV'
      when not v_open then 'Cerrada según horario CSV' else 'Prior contextual CSV' end,
    primary_source=case when v_open is null then 'Horario no informado en CSV'
      when not v_open then 'Cerrada según horario CSV'
      else 'Estimación bayesiana · CSV' || case when v_archetype then ' (curva arquetípica)'
          when v_fallback then ' (curva incompleta)' else '' end
        || format(' + %s reporte(s)',v_count) end,
    base_observed_at=p_now,base_valid_until=p_now+interval '30 minutes',
    inertia_anchor=v_anchor,inertia_curve=v_anchor_curve,inertia_at=v_anchor_at
    where library_id=l.id;
end;
$$;


revoke all on function public.csv_session_start(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.csv_context_baseline(jsonb,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.report_memory_forecast(numeric,numeric,numeric,numeric) from public,anon,authenticated;
grant execute on function public.csv_session_start(jsonb,timestamptz),
  public.csv_context_baseline(jsonb,jsonb,timestamptz),
  public.report_memory_forecast(numeric,numeric,numeric,numeric) to service_role;
revoke all on function public.recalculate_csv_occupancy(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.recalculate_csv_occupancy(uuid,timestamptz) to service_role;
select public.refresh_csv_occupancy(false);
notify pgrst, 'reload schema';
commit;
