begin;
-- Independent synthetic destination with split shifts, exercising the same production engine.
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000997','test','north-profile','Zone test','ayuntamiento','Test','Barajas',40.45,-3.58,
 '{"timezone":"Europe/Madrid","requires_review":false,"weekly":{"6":[["10:00","14:00"],["16:00","21:00"]],"7":[["10:00","14:00"],["16:00","20:00"]]}}',
 jsonb_build_object('model','csv-v1','provenance',jsonb_build_object('kind','reference_estimate','zone','Barajas'),
 'days',(select jsonb_object_agg(d::text,(select jsonb_object_agg(lpad(h::text,2,'0'),50) from generate_series(6,23) h)) from generate_series(1,7)d));
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000997','2026-10-31T12:00+01');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000997'
 and is_open_now=true and confidence_score=0 and active_reports_count=0 and latest_report_at is null)
 then raise exception 'Zone-only estimate was presented as live'; end if;
end $$;
select public.submit_report('00000000-0000-0000-0000-000000000997',40,repeat('f',64),40.45,-3.58);
update public.user_reports set created_at='2026-10-31T12:00+01' where library_id='00000000-0000-0000-0000-000000000997';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000997','2026-10-31T12:00+01');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000997'
 and active_reports_count=1 and confidence_score>0 and latest_report_at is not null)
 then raise exception 'Real report did not activate live state'; end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000997','2026-10-31T14:00+01');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000997'
 and is_open_now=false and final_occupancy_pct=0 and active_reports_count=0)
 then raise exception 'Lunch closure ignored'; end if;
 if public.csv_open_at('{"temporarily_closed":true,"weekly":{"6":[["00:00","24:00"]]}}','2026-10-31T12:00+01')
 then raise exception 'Temporary closure ignored'; end if;
end $$;
rollback;
