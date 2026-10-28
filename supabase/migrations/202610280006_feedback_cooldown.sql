begin;

-- Mantener el cooldown independiente de los 90 minutos de evidencia del motor.
create or replace function public.validate_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_a double precision;
  v_last timestamptz;
begin
  if new.device_hash is null or new.device_hash !~ '^[0-9a-f]{64}$'
     or new.reported_value is null or new.reported_value not in (20,30,40,75,90,100)
     or new.user_lat is null or not (new.user_lat between -90 and 90)
     or new.user_lng is null or not (new.user_lng between -180 and 180) then
    raise exception 'Reporte inválido' using errcode='22023';
  end if;
  select lat,lng into v_lat,v_lng from public.libraries where id=new.library_id;
  if not found then raise exception 'Biblioteca inexistente' using errcode='22023'; end if;
  v_a:=power(sin(radians(new.user_lat-v_lat)/2),2)
    +cos(radians(v_lat))*cos(radians(new.user_lat))*power(sin(radians(new.user_lng-v_lng)/2),2);
  if 6371000*2*asin(sqrt(least(1.0,greatest(0.0,v_a))))>=250 then
    raise exception 'Debes estar a menos de 250 metros' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.library_id::text||':'||new.device_hash,0));
  new.created_at:=clock_timestamp();
  select max(created_at) into v_last from public.user_reports
    where library_id=new.library_id and device_hash=new.device_hash
      and created_at>new.created_at-interval '30 minutes' and created_at<=new.created_at;
  if v_last is not null then
    raise exception 'Solo un reporte por biblioteca cada 30 minutos' using errcode='P0001',
      detail=jsonb_build_object('retry_after_seconds',
        ceil(extract(epoch from(v_last+interval '30 minutes'-new.created_at)))::integer)::text;
  end if;
  return new;
end;
$$;
revoke all on function public.validate_report() from public,anon,authenticated;

create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  category text not null check(category in ('sugerencia','nueva_biblioteca','error_horario','bug_app','otro')),
  message text not null check(char_length(btrim(message)) between 5 and 1000),
  library_id uuid references public.libraries(id) on delete set null,
  contact_info text check(contact_info is null or char_length(contact_info)<=200),
  device_hash text not null check(device_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists feedback_device_created_idx on public.user_feedback(device_hash,created_at desc);
alter table public.user_feedback enable row level security;
-- Sin políticas públicas: únicamente el RPC puede insertar. Nunca publicar esta tabla en Realtime.
revoke all on public.user_feedback from public,anon,authenticated;
grant select on public.user_feedback to service_role;

create or replace function public.submit_feedback(
  p_category text,p_message text,p_device_hash text,
  p_library_id uuid default null,p_contact_info text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_message text:=btrim(p_message);
  v_contact text:=nullif(btrim(p_contact_info),'');
  v_now timestamptz;
  v_count integer;
  v_first timestamptz;
  v_id uuid;
begin
  if p_category is null or p_category not in ('sugerencia','nueva_biblioteca','error_horario','bug_app','otro')
    or v_message is null or char_length(v_message) not between 5 and 1000
    or (v_contact is not null and char_length(v_contact)>200)
    or p_device_hash is null or p_device_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Sugerencia inválida' using errcode='22023';
  end if;
  if p_library_id is not null and not exists(select 1 from public.libraries where id=p_library_id) then
    raise exception 'Biblioteca inexistente' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('feedback:'||p_device_hash,0));
  v_now:=clock_timestamp();
  select count(*),min(created_at) into v_count,v_first from public.user_feedback
    where device_hash=p_device_hash and created_at>v_now-interval '1 hour' and created_at<=v_now;
  if v_count>=3 then
    raise exception 'Máximo 3 sugerencias por hora' using errcode='P0001',
      detail=jsonb_build_object('retry_after_seconds',
        ceil(extract(epoch from(v_first+interval '1 hour'-v_now)))::integer)::text;
  end if;
  insert into public.user_feedback(category,message,library_id,contact_info,device_hash,created_at)
    values(p_category,v_message,p_library_id,v_contact,p_device_hash,v_now) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_feedback(text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.submit_feedback(text,text,text,uuid,text) to anon,authenticated,service_role;
commit;
