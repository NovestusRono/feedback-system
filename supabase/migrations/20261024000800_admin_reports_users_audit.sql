-- =====================================================================
-- Migration 8: administrator-only reports, user listing, audit log listing
--
-- Every function is SECURITY DEFINER with a pinned search_path and refuses anyone
-- who is not an ACTIVE ADMINISTRATOR (managers are refused too: reports are
-- administrator-only). They never return passwords, tokens or message bodies.
-- =====================================================================

create or replace function public.require_administrator() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_administrator() then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
end $$;

-- Period bounds in Nairobi time: [from 00:00, to + 1 day 00:00)
create or replace function public.report_bounds(p_from date, p_to date, out t_from timestamptz, out t_to timestamptz)
language plpgsql immutable set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid date range.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'The date range cannot exceed 366 days.' using errcode = '22023';
  end if;
  t_from := p_from::timestamp at time zone 'Africa/Nairobi';
  t_to   := (p_to + 1)::timestamp at time zone 'Africa/Nairobi';
end $$;

-- ---------------------------------------------------------------------
-- report_summary: everything the Reports page shows, for feedback CREATED in the period
-- ---------------------------------------------------------------------
create or replace function public.report_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b record;
  v jsonb;
begin
  perform public.require_administrator();
  select * into b from public.report_bounds(p_from, p_to);

  with f as (
    select * from public.feedback where created_at >= b.t_from and created_at < b.t_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total',              count(*),
    'complaints',         count(*) filter (where feedback_type = 'complaint'),
    'compliments',        count(*) filter (where feedback_type = 'compliment'),
    'suggestions',        count(*) filter (where feedback_type = 'suggestion'),
    'resolved_complaints',count(*) filter (where feedback_type = 'complaint' and status = 'Resolved'),
    'pending',            count(*) filter (where status = 'Pending'),
    'in_progress',        count(*) filter (where status = 'In Progress'),
    'resolved',           count(*) filter (where status = 'Resolved'),
    'avg_rating',         round(avg(service_rating)::numeric, 2),
    'avg_resolution_hours', round((avg(extract(epoch from (resolved_at - created_at)) / 3600)
                                    filter (where status = 'Resolved'))::numeric, 1),
    'rating_distribution', jsonb_build_array(
        count(*) filter (where service_rating = 1), count(*) filter (where service_rating = 2),
        count(*) filter (where service_rating = 3), count(*) filter (where service_rating = 4),
        count(*) filter (where service_rating = 5))
  ) into v from f;

  v := v || jsonb_build_object(
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object('name', n, 'count', c) order by c desc, n), '[]'::jsonb)
      from (select coalesce(product_service_category, 'Not specified') as n, count(*) as c
            from public.feedback where created_at >= b.t_from and created_at < b.t_to group by 1) x),
    'by_employee', (
      select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'assigned', assigned, 'resolved', resolved, 'avg_hours', avg_hours)
                                order by assigned desc, name), '[]'::jsonb)
      from (select e.id, btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')) as name,
                   count(*) as assigned,
                   count(*) filter (where f.status = 'Resolved') as resolved,
                   round((avg(extract(epoch from (f.resolved_at - f.created_at)) / 3600)
                          filter (where f.status = 'Resolved'))::numeric, 1) as avg_hours
            from public.feedback f
            join public.feedback_assignments a on a.feedback_id = f.id and a.unassigned_at is null
            join public.profiles e on e.id = a.assigned_employee_id
            where f.created_at >= b.t_from and f.created_at < b.t_to
            group by e.id, e.first_name, e.last_name) y),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0)) order by d.day), '[]'::jsonb)
      from (select generate_series(p_from, p_to, interval '1 day')::date as day) d
      left join (select (created_at at time zone 'Africa/Nairobi')::date as day, count(*) as n
                 from public.feedback where created_at >= b.t_from and created_at < b.t_to group by 1) c on c.day = d.day)
  );
  return v;
end $$;

-- ---------------------------------------------------------------------
-- report_rows: one line per feedback for CSV export (customer NAME only, no contact data)
-- ---------------------------------------------------------------------
create or replace function public.report_rows(p_from date, p_to date)
returns table (
  reference_number text, created_at timestamptz, feedback_type text, status text, subject text,
  customer_name text, category text, service_rating smallint, assigned_employee text,
  resolved_at timestamptz, resolution_hours numeric
)
language plpgsql stable security definer set search_path = '' as $$
declare b record;
begin
  perform public.require_administrator();
  select * into b from public.report_bounds(p_from, p_to);
  return query
    select f.reference_number, f.created_at, f.feedback_type, f.status, f.subject,
           btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
           f.product_service_category, f.service_rating,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           f.resolved_at,
           case when f.resolved_at is not null then round((extract(epoch from (f.resolved_at - f.created_at)) / 3600)::numeric, 1) end
    from public.feedback f
    join public.profiles c on c.id = f.customer_id
    left join public.feedback_assignments a on a.feedback_id = f.id and a.unassigned_at is null
    left join public.profiles e on e.id = a.assigned_employee_id
    where f.created_at >= b.t_from and f.created_at < b.t_to
    order by f.created_at, f.id
    limit 10000;
end $$;

-- ---------------------------------------------------------------------
-- list_users: searchable, filterable, paged
-- ---------------------------------------------------------------------
create or replace function public.list_users(
  p_search text default null, p_role text default null, p_status text default null,
  p_limit integer default 10, p_offset integer default 0
) returns table (
  id uuid, first_name text, last_name text, email text, phone text, role text,
  account_status text, created_at timestamptz, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pat text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.require_administrator();
  if p_role is not null and p_role not in ('customer', 'administrator', 'manager', 'employee') then
    raise exception 'Invalid role filter.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('active', 'inactive') then
    raise exception 'Invalid status filter.' using errcode = '22023';
  end if;
  if nullif(btrim(p_search), '') is not null then
    v_pat := '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select p.id, p.first_name, p.last_name, p.email, p.phone, p.role, p.account_status, p.created_at, count(*) over ()
    from public.profiles p
    where (p_role is null or p.role = p_role)
      and (p_status is null or p.account_status = p_status)
      and (v_pat is null or (p.first_name || ' ' || coalesce(p.last_name, '')) ilike v_pat or p.email ilike v_pat)
    order by (p.role = 'customer'), p.first_name, p.last_name, p.id
    limit v_limit offset v_offset;
end $$;

-- ---------------------------------------------------------------------
-- list_audit_logs: newest first, with the actor's name; optional action filter
-- ---------------------------------------------------------------------
create or replace function public.list_audit_logs(
  p_action text default null, p_limit integer default 20, p_offset integer default 0
) returns table (
  id bigint, created_at timestamptz, actor_name text, action text, entity_type text,
  entity_id text, metadata jsonb, total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  perform public.require_administrator();
  return query
    select l.id, l.created_at,
           case when l.actor_id is null then 'System'
                else coalesce(nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Unknown user') end,
           l.action, l.entity_type, l.entity_id, l.metadata, count(*) over ()
    from public.audit_logs l
    left join public.profiles p on p.id = l.actor_id
    where (nullif(btrim(p_action), '') is null or l.action = btrim(p_action))
    order by l.created_at desc, l.id desc
    limit v_limit offset v_offset;
end $$;

-- ---------------------------------------------------------------------
-- log_admin_event: lets the Reports page record that a report was generated/exported.
-- Whitelisted actions only, so it cannot be used to forge other audit entries.
-- ---------------------------------------------------------------------
create or replace function public.log_admin_event(p_action text, p_metadata jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_administrator();
  if p_action not in ('report_generated', 'report_exported', 'report_printed') then
    raise exception 'Unknown event.' using errcode = '22023';
  end if;
  -- keep only small, safe values
  perform public.log_audit(p_action, 'report', null,
    jsonb_build_object('from', left(p_metadata ->> 'from', 10), 'to', left(p_metadata ->> 'to', 10)));
end $$;

revoke execute on function
  public.require_administrator(), public.report_bounds(date, date),
  public.report_summary(date, date), public.report_rows(date, date),
  public.list_users(text, text, text, integer, integer), public.list_audit_logs(text, integer, integer),
  public.log_admin_event(text, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.report_summary(date, date), public.report_rows(date, date),
  public.list_users(text, text, text, integer, integer), public.list_audit_logs(text, integer, integer),
  public.log_admin_event(text, jsonb)
  to authenticated;
