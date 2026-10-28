-- Ejecutar tras la migración 007, también después de repetirla.
do $test$
declare v_count integer;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select count(*) into v_count from cron.job
    where jobname='biblioradar-refresh-csv-occupancy';
    if v_count <> 1 then raise exception 'Debe existir exactamente un job de ocupación'; end if;
    if not exists(select 1 from cron.job
      where jobname='biblioradar-refresh-csv-occupancy' and active
        and schedule='*/5 * * * *'
        and command='select public.refresh_csv_occupancy(false);') then
      raise exception 'Job de ocupación desactivado o mal configurado';
    end if;
  end if;
  if exists(select 1 from public.libraries l
    left join public.occupancy_status s on s.library_id=l.id
    where l.is_active and l.historical_popularity->>'model'='csv-v1'
      and (s.base_valid_until is null or s.base_valid_until <= clock_timestamp())) then
    raise exception 'La migración debe recuperar todos los estados CSV caducados';
  end if;
end;
$test$;
