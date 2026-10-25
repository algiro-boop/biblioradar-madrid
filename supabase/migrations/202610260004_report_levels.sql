begin;

-- Reporte colaborativo en 5 niveles: 20 casi vacía, 40 bastante sitio, 75 pocos sitios,
-- 90 casi llena, 100 completa. Se sigue aceptando 30 (nivel "Hay sitio" anterior) para
-- conservar los reportes existentes y no romper copias antiguas de la PWA en caché.
alter table public.user_reports drop constraint if exists user_reports_reported_value_check;
alter table public.user_reports add constraint user_reports_reported_value_check
  check (reported_value in (20, 30, 40, 75, 90, 100));

-- Mismo cuerpo que en 202610230001_phase1.sql salvo la lista de valores admitidos.
create or replace function public.validate_report() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_a double precision;
begin
  if new.device_hash is null or new.device_hash !~ '^[0-9a-f]{64}$'
     or new.reported_value is null or new.reported_value not in (20, 30, 40, 75, 90, 100)
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

revoke all on function public.validate_report() from public, anon, authenticated;
commit;
