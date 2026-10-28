begin;
insert into public.libraries(id,source,source_id,name,institution,address,district,lat,lng)
 values('00000000-0000-0000-0000-000000006001','test','feedback','Feedback test','otra','Test','Test',40.4,-3.7);
set local role anon;
select public.submit_feedback('error_horario','  Horario equivocado  ',repeat('a',64),'00000000-0000-0000-0000-000000006001','  ejemplo@example.org  ');
select public.submit_feedback('nueva_biblioteca',repeat('x',1000),repeat('a',64),null,'');
select public.submit_feedback('bug_app','💡💡💡💡💡',repeat('a',64));
do $$ declare v_detail text; begin
 begin
  perform public.submit_feedback('otro','Cuarto envío',repeat('a',64));
  raise exception 'Se permitió el cuarto envío';
 exception when raise_exception then
  if sqlerrm<>'Máximo 3 sugerencias por hora' then raise; end if;
  get stacked diagnostics v_detail=pg_exception_detail;
  if (v_detail::jsonb->>'retry_after_seconds')::integer not between 3500 and 3600 then raise exception 'Plazo incorrecto'; end if;
 end;
 begin
  perform count(*) from public.user_feedback;
  raise exception 'Lectura pública expuesta';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.user_feedback(category,message,device_hash) values('otro','Texto válido',repeat('b',64));
  raise exception 'Insert directo expuesto';
 exception when insufficient_privilege then null; end;
 -- Validar antes de consumir cuota; cada caso debe rechazar con 22023.
 begin perform public.submit_feedback('invalida','Texto válido',repeat('b',64)); raise exception 'Categoría inválida aceptada';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro','1234',repeat('b',64)); raise exception 'Mensaje corto aceptado';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro',repeat('x',1001),repeat('b',64)); raise exception 'Mensaje largo aceptado';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro',null,repeat('b',64)); raise exception 'Mensaje nulo aceptado';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro','Texto válido','invalid'); raise exception 'Dispositivo inválido aceptado';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro','Texto válido',repeat('b',64),null,repeat('x',201)); raise exception 'Contacto largo aceptado';
 exception when invalid_parameter_value then null; end;
 begin perform public.submit_feedback('otro','Texto válido',repeat('b',64),'00000000-0000-0000-0000-000000000000'); raise exception 'Biblioteca inválida aceptada';
 exception when invalid_parameter_value then null; end;
end $$;
-- La cuota es por dispositivo; uno diferente puede enviar.
select public.submit_feedback('sugerencia','Otro dispositivo',repeat('b',64));
reset role;
do $$ begin
 if (select count(*) from public.user_feedback where device_hash=repeat('a',64))<>3 then raise exception 'Conteo de sugerencias incorrecto'; end if;
 if not exists(select 1 from public.user_feedback where message='Horario equivocado' and contact_info='ejemplo@example.org') then raise exception 'No se normalizó el texto'; end if;
end $$;
update public.user_feedback set created_at=clock_timestamp()-interval '61 minutes' where device_hash=repeat('a',64);
set local role anon;
select public.submit_feedback('otro','Cuota liberada',repeat('a',64));
-- Los reportes de ocupación no comparten cuota con sugerencias.
select public.submit_report('00000000-0000-0000-0000-000000006001',20,repeat('a',64),40.4,-3.7);
reset role;
update public.user_reports set created_at=clock_timestamp()-interval '31 minutes' where library_id='00000000-0000-0000-0000-000000006001';
set local role anon;
-- Sigue dentro de la ventana bayesiana de 90 minutos; el cooldown de 30 ya terminó.
select public.submit_report('00000000-0000-0000-0000-000000006001',40,repeat('a',64),40.4,-3.7);
reset role;
update public.user_reports set created_at=clock_timestamp()-interval '29 minutes' where library_id='00000000-0000-0000-0000-000000006001' and reported_value=40;
set local role anon;
do $$ declare v_detail text; begin
 begin
  perform public.submit_report('00000000-0000-0000-0000-000000006001',75,repeat('a',64),40.4,-3.7);
  raise exception 'No se aplicó el cooldown de 30 minutos';
 exception when raise_exception then
  if sqlerrm<>'Solo un reporte por biblioteca cada 30 minutos' then raise; end if;
  get stacked diagnostics v_detail=pg_exception_detail;
  if (v_detail::jsonb->>'retry_after_seconds')::integer not between 1 and 60 then raise exception 'Se reiniciaron otros 30 minutos'; end if;
 end;
end $$;
reset role;
rollback;
