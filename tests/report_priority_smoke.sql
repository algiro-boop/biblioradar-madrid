-- Synthetic, isolated fixtures. Never creates persistent reports or changes production data.
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,
  num_resenas,opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000998','test','report-priority','Report priority','otra','Test','Test',40.4,-3.7,
  0,jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb)
    from generate_series(1,7)d)),
  jsonb_build_object('model','csv-v1','days',(select jsonb_object_agg(d::text,
    (select jsonb_object_agg(lpad(h::text,2,'0'),40) from generate_series(0,23)h))
    from generate_series(1,7)d));
select public.submit_report('00000000-0000-0000-0000-000000000998',100,repeat('1',64),40.4,-3.7);
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and final_occupancy_pct=100 and bayesian_occupancy<100 and full_reported_at is not null) then
   raise exception 'submit_report did not immediately publish full';
 end if;
end $$;
update public.user_reports set created_at='2027-07-15T10:00Z'
where library_id='00000000-0000-0000-0000-000000000998';
do $$ declare v_id uuid:='00000000-0000-0000-0000-000000000998'; begin
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:00Z');
 if not exists(select 1 from public.occupancy_status where library_id=v_id
   and bayesian_occupancy=90 and final_occupancy_pct=100 and confidence_score=40::numeric/48) then
   raise exception 'New weight/operational full incorrect'; end if;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:05Z');
 if (select full_reported_at from public.occupancy_status where library_id=v_id)<>'2027-07-15T10:00Z'::timestamptz then
   raise exception 'Cron extended full TTL'; end if;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:12:30Z');
 if not exists(select 1 from public.occupancy_status where library_id=v_id
   and final_occupancy_pct=public.report_display_pct(coalesce(report_memory_pct,bayesian_occupancy),'2027-07-15T10:00Z','2027-07-15T10:12:30Z')
   and final_occupancy_pct<=100 and final_occupancy_pct>=coalesce(report_memory_pct,bayesian_occupancy)) then
   raise exception 'Missing smooth fade'; end if;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-15T10:15Z');
 if not exists(select 1 from public.occupancy_status where library_id=v_id
   and final_occupancy_pct=coalesce(report_memory_pct,bayesian_occupancy) and full_reported_at is null) then
   raise exception 'Full flag did not expire'; end if;
 if public.report_display_pct(80,'2027-07-15T10:00Z','2027-07-15T10:10Z')<>100
   or public.report_display_pct(80,'2027-07-15T10:00Z','2027-07-15T10:12:30Z')<>90
   or public.report_display_pct(80,'2027-07-15T10:00Z','2027-07-15T10:15Z')<>80
   or public.report_display_pct(80,'2027-07-15T10:00Z','2027-07-15T09:59Z')<>80 then
   raise exception 'Display boundaries incorrect'; end if;
end $$;
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000998',40,repeat('2',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T10:01Z'
where library_id='00000000-0000-0000-0000-000000000998' and device_hash=repeat('2',64);
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998','2027-07-15T10:02Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and full_reported_at is null and final_occupancy_pct=coalesce(report_memory_pct,bayesian_occupancy)) then
   raise exception 'New availability did not cancel single full vote'; end if;
end $$;
-- Two full devices retain consensus against one newer contrary device.
update public.user_reports set reported_value=100
where library_id='00000000-0000-0000-0000-000000000998' and device_hash=repeat('2',64);
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000998',40,repeat('3',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T10:02Z'
where library_id='00000000-0000-0000-0000-000000000998' and device_hash=repeat('3',64);
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998','2027-07-15T10:03Z');
do $$ begin
 if (select final_occupancy_pct from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998')<>100 then
   raise exception 'Consensus ignored'; end if;
end $$;
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000998',20,repeat('4',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T10:03Z'
where library_id='00000000-0000-0000-0000-000000000998' and device_hash=repeat('4',64);
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998','2027-07-15T10:04Z');
do $$ begin
 if (select full_reported_at from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998') is not null then
   raise exception 'Two newer contrary devices did not cancel'; end if;
end $$;
-- Duplicate imported device must not count twice.
update public.user_reports set device_hash=repeat('3',64)
where library_id='00000000-0000-0000-0000-000000000998' and device_hash=repeat('4',64);
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998','2027-07-15T10:04Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and active_reports_count=3 and final_occupancy_pct=100) then
   raise exception 'Duplicate devices amplified votes'; end if;
end $$;
update public.libraries set opening_hours=jsonb_set(opening_hours,'{date_overrides}',
  '{"2027-07-15":[]}') where source_id='report-priority';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000998','2027-07-15T10:04Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000998'
   and is_open_now=false and final_occupancy_pct=0 and full_reported_at is null) then
   raise exception 'A report overrode known closure'; end if;
end $$;
rollback;
