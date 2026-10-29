-- Synthetic fixtures only; no production capacities are seeded by this smoke test.
begin;
create temporary table capacity_payload as
select jsonb_agg(jsonb_build_object(
 'id',('40000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'name','Capacity test '||n,
 'num_resenas',0,'valoracion',null,'direccion','Test','tipo','Biblioteca',
 'lat',40.4,'lng',-3.7,'source_url','https://example.org/test','institution','otra',
 'total_capacity',case when n=1 then 100 else null end,
 'opening_hours',jsonb_build_object('timezone','Europe/Madrid','weekly',
   (select jsonb_object_agg(d::text,'[["09:00","21:00"]]'::jsonb) from generate_series(1,7)d)),
 'historical_popularity',jsonb_build_object('model','csv-v1','days',
   (select jsonb_object_agg(d::text,(select jsonb_object_agg(lpad(h::text,2,'0'),40)
   from generate_series(6,23)h)) from generate_series(1,7)d)))) payload
from generate_series(1,97)n;
select public.sync_csv_catalog(payload,repeat('e',64)) from capacity_payload;
do $$ declare invalid jsonb; begin
 if (select count(*) from public.libraries where is_active and total_capacity=100)<>1
   or (select count(*) from public.libraries where is_active and total_capacity is null)<>96 then
   raise exception 'Numeric/null capacity not synchronized';
 end if;
 foreach invalid in array array['0'::jsonb,'-1'::jsonb,'1.5'::jsonb,'"100"'::jsonb,'true'::jsonb] loop
  begin
   perform public.sync_csv_catalog((select jsonb_set(payload,'{0,total_capacity}',invalid) from capacity_payload),repeat('f',64));
   raise exception 'Invalid capacity accepted';
  exception when invalid_parameter_value then null;
  end;
 end loop;
 if (select total_capacity from public.libraries where name='Capacity test 1')<>100 then
   raise exception 'Invalid batch modified capacity';
 end if;
 begin
  update public.libraries set total_capacity=0 where name='Capacity test 1';
  raise exception 'Positive capacity constraint missing';
 exception when check_violation then null; end;
end $$;
update public.libraries set total_seats=999 where name='Capacity test 1';
select public.sync_csv_catalog(jsonb_set(payload,'{0,total_capacity}','null'),repeat('e',64)) from capacity_payload;
do $$ begin
 if exists(select 1 from public.libraries where is_active and total_capacity is not null) then
   raise exception 'Explicit null did not clear previous capacity';
 end if;
end $$;
set local role anon;
do $$ begin
 perform total_capacity from public.libraries where is_active;
 begin
  perform public.sync_csv_catalog('[]',repeat('e',64));
  raise exception 'Sync RPC exposed to anon';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
