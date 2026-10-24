-- Ejecutar una vez en un proyecto Supabase nuevo, como postgres.
-- Una migración versionada: no ocultamos diferencias con IF NOT EXISTS en tablas.
begin;

create type public.institution_type as enum ('ayuntamiento', 'comunidad', 'ucm', 'otra');
create type public.occupancy_label as enum ('free', 'moderate', 'high', 'full');

create table public.libraries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'manual',
  source_id text not null,
  source_url text,
  name text not null check (length(btrim(name)) > 0),
  institution public.institution_type not null,
  address text not null,
  district text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  google_place_id text unique,
  opening_hours jsonb not null default '{"timezone":"Europe/Madrid","raw_text":"","normalized_text":"","weekly":null,"requires_review":true}'::jsonb
    check (jsonb_typeof(opening_hours) = 'object'),
  total_seats integer check (total_seats > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, source_id)
);
create index libraries_institution_district_idx on public.libraries (institution, district);
create index libraries_coordinates_idx on public.libraries (lat, lng);

create table public.occupancy_status (
  library_id uuid primary key references public.libraries(id) on delete cascade,
  google_live_pct integer check (google_live_pct between 0 and 100),
  google_hist_pct integer check (google_hist_pct between 0 and 100),
  predicted_base_pct integer check (predicted_base_pct between 0 and 100),
  crowd_pct integer check (crowd_pct between 0 and 100),
  -- NULL significa desconocido; nunca confundir con biblioteca vacía.
  final_occupancy_pct integer check (final_occupancy_pct between 0 and 100),
  status_label public.occupancy_label generated always as (
    case when final_occupancy_pct is null then null
      when final_occupancy_pct < 70 then 'free'::public.occupancy_label
      when final_occupancy_pct < 90 then 'moderate'::public.occupancy_label
      when final_occupancy_pct < 100 then 'high'::public.occupancy_label
      else 'full'::public.occupancy_label end
  ) stored,
  primary_source text not null default 'Sin datos de ocupación',
  active_reports_count integer not null default 0 check (active_reports_count >= 0),
  updated_at timestamptz not null default now()
);

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.libraries(id) on delete cascade,
  reported_value integer not null check (reported_value in (30, 75, 100)),
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  user_lat double precision not null check (user_lat between -90 and 90),
  user_lng double precision not null check (user_lng between -180 and 180),
  created_at timestamptz not null default now()
);
create index reports_library_recent_idx on public.user_reports (library_id, created_at desc);
create index reports_device_recent_idx
  on public.user_reports (library_id, device_hash, created_at desc);
create index reports_retention_idx on public.user_reports (created_at);

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;
create trigger libraries_touch before update on public.libraries
  for each row execute function public.touch_updated_at();
create trigger occupancy_touch before update on public.occupancy_status
  for each row execute function public.touch_updated_at();

create function public.initialize_occupancy() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.occupancy_status (library_id) values (new.id);
  return new;
end;
$$;
create trigger library_initialize after insert on public.libraries
  for each row execute function public.initialize_occupancy();

-- También protege inserciones privilegiadas: hora del servidor y bloqueo concurrente.
create function public.validate_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_a double precision;
begin
  if new.device_hash is null or new.device_hash !~ '^[0-9a-f]{64}$'
     or new.reported_value is null or new.reported_value not in (30, 75, 100)
     or new.user_lat is null or not (new.user_lat between -90 and 90)
     or new.user_lng is null or not (new.user_lng between -180 and 180) then
    raise exception 'Reporte inválido' using errcode = '22023';
  end if;
  select lat, lng into v_lat, v_lng from public.libraries where id = new.library_id;
  if not found then
    raise exception 'Biblioteca inexistente' using errcode = '22023';
  end if;
  v_a := power(sin(radians(new.user_lat - v_lat) / 2), 2)
    + cos(radians(v_lat)) * cos(radians(new.user_lat))
    * power(sin(radians(new.user_lng - v_lng) / 2), 2);
  if 6371000 * 2 * asin(sqrt(least(1.0, greatest(0.0, v_a)))) >= 250 then
    raise exception 'Debes estar a menos de 250 metros' using errcode = '22023';
  end if;
  -- La misma pareja biblioteca/dispositivo serializa la comprobación y la inserción.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.library_id::text || ':' || new.device_hash, 0));
  new.created_at := clock_timestamp();
  if exists (
    select 1 from public.user_reports
    where library_id = new.library_id and device_hash = new.device_hash
      and created_at > new.created_at - interval '30 minutes'
  ) then
    raise exception 'Solo un reporte por biblioteca cada 30 minutos' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger reports_validate before insert on public.user_reports
  for each row execute function public.validate_report();

-- Única escritura pública. No permite elegir id, hora ni modificar reportes anteriores.
create function public.submit_report(
  p_library_id uuid, p_reported_value integer, p_device_hash text,
  p_user_lat double precision, p_user_lng double precision
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.user_reports (library_id, reported_value, device_hash, user_lat, user_lng)
    values (p_library_id, p_reported_value, p_device_hash, p_user_lat, p_user_lng)
    returning id into v_id;
  return v_id;
end;
$$;

alter table public.libraries enable row level security;
alter table public.occupancy_status enable row level security;
alter table public.user_reports enable row level security;
revoke all on public.libraries, public.occupancy_status, public.user_reports
  from public, anon, authenticated;
grant select on public.libraries, public.occupancy_status to anon, authenticated;
grant all on public.libraries, public.occupancy_status, public.user_reports to service_role;
create policy libraries_public_read on public.libraries
  for select to anon, authenticated using (true);
create policy occupancy_public_read on public.occupancy_status
  for select to anon, authenticated using (true);
-- Sin políticas públicas para user_reports: hashes y coordenadas nunca se exponen.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.initialize_occupancy() from public, anon, authenticated;
revoke all on function public.validate_report() from public, anon, authenticated;
revoke all on function public.submit_report(uuid, integer, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.submit_report(uuid, integer, text, double precision, double precision)
  to anon, authenticated, service_role;

-- Solo estado agregado en Realtime; nunca la tabla de reportes privados.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'occupancy_status') then
      alter publication supabase_realtime add table public.occupancy_status;
    end if;
  else
    create publication supabase_realtime for table public.occupancy_status;
  end if;
end;
$$;
commit;
