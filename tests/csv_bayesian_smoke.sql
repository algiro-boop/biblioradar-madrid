begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,opening_hours,historical_popularity)
values('00000000-0000-0000-0000-000000000801','test','csv-bayes','CSV test','otra','Test','Test',40.4,-3.7,
 '{"timezone":"Europe/Madrid","weekly":{"1":[["09:00","13:00"],["15:00","21:00"]],"2":[["09:00","13:00"],["15:00","21:00"]],"3":[["09:00","13:00"],["15:00","21:00"]],"4":[],"5":[],"6":[],"7":[]},"date_overrides":{}}',
 '{"model":"csv-v1","days":{"3":{"09":10,"10":20,"11":40,"12":50,"15":80,"16":80}}}');

do $$ begin
 if public.csv_open_at((select opening_hours from public.libraries where source_id='csv-bayes'),'2026-10-28T13:30:00Z') is distinct from false then
  raise exception 'No se respeta la pausa de mediodía'; end if;
 if public.csv_curve_at((select historical_popularity from public.libraries where source_id='csv-bayes'),
  (select opening_hours from public.libraries where source_id='csv-bayes'),'2026-10-28T09:30:00Z') <>30 then
  raise exception 'Interpolación horaria incorrecta'; end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000801','2026-10-28T09:30:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000801'
  and prior_occupancy=30 and bayesian_occupancy=30 and is_open_now and confidence_score=0) then
  raise exception 'Prior sin reportes incorrecto'; end if;
end $$;
insert into public.user_reports(library_id,device_hash,reported_value,user_lat,user_lng)
 values('00000000-0000-0000-0000-000000000801',repeat('a',64),20,40.4,-3.7),
 ('00000000-0000-0000-0000-000000000801',repeat('b',64),100,40.4,-3.7);
-- Simular dos reportes del mismo dispositivo importados históricamente.
update public.user_reports set device_hash=repeat('a',64),created_at='2026-10-28T09:30:00Z'::timestamptz
  -case when reported_value=20 then interval '40 minutes' else interval '0 seconds' end
 where library_id='00000000-0000-0000-0000-000000000801';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000801','2026-10-28T09:30:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000801'
  and active_reports_count=1 and crowd_pct=100 and bayesian_occupancy=80 and confidence_score between .71 and .72) then
  raise exception 'Beta, deduplicación o confianza incorrectas'; end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000801','2026-10-28T13:30:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000801'
  and not is_open_now and bayesian_occupancy=0 and confidence_score=1) then
  raise exception 'Cierre debe dominar los reportes'; end if;
end $$;
-- La señal se aplica inmediatamente, con el mismo reloj real del trigger.
update public.libraries set opening_hours=jsonb_build_object('timezone','Europe/Madrid','weekly',
 (select jsonb_object_agg(day::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7) day))
 where source_id='csv-bayes';
set local role anon;
select public.submit_report('00000000-0000-0000-0000-000000000801',100,repeat('c',64),40.4,-3.7);
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000801'
  and active_reports_count>=1 and bayesian_occupancy>0 and is_open_now) then
  raise exception 'Trigger bayesiano no es inmediato'; end if;
 begin
  perform public.refresh_csv_occupancy(false);
  raise exception 'RPC de cron expuesta al público';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

-- Vectores deterministas de calendario, vida media, vecindad y zonas horarias.
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,opening_hours,historical_popularity)
select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'test','csv-'||n,'Test '||n,'otra','Test','Test',40.4,
 case when n=903 then -3.9 else -3.7 end,
 jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7)d)),
 jsonb_build_object('model','csv-v1','days',(select jsonb_object_agg(d::text,
  (select jsonb_object_agg(lpad(h::text,2,'0'),40) from generate_series(6,23)h)) from generate_series(1,7)d))
 from generate_series(901,903)n;

do $$ declare v_id uuid:='00000000-0000-0000-0000-000000000901'; v integer; begin
 perform public.recalculate_csv_occupancy(v_id,'2027-01-12T10:00Z');
 select prior_occupancy into v from public.occupancy_status where library_id=v_id;
 if v<>48 then raise exception 'Exámenes: %',v; end if;
 perform public.recalculate_csv_occupancy(v_id,'2027-08-12T10:00Z');
 select prior_occupancy into v from public.occupancy_status where library_id=v_id;
 if v<>30 then raise exception 'Verano: %',v; end if;
 update public.libraries set opening_hours=opening_hours||'{"holidays":["2027-07-12"]}'::jsonb where libraries.id=v_id;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-12T10:00Z');
 select prior_occupancy into v from public.occupancy_status where library_id=v_id;
 if v<>34 then raise exception 'Festivo: %',v; end if;
 update public.libraries set opening_hours=opening_hours||'{"date_overrides":{"2027-07-12":[]}}'::jsonb where libraries.id=v_id;
 perform public.recalculate_csv_occupancy(v_id,'2027-07-12T10:00Z');
 if (select is_open_now from public.occupancy_status where library_id=v_id) then raise exception 'Cierre excepcional ignorado'; end if;
 update public.libraries set opening_hours=opening_hours-'holidays'-'date_overrides' where libraries.id=v_id;
end $$;

-- Vecino lejano no altera el prior; vecino cercano aporta como máximo 3.75 puntos.
insert into public.user_reports(library_id,device_hash,reported_value,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000903',repeat('d',64),100,40.4,-3.9);
update public.user_reports set created_at='2027-07-13T10:00Z' where library_id='00000000-0000-0000-0000-000000000903';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000901','2027-07-13T10:00Z');
do $$ begin
 if (select prior_occupancy from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000901')<>40 then
 raise exception 'El vecino lejano alteró el prior'; end if;
end $$;
insert into public.user_reports(library_id,device_hash,reported_value,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000902',repeat('e',64),100,40.4,-3.7);
update public.user_reports set created_at='2027-07-13T10:00Z' where library_id='00000000-0000-0000-0000-000000000902';
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000901','2027-07-13T10:00Z');
do $$ begin
 if (select prior_occupancy from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000901')<>44 then
 raise exception 'El vecino cercano no alteró el prior como se esperaba'; end if;
end $$;
delete from public.user_reports;
-- Un reporte actual pesa 20; uno de hace 40 minutos pesa 10.
insert into public.user_reports(library_id,device_hash,reported_value,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000901',repeat('f',64),100,40.4,-3.7),
('00000000-0000-0000-0000-000000000901',repeat('0',64),20,40.4,-3.7);
update public.user_reports set created_at='2027-07-14T10:00Z'::timestamptz
 -case when reported_value=20 then interval '40 minutes' else interval '0 seconds' end;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000901','2027-07-14T10:00Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000901'
 and bayesian_occupancy=66 and active_reports_count=2 and crowd_pct=73 and confidence_score between .789 and .790) then
 raise exception 'Vida media de 40 minutos incorrecta'; end if;
end $$;
select public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000901','2027-07-14T11:31Z');
do $$ begin
 if not exists(select 1 from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000901'
 and bayesian_occupancy=40 and active_reports_count=0) then raise exception 'No caducaron los reportes'; end if;
 if public.csv_open_at('{"weekly":{"7":[["09:00","13:00"]]}}','2027-03-28T07:30Z') is not true
 or public.csv_open_at('{"weekly":{"7":[["09:00","13:00"]]}}','2027-10-31T08:30Z') is not true then
 raise exception 'Zona horaria Madrid/CET/CEST incorrecta'; end if;
 if public.csv_open_at('{"weekly":{"7":null}}','2027-10-31T08:30Z') is not null then
 raise exception 'Horario desconocido interpretado como cerrado'; end if;
end $$;
rollback;

-- Sync atómico de 94 fichas, UUID/coordenadas estables y archivo sin borrar reportes.
begin;
create temporary table csv_payload as select jsonb_agg(jsonb_build_object(
 'id',('10000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'name','Centro '||n,
 'num_resenas',100,'valoracion',4.5,'direccion','Dirección CSV','tipo','Biblioteca',
 'lat',40.4,'lng',-3.7,'source_url','https://example.org/verified','institution','otra',
 'opening_hours',jsonb_build_object('timezone','Europe/Madrid','weekly',
 (select jsonb_object_agg(d::text,'[["09:00","21:00"]]'::jsonb) from generate_series(1,7)d)),
 'historical_popularity',jsonb_build_object('model','csv-v1','days',
 (select jsonb_object_agg(d::text,(select jsonb_object_agg(lpad(h::text,2,'0'),40)
 from generate_series(6,23)h)) from generate_series(1,7)d)))) payload from generate_series(1,94)n;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng)
 values('10000000-0000-0000-0000-000000000001','old','preserved','Old name','otra','Test','Test',40.42,-3.72),
 ('20000000-0000-0000-0000-000000000001','old','archived','Archived','otra','Test','Test',40.4,-3.7);
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('10000000-0000-0000-0000-000000000001',40,repeat('8',64),40.42,-3.72);
update public.libraries set is_active=false where source_id='preserved';
select public.sync_csv_catalog(payload,repeat('a',64)) from csv_payload;
select public.sync_csv_catalog(payload,repeat('a',64)) from csv_payload;
do $$ begin
 if (select count(*) from public.libraries where is_active)<>94 then raise exception 'No hay exactamente 94 activas'; end if;
 if not exists(select 1 from public.libraries where source_id='preserved' and lat=40.42 and lng=-3.72 and name='Centro 1') then
 raise exception 'El sync cambió las coordenadas existentes'; end if;
 if not exists(select 1 from public.libraries where source_id='preserved' and is_active)
 or not exists(select 1 from public.user_reports where library_id='10000000-0000-0000-0000-000000000001') then
 raise exception 'Reactivar un centro perdió su identidad o reportes'; end if;
 if not exists(select 1 from public.libraries where source_id='archived' and not is_active) then
 raise exception 'No se archivó el centro antiguo'; end if;
 begin
  perform public.sync_csv_catalog((select jsonb_set(payload,'{87,historical_popularity,days,7,23}','101') from csv_payload),repeat('b',64));
  raise exception 'Curva inválida aceptada';
 exception when invalid_parameter_value then null; end;
 if exists(select 1 from public.libraries where is_active and csv_sha256<>repeat('a',64)) then
 raise exception 'El sync incompleto no se revirtió'; end if;
end $$;
-- Una futura ampliación no exige cambiar la función; un lote truncado o duplicado se rechaza.
do $$ declare v_payload jsonb; v_extra jsonb; v_result jsonb; begin
 select payload into v_payload from csv_payload;
 foreach v_extra in array array['[]'::jsonb, '{}'::jsonb,
   jsonb_set(v_payload,'{93,id}',to_jsonb('10000000-0000-0000-0000-000000000001'::text))] loop
   begin
     perform public.sync_csv_catalog(v_extra,repeat('a',64));
     raise exception 'Payload incompleto o duplicado aceptado';
   exception when invalid_parameter_value then null; end;
 end loop;
 v_extra := jsonb_set(jsonb_set(v_payload->0,'{id}',to_jsonb('10000000-0000-0000-0000-000000000095'::text)),
   '{name}',to_jsonb('Centro 95'::text));
 v_result := public.sync_csv_catalog(v_payload||jsonb_build_array(v_extra),repeat('a',64));
 if (v_result->>'active')::integer<>95 then raise exception 'No permite ampliar a 95'; end if;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.submit_report('20000000-0000-0000-0000-000000000001',40,repeat('c',64),40.4,-3.7);
  raise exception 'Se permite reportar en un centro archivado';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.sync_csv_catalog('[]',repeat('a',64));
  raise exception 'Sync expuesto al público';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;

-- Recalcular repetidamente no reinyecta el posterior en el prior.
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000990','test','csv-inertia','Inertia','otra','Test','Test',40.4,-3.7,
 jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb) from generate_series(1,7)d)),
 jsonb_build_object('model','csv-v1','days',(select jsonb_object_agg(d::text,
 (select jsonb_object_agg(lpad(h::text,2,'0'),40) from generate_series(0,23)h)) from generate_series(1,7)d));
do $$ declare v_now timestamptz:=clock_timestamp();
 v_before integer; v_after integer; begin
 -- Curva constante: las repeticiones y el cambio de ancla no deben contar dos veces el reporte.
 update public.occupancy_status set updated_at=v_now where library_id='00000000-0000-0000-0000-000000000990';
 perform public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000990',v_now);
 insert into public.user_reports(library_id,device_hash,reported_value,user_lat,user_lng)
 values('00000000-0000-0000-0000-000000000990',repeat('9',64),100,40.4,-3.7);
 update public.user_reports set created_at=v_now where library_id='00000000-0000-0000-0000-000000000990';
 perform public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000990',v_now);
 select prior_occupancy into v_before from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000990';
 perform public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000990',v_now);
 select prior_occupancy into v_after from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000990';
 if v_before is distinct from v_after then raise exception 'Se reinyectó evidencia en el prior'; end if;
 perform public.recalculate_csv_occupancy('00000000-0000-0000-0000-000000000990',v_now+interval '31 minutes');
 select prior_occupancy into v_after from public.occupancy_status where library_id='00000000-0000-0000-0000-000000000990';
 if v_before is distinct from v_after then raise exception 'El ancla nueva incorporó el posterior'; end if;
end $$;
rollback;
