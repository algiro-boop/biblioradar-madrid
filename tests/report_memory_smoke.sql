-- Synthetic fixtures only. All changes roll back, including public submit_report calls.
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,
 num_resenas,opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000999','test','report-memory','Memory test','otra','Test','Test',40.4,-3.7,
 0,jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7)d)),
 jsonb_build_object('model','csv-v1','days',(select jsonb_object_agg(d::text,
 (select jsonb_object_agg(lpad(h::text,2,'0'),case h when 12 then 70 when 17 then 70 when 20 then 40 else 50 end)
 from generate_series(0,23)h)) from generate_series(1,7)d));
select public.submit_report('00000000-0000-0000-0000-000000000999',90,repeat('1',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T08:00Z'
where library_id='00000000-0000-0000-0000-000000000999';
-- 10:00 local observation (Madrid summer time), 12:00 local forecast.
-- Match the curve fixture to UTC+2: local 10 baseline 50, local 12 baseline 70.
do $$ declare v_id uuid:='00000000-0000-0000-0000-000000000999'; v_before integer; begin
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T08:00Z');
 if (select final_occupancy_pct from public.occupancy_status where library_id=v_id)<>90 then
  raise exception 'Fresh observation not anchored';end if;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:00Z');
 if not exists(select 1 from public.occupancy_status where library_id=v_id and report_memory_pct=90
  and final_occupancy_pct=90 and active_reports_count=0 and report_memory_count=1
  and report_memory_at='2027-07-15T08:00Z' and bayesian_occupancy=70) then
  raise exception 'Morning report was lost at 90 minutes';end if;
 select final_occupancy_pct into v_before from public.occupancy_status where library_id=v_id;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:00Z');
 if (select final_occupancy_pct from public.occupancy_status where library_id=v_id)<>v_before then
  raise exception 'Memory compounded with repeated refresh';end if;
end $$;
-- Reuse the same raw observation at 15:00 local; no previous posterior becomes input.
update public.user_reports set created_at='2027-07-15T13:00Z',reported_value=100
where library_id='00000000-0000-0000-0000-000000000999';
update public.occupancy_status set inertia_anchor=null,inertia_curve=null,inertia_at=null,prior_occupancy=null
where library_id='00000000-0000-0000-0000-000000000999';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T15:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
   and final_occupancy_pct=95 and active_reports_count=0 and full_reported_at is null) then
  raise exception 'Full at 15:00 became available at 17:00';end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T18:00Z');
do $$ begin
 if (select final_occupancy_pct from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999')>=70 then
  raise exception 'Falling curve did not weaken memory';end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T19:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
  and report_memory_at is null and report_memory_pct is null and report_memory_count=0) then
  raise exception 'Memory survived six-hour limit';end if;
end $$;
-- A later low report replaces the older cohort promptly.
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000999',40,repeat('2',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T15:00Z'
where library_id='00000000-0000-0000-0000-000000000999' and device_hash=repeat('2',64);
update public.occupancy_status set inertia_anchor=null,inertia_curve=null,inertia_at=null,prior_occupancy=null
where library_id='00000000-0000-0000-0000-000000000999';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T15:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
  and final_occupancy_pct=40 and report_memory_count=1 and report_memory_at='2027-07-15T15:00Z') then
  raise exception 'New availability did not replace old memory';end if;
end $$;
-- A lunch closure starts a new continuous session and clears ALL older votes.
update public.libraries set opening_hours=jsonb_set(opening_hours,'{weekly}',
  (select jsonb_object_agg(d::text,'[["09:00","14:00"],["16:00","21:00"]]'::jsonb) from generate_series(1,7)d))
where source_id='report-memory';
update public.user_reports set created_at='2027-07-15T11:55Z',reported_value=100
where library_id='00000000-0000-0000-0000-000000000999';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T14:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
  and report_memory_at is null and full_reported_at is null and active_reports_count=0) then
  raise exception 'Reports crossed lunch closure';end if;
 if public.csv_session_start('{"weekly":{"4":[["09:00","14:00"],["14:00","21:00"]]}}','2027-07-15T14:00Z')
   is distinct from '2027-07-15T07:00Z'::timestamptz then
  raise exception 'Adjacent opening slots treated as a closure';end if;
end $$;
update public.libraries set opening_hours=jsonb_set(opening_hours,'{date_overrides}','{"2027-07-15":[]}') where source_id='report-memory';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T15:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
  and is_open_now=false and final_occupancy_pct=0 and report_memory_pct is null) then
  raise exception 'Memory ignored explicit closure';end if;
end $$;
-- Even a nominally all-day schedule does not carry yesterday's memory into today.
update public.libraries set opening_hours=jsonb_build_object('weekly',
  (select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7)d))
where source_id='report-memory';
update public.user_reports set created_at='2027-07-15T21:55Z',reported_value=100
where library_id='00000000-0000-0000-0000-000000000999';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000999','2027-07-15T22:05Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000999'
   and report_memory_at is null and full_reported_at is null and active_reports_count=0) then
  raise exception 'Memory crossed local midnight';end if;
end $$;
rollback;
