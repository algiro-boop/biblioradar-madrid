-- Ejecutar el motor junto a los datos: GitHub Actions puede retrasar o saltar cron jobs.
-- PostgreSQL vanilla (CI/local) no incluye pg_cron; Supabase sí lo proporciona.
begin;

do $migration$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- El nombre hace que repetir la migración actualice el mismo job, sin duplicados.
    perform cron.schedule(
      'biblioradar-refresh-csv-occupancy',
      '*/5 * * * *',
      'select public.refresh_csv_occupancy(false);'
    );
  else
    raise notice 'pg_cron no disponible: entorno local/CI sin programador. En Supabase verificar cron.job.';
  end if;
end;
$migration$;

-- Recuperar estados caducados al aplicar; conserva reportes y cierres excepcionales.
select public.refresh_csv_occupancy(false);

commit;
