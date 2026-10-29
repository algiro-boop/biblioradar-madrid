-- Las curvas arquetípicas completas siguen teniendo precisión baja (kappa=6).
begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng,
  num_resenas,opening_hours,historical_popularity)
select '00000000-0000-0000-0000-000000000997','test','archetype-kappa','Archetype','otra','Test','Test',40.4,-3.7,
  120,jsonb_build_object('weekly',(select jsonb_object_agg(d::text,'[["00:00","24:00"]]'::jsonb)
    from generate_series(1,7)d)),
  jsonb_build_object('model','csv-v1','provenance',jsonb_build_object('kind','archetype','kappa',6),
    'days',(select jsonb_object_agg(d::text,(select jsonb_object_agg(lpad(h::text,2,'0'),40)
      from generate_series(0,23)h)) from generate_series(1,7)d));
insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng)
values('00000000-0000-0000-0000-000000000997',100,repeat('6',64),40.4,-3.7);
update public.user_reports set created_at='2027-07-15T11:00Z'
  where library_id='00000000-0000-0000-0000-000000000997';
do $$ declare v_id uuid:='00000000-0000-0000-0000-000000000997'; v_conf numeric; begin
  if (select public.csv_curve_at(historical_popularity,opening_hours,'2027-07-15T11:00Z')
      from public.libraries where id=v_id) is distinct from 40::numeric then
    raise exception 'La curva del test debe estar completa, sin activar el fallback de huecos';
  end if;
  perform public.recalculate_csv_occupancy(v_id,'2027-07-15T11:00Z');
  select confidence_score into v_conf from public.occupancy_status where library_id=v_id;
  if abs(v_conf-40::numeric/46)>0.000001 then
    raise exception 'Una curva arquetípica completa debe usar kappa=6: %',v_conf;
  end if;
  if (select primary_source not like '%curva arquetípica%' from public.occupancy_status where library_id=v_id) then
    raise exception 'Falta indicar el origen arquetípico';
  end if;
  update public.libraries set historical_popularity=jsonb_set(historical_popularity,
    '{provenance,kind}','"reference_estimate"') where id=v_id;
  perform public.recalculate_csv_occupancy(v_id,'2027-07-15T11:00Z');
  select confidence_score into v_conf from public.occupancy_status where library_id=v_id;
  if abs(v_conf-40/(40+least(24,8+2*ln(121::numeric))))>0.000001 then
    raise exception 'Se cambió la precisión normal de las curvas anteriores';
  end if;
  update public.libraries set historical_popularity=jsonb_set(historical_popularity,
    '{provenance,kind}','"archetype"') where id=v_id;
  perform public.recalculate_csv_occupancy(v_id,'2027-07-15T12:31Z');
  if not exists(select 1 from public.occupancy_status where library_id=v_id
      and active_reports_count=0 and confidence_score=0 and bayesian_occupancy=prior_occupancy) then
    raise exception 'La expiración de reportes debe recuperar el prior arquetípico sin perder datos';
  end if;
end $$;
rollback;
