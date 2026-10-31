-- Verified northern locations; full CSV sync activates all eight centers atomically.
begin;
create or replace function public.csv_open_at(p_hours jsonb, p_now timestamptz)
returns boolean language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Madrid';
  v_slots jsonb;
  v_slot jsonb;
  v_minutes numeric := extract(hour from v_local)*60 + extract(minute from v_local)
    + extract(second from v_local)/60;
begin
  if p_hours->'temporarily_closed' = 'true'::jsonb then return false; end if;
  if p_hours->'date_overrides' ? v_local::date::text then
    v_slots := p_hours->'date_overrides'->v_local::date::text;
  else
    v_slots := p_hours->'weekly'->extract(isodow from v_local)::integer::text;
  end if;
  if v_slots is null or jsonb_typeof(v_slots) <> 'array' then return null; end if;
  for v_slot in select value from jsonb_array_elements(v_slots) loop
    if v_minutes >= split_part(v_slot->>0, ':', 1)::integer*60 + split_part(v_slot->>0, ':', 2)::integer
      and v_minutes < split_part(v_slot->>1, ':', 1)::integer*60 + split_part(v_slot->>1, ':', 2)::integer then
      return true;
    end if;
  end loop;
  return false;
end;
$$;


insert into public.libraries(id,source,source_id,source_url,name,institution,address,district,lat,lng,is_active) values
('5417b035-aea1-5719-807d-e49bb02ed85b','csv-master','5417b035-aea1-5719-807d-e49bb02ed85b','https://www.comunidad.madrid/centros/biblioteca-municipal-claudio-rodriguez','Biblioteca Municipal Claudio Rodríguez','ayuntamiento','Av. Maximiliano Puerro del Tell, s/n, 28701 San Sebastián de los Reyes, Madrid','San Sebastián de los Reyes',40.551722363013,-3.6381134604385,false),
('8b9f3106-36f5-5730-976a-f2247b17b542','csv-master','8b9f3106-36f5-5730-976a-f2247b17b542','https://www.comunidad.madrid/centros/mediateca-pablo-iglesias','Centro Cultural Pablo Iglesias','ayuntamiento','Paseo de la Chopera, 59, 28100 Alcobendas, Madrid','Alcobendas',40.543554327171,-3.643849771261,false),
('03b20cc8-55b4-584a-936a-d8230ddb10fb','csv-master','03b20cc8-55b4-584a-936a-d8230ddb10fb','https://www.comunidad.madrid/centros/biblioteca-municipal-marcos-ana','Biblioteca Municipal Marcos Ana','ayuntamiento','Plaza de Andrés Caballero, 2, 28701 San Sebastián de los Reyes, Madrid','San Sebastián de los Reyes',40.552625512747,-3.6306739894496,false),
('c22c0c1c-e25a-5ee1-93a1-3122502d8212','csv-master','c22c0c1c-e25a-5ee1-93a1-3122502d8212','https://www.comunidad.madrid/centros/mediateca-miguel-delibes','Mediateca Miguel Delibes','ayuntamiento','Av. de la Magia, 4, 28100 Alcobendas, Madrid','Alcobendas',40.55174081112,-3.6571749449115,false),
('a0a47039-f670-5b0a-80c8-0f4911903e26','csv-master','a0a47039-f670-5b0a-80c8-0f4911903e26','https://www.comunidad.madrid/centros/mediateca-anabel-segura','Centro Cultural Anabel Segura','ayuntamiento','Av. de Bruselas, 19, 28108 Alcobendas, Madrid','Alcobendas',40.531516068377,-3.6366388295675,false),
('7ef00bb0-22ab-54f6-a5f3-5a484b40aab6','csv-master','7ef00bb0-22ab-54f6-a5f3-5a484b40aab6','https://www.comunidad.madrid/centros/biblioteca-municipal-plaza-iglesia','Biblioteca Pública Municipal Plaza de la Iglesia','ayuntamiento','Pl. de la Iglesia, 4, 28701 San Sebastián de los Reyes, Madrid','San Sebastián de los Reyes',40.546978570146,-3.6268451606142,false)
on conflict(id) do nothing;
notify pgrst,'reload schema';
commit;
