-- Synthetic data only; all public RPC submissions roll back.
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,
 opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000998','test','live-community','Live test','otra','Test','Test',40.4,-3.7,
 jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7)d)),
 '{"model":"csv-v1","days":{}}';
set local role anon;
select public.submit_report('00000000-0000-0000-0000-000000000998',75,repeat('a',64),40.4,-3.7,
 array['sockets_free','silent','temp_ok']);
reset role;
do $$ declare s public.occupancy_status; bad text[]; begin
 select * into s from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998';
 if s.latest_report_at is null or s.active_reports_count<>1 or cardinality(s.active_tags)<>3
   or s.active_tag_times->>'silent' is null then raise exception 'Missing immediate live context'; end if;
 foreach bad slice 1 in array array[
   ['silent','noisy','temp_ok'],['sockets_free','sockets_full','silent'],
   ['temp_ok','temp_cold','silent'],['invalid','silent','temp_hot'],['silent','silent','temp_ok']
 ] loop
   begin
     perform public.submit_report(s.library_id,75,repeat('b',64),40.4,-3.7,bad);
     raise exception 'Accepted invalid tags: %',bad;
   exception when sqlstate '22023' then null; end;
 end loop;
 if public.valid_report_tags(null) or public.valid_report_tags(array[null]::text[])
   or public.valid_report_tags(array['silent','temp_ok','sockets_free','temp_hot'])
   or public.valid_report_tags(array[['silent'],['temp_ok']]) then raise exception 'Invalid array accepted'; end if;
 -- CHECK also protects direct service writes, not just the RPC.
 begin
   update public.user_reports set tags=array['silent','noisy'] where library_id=s.library_id;
   raise exception 'Constraint did not protect direct writes';
 exception when check_violation then null; end;
 if has_table_privilege('anon','public.user_reports','SELECT')
   or has_table_privilege('anon','public.user_reports','INSERT') then raise exception 'Private reports exposed'; end if;
end $$;
-- New report from same device supersedes its previous tags after cooldown.
update public.user_reports set created_at=clock_timestamp()-interval '35 minutes' where library_id='00000000-0000-0000-0000-000000000998';
select public.submit_report('00000000-0000-0000-0000-000000000998',40,repeat('a',64),40.4,-3.7,array['noisy']);
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and active_reports_count=1 and active_tags=array['noisy']) then raise exception 'Device deduplication failed'; end if;
end $$;
-- Two recent users agree on silence; newest tag wins only when frequencies tie.
select public.submit_report('00000000-0000-0000-0000-000000000998',75,repeat('d',64),40.4,-3.7,array['silent']);
select public.submit_report('00000000-0000-0000-0000-000000000998',75,repeat('e',64),40.4,-3.7,array['silent']);
do $$ begin
 if (select active_tags from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998')<>array['silent']
 then raise exception 'Category frequency ignored'; end if;
end $$;
-- A closed state cannot expose live metadata even while reports remain recent.
update public.occupancy_status set is_open_now=false where library_id='00000000-0000-0000-0000-000000000998';
do $$ begin
 if exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and (latest_report_at is not null or cardinality(active_tags)>0)) then raise exception 'Closed live context'; end if;
end $$;
-- Legacy five-argument callers still work; geolocation and cooldown still apply.
select public.submit_report('00000000-0000-0000-0000-000000000998',90,repeat('c',64),40.4,-3.7);
do $$ begin
 begin
   perform public.submit_report('00000000-0000-0000-0000-000000000998',90,repeat('c',64),40.4,-3.7);
   raise exception 'Cooldown bypassed';
 exception when sqlstate 'P0001' then
   if sqlerrm='Cooldown bypassed' then raise; end if;
 end;
end $$;
-- Expired tags disappear on scheduled recalculation; memory must never count as live.
update public.user_reports set created_at=clock_timestamp()-interval '91 minutes' where library_id='00000000-0000-0000-0000-000000000998';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998',clock_timestamp());
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
 and latest_report_at is null and active_tags='{}' and active_tag_times='{}' and active_reports_count=0)
 then raise exception 'Expired live data retained'; end if;
end $$;
-- Ticker remains available to anon, strips private fields and clamps even huge limits.
set local role anon;
do $$ declare row jsonb; begin
 if (select count(*) from public.get_recent_reports(100000))>5 then raise exception 'Unbounded activity'; end if;
 select to_jsonb(r) into row from public.get_recent_reports(5) r where library_id='00000000-0000-0000-0000-000000000998' limit 1;
 if row is null or row ? 'device_hash' or row ? 'user_lat' or row ? 'user_lng'
   or (select count(*) from jsonb_object_keys(row))<>6 then raise exception 'Unsafe activity shape'; end if;
end $$;
reset role;
update public.user_reports set created_at=clock_timestamp()-interval '181 minutes' where library_id='00000000-0000-0000-0000-000000000998';
do $$ begin
 if exists(select 1 from public.get_recent_reports(5) where library_id='00000000-0000-0000-0000-000000000998') then raise exception 'Expired ticker'; end if;
end $$;
rollback;
