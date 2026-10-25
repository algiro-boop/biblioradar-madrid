-- Ejecutar DESPUÉS de todas las migraciones como postgres. Todas las escrituras se revierten.
begin;
insert into public.libraries
  (id, source, source_id, name, institution, address, district, lat, lng)
values ('00000000-0000-0000-0000-000000000001', 'test', 'test-phase1',
  'Biblioteca de prueba', 'ayuntamiento', 'Dirección de prueba', 'Centro', 40.4168, -3.7038);

do $$
begin
  if not exists (select 1 from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001'
      and final_occupancy_pct is null and status_label is null) then
    raise exception 'No se ha inicializado el estado desconocido';
  end if;
end;
$$;

update public.occupancy_status set predicted_base_pct = 80, base_source = 'Base de prueba'
where library_id = '00000000-0000-0000-0000-000000000001';

set local role anon;
select public.submit_report('00000000-0000-0000-0000-000000000001',
  30, repeat('a', 64), 40.4168, -3.7038);

do $$
begin
  if not exists(select 1 from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001'
      and active_reports_count = 1 and crowd_pct = 30 and final_occupancy_pct = 63) then
    raise exception 'El reporte no actualizó el agregado inmediatamente';
  end if;
  begin
    perform public.recalculate_library_occupancy('00000000-0000-0000-0000-000000000001');
    raise exception 'Recalcular no debe ser una RPC pública';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.update_occupancy_bases('[]'::jsonb);
    raise exception 'El cliente puede actualizar bases';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.submit_report('00000000-0000-0000-0000-000000000001',
      75, repeat('a', 64), 40.4168, -3.7038);
    raise exception 'El límite de frecuencia no funciona';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'Solo un reporte por biblioteca cada 30 minutos' then raise; end if;
  end;
  begin
    perform public.submit_report('00000000-0000-0000-0000-000000000001',
      30, repeat('b', 64), 40.4268, -3.7038);
    raise exception 'Geofencing no funciona';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.submit_report('00000000-0000-0000-0000-000000000001',
      99, repeat('b', 64), 40.4168, -3.7038);
    raise exception 'Acepta valores no admitidos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.submit_report('00000000-0000-0000-0000-000000000001',
      30, 'invalido', 40.4168, -3.7038);
    raise exception 'Acepta hashes inválidos';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.submit_report('00000000-0000-0000-0000-000000000001',
      30, repeat('b', 64), null, -3.7038);
    raise exception 'Acepta GPS nulo';
  exception when sqlstate '22023' then null;
  end;
  if not exists(select 1 from public.libraries
    where id = '00000000-0000-0000-0000-000000000001') then
    raise exception 'Falla lectura pública';
  end if;
  begin
    perform 1 from public.user_reports;
    raise exception 'Reportes privados expuestos';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.occupancy_status set final_occupancy_pct = 0;
    raise exception 'El cliente puede manipular estados';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_reports (library_id, reported_value, device_hash, user_lat, user_lng)
    values ('00000000-0000-0000-0000-000000000001', 30, repeat('b', 64), 40.4168, -3.7038);
    raise exception 'Inserción directa habilitada';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

update public.occupancy_status set final_occupancy_pct = 95
where library_id = '00000000-0000-0000-0000-000000000001';
do $$
begin
  if not exists(select 1 from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001' and status_label = 'high') then
    raise exception 'Etiqueta calculada incorrecta';
  end if;
  if (select count(*) from public.user_reports
    where library_id = '00000000-0000-0000-0000-000000000001') <> 1 then
    raise exception 'Número inesperado de reportes aceptados';
  end if;
end;
$$;
-- Expiran los reportes; el cron/RPC debe limpiar su influencia aunque no haya nuevos.
update public.user_reports set created_at = clock_timestamp() - interval '91 minutes'
where library_id = '00000000-0000-0000-0000-000000000001';
set local role service_role;
select public.update_occupancy_bases('[{
  "library_id":"00000000-0000-0000-0000-000000000001",
  "predicted_base_pct":70,"google_live_pct":70,"google_hist_pct":60,"base_source":"Google prueba"
}]'::jsonb);
reset role;
do $$
begin
  if not exists(select 1 from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001'
      and active_reports_count = 0 and crowd_pct is null and final_occupancy_pct = 70) then
    raise exception 'La RPC no elimina la influencia de reportes caducados';
  end if;
end;
$$;
-- La validez enviada por el cron se respeta dentro de [1 minuto, 3 horas].
set local role service_role;
select public.update_occupancy_bases(jsonb_build_array(jsonb_build_object(
  'library_id', '00000000-0000-0000-0000-000000000001',
  'predicted_base_pct', 40, 'google_live_pct', null, 'google_hist_pct', null,
  'base_source', 'Validez de prueba',
  'base_valid_until', clock_timestamp() + interval '25 minutes')));
reset role;
do $$
declare
  v_left interval;
begin
  select base_valid_until - base_observed_at into v_left from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001';
  if v_left not between interval '24 minutes' and interval '26 minutes' then
    raise exception 'No se respeta la validez enviada por el cron: %', v_left;
  end if;
end;
$$;
set local role service_role;
select public.update_occupancy_bases(jsonb_build_array(jsonb_build_object(
  'library_id', '00000000-0000-0000-0000-000000000001',
  'predicted_base_pct', 40, 'google_live_pct', null, 'google_hist_pct', null,
  'base_source', 'Validez de prueba',
  'base_valid_until', clock_timestamp() + interval '2 days')));
reset role;
do $$
begin
  if (select base_valid_until - base_observed_at from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001') <> interval '3 hours' then
    raise exception 'La validez no se acota a 3 horas';
  end if;
end;
$$;
set local role service_role;
select public.update_occupancy_bases(jsonb_build_array(jsonb_build_object(
  'library_id', '00000000-0000-0000-0000-000000000001',
  'predicted_base_pct', 40, 'google_live_pct', null, 'google_hist_pct', null,
  'base_source', 'Validez de prueba',
  'base_valid_until', clock_timestamp() - interval '1 hour')));
reset role;
do $$
begin
  if (select base_valid_until - base_observed_at from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001') <> interval '1 minute'
    or not exists(select 1 from public.occupancy_status
      where library_id = '00000000-0000-0000-0000-000000000001' and final_occupancy_pct = 40)
  then
    raise exception 'Una validez pasada no debe caducar la base recién recibida';
  end if;
end;
$$;
update public.occupancy_status set base_valid_until = clock_timestamp() - interval '1 second'
where library_id = '00000000-0000-0000-0000-000000000001';
select public.recalculate_library_occupancy('00000000-0000-0000-0000-000000000001');
do $$
begin
  if exists(select 1 from public.occupancy_status
    where library_id = '00000000-0000-0000-0000-000000000001'
      and final_occupancy_pct is not null) then
    raise exception 'Se conserva una base caducada como si fuera actual';
  end if;
end;
$$;
rollback;
