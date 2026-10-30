-- Public activity contains no device identifiers or coordinates. Private reports retain RLS.
begin;
alter table public.user_reports add column if not exists tags text[] not null default '{}'::text[];

create or replace function public.valid_report_tags(p_tags text[]) returns boolean
language sql immutable set search_path='' as $$
  select p_tags is not null and cardinality(p_tags)<=3
    and coalesce(array_ndims(p_tags),1)=1
    and not exists(select 1 from unnest(p_tags) t where t is null or t not in
      ('sockets_free','sockets_full','silent','noisy','temp_ok','temp_cold','temp_hot'))
    and (select count(*)=count(distinct case
      when t like 'sockets_%' then 'sockets'
      when t in ('silent','noisy') then 'sound' else 'temperature' end) from unnest(p_tags) t);
$$;
alter table public.user_reports drop constraint if exists user_reports_tags_valid;
alter table public.user_reports add constraint user_reports_tags_valid check(public.valid_report_tags(tags));
revoke all on function public.valid_report_tags(text[]) from public,anon,authenticated;
grant execute on function public.valid_report_tags(text[]) to service_role;

-- Replace the signature instead of leaving ambiguous PostgREST overloads. Old callers omit p_tags.
drop function if exists public.submit_report(uuid,integer,text,double precision,double precision);
create or replace function public.submit_report(
  p_library_id uuid,p_reported_value integer,p_device_hash text,
  p_user_lat double precision,p_user_lng double precision,p_tags text[] default '{}'::text[]
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.valid_report_tags(p_tags) then
    raise exception 'Tags de ambiente inválidos' using errcode='22023';
  end if;
  insert into public.user_reports(library_id,reported_value,device_hash,user_lat,user_lng,tags)
    values(p_library_id,p_reported_value,p_device_hash,p_user_lat,p_user_lng,p_tags)
    returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_report(uuid,integer,text,double precision,double precision,text[])
  from public,anon,authenticated;
grant execute on function public.submit_report(uuid,integer,text,double precision,double precision,text[])
  to anon,authenticated,service_role;

alter table public.occupancy_status add column if not exists latest_report_at timestamptz;
alter table public.occupancy_status add column if not exists active_tags text[] not null default '{}';
-- Individual timestamps let clients expire each tag even when a newer report has no tags.
alter table public.occupancy_status add column if not exists active_tag_times jsonb not null default '{}';

-- Runs on every recalculation, including the existing cron, without replacing the fusion engine.
create or replace function public.populate_report_context() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  l public.libraries%rowtype;
  v_now timestamptz := clock_timestamp();
  v_since timestamptz;
begin
  new.latest_report_at:=null; new.active_tags:='{}'; new.active_tag_times:='{}';
  if new.is_open_now is not true then return new; end if;
  select * into l from public.libraries where id=new.library_id;
  if not l.is_active then return new; end if;
  if l.historical_popularity->>'model'='csv-v1' then
    -- CSV recalculation supplies its evaluation time, also used by deterministic SQL tests.
    v_now:=coalesce(new.base_observed_at,v_now);
    v_since:=public.csv_session_start(l.opening_hours,v_now);
  end if;
  v_since:=greatest(v_now-interval '90 minutes',v_since);
  with latest as (
    select distinct on(device_hash) created_at,tags from public.user_reports
      where library_id=new.library_id and created_at>v_since and created_at<=v_now
      order by device_hash,created_at desc,id desc
  ) select max(created_at) into new.latest_report_at from latest;
  with latest as (
    select distinct on(device_hash) created_at,tags from public.user_reports
      where library_id=new.library_id and created_at>v_since and created_at<=v_now
      order by device_hash,created_at desc,id desc
  ), votes as (
    select t, max(created_at) as reported_at,count(*) as votes,
      case when t like 'sockets_%' then 'sockets'
        when t in ('silent','noisy') then 'sound' else 'temperature' end as category
      from latest cross join lateral unnest(tags) t group by t
  ), ranked as (
    select *,row_number() over(partition by category order by votes desc,reported_at desc,t) as rank
      from votes
  ) select coalesce(array_agg(t order by category),'{}'),
      coalesce(jsonb_object_agg(t,reported_at),'{}')
    into new.active_tags,new.active_tag_times from ranked where rank=1;
  return new;
end;
$$;
revoke all on function public.populate_report_context() from public,anon,authenticated;
drop trigger if exists occupancy_report_context on public.occupancy_status;
create trigger occupancy_report_context before insert or update on public.occupancy_status
  for each row execute function public.populate_report_context();

create or replace function public.get_recent_reports(limit_count integer default 5)
returns table(library_id uuid,library_name text,district text,reported_value integer,tags text[],created_at timestamptz)
language sql stable security definer set search_path='' as $$
  select r.library_id,l.name,l.district,r.reported_value,r.tags,r.created_at
    from public.user_reports r join public.libraries l on l.id=r.library_id
    where l.is_active and r.created_at>statement_timestamp()-interval '3 hours'
      and r.created_at<=statement_timestamp()
    order by r.created_at desc,r.id desc
    limit greatest(1,least(coalesce(limit_count,5),5));
$$;
revoke all on function public.get_recent_reports(integer) from public,anon,authenticated;
grant execute on function public.get_recent_reports(integer) to anon,authenticated,service_role;
create index if not exists user_reports_recent_activity on public.user_reports(created_at desc,id desc);
-- Backfill derived metadata; subsequent report inserts and scheduled refreshes maintain it.
update public.occupancy_status set latest_report_at=latest_report_at;
notify pgrst,'reload schema';
commit;
