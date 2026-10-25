-- =====================================================================
-- Migration 6: staff overview functions (dashboard statistics + feedback list)
--
-- Both are SECURITY DEFINER, search_path pinned, executable by signed-in users
-- but they refuse anyone who is not an active administrator or manager.
-- They return aggregate counts and list rows only; they are NOT the Milestone 9
-- reports (which stay administrator-only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- dashboard_stats(): headline numbers, a 30-day daily trend (Nairobi time)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Africa/Nairobi')::date;
  v jsonb;
begin
  if not (public.is_administrator() or public.is_manager()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total',        count(*),
    'complaints',   count(*) filter (where feedback_type = 'complaint'),
    'compliments',  count(*) filter (where feedback_type = 'compliment'),
    'suggestions',  count(*) filter (where feedback_type = 'suggestion'),
    'pending',      count(*) filter (where status = 'Pending'),
    'in_progress',  count(*) filter (where status = 'In Progress'),
    'resolved',     count(*) filter (where status = 'Resolved'),
    'avg_rating',   round(avg(service_rating)::numeric, 1)
  ) into v from public.feedback;

  v := v || jsonb_build_object('trend', (
    select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'count', coalesce(c.n, 0)) order by d.day), '[]'::jsonb)
    from (select generate_series(v_today - 29, v_today, interval '1 day')::date as day) d
    left join (
      select (created_at at time zone 'Africa/Nairobi')::date as day, count(*) as n
      from public.feedback
      where created_at >= (v_today - 29)::timestamp at time zone 'Africa/Nairobi'
      group by 1
    ) c on c.day = d.day
  ));
  return v;
end $$;

-- ---------------------------------------------------------------------
-- list_feedback(): searchable, filterable, paged list for administrators and managers
-- ---------------------------------------------------------------------
create or replace function public.list_feedback(
  p_search   text    default null,
  p_type     text    default null,
  p_status   text    default null,
  p_limit    integer default 10,
  p_offset   integer default 0
) returns table (
  id uuid, reference_number text, feedback_type text, subject text, status text,
  service_rating smallint, created_at timestamptz,
  customer_name text, assigned_employee_id uuid, assigned_employee_name text,
  total_count bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_pat text;
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not (public.is_administrator() or public.is_manager()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if p_type is not null and p_type not in ('complaint', 'compliment', 'suggestion') then
    raise exception 'Invalid type filter.' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('Pending', 'In Progress', 'Resolved') then
    raise exception 'Invalid status filter.' using errcode = '22023';
  end if;
  if nullif(btrim(p_search), '') is not null then
    -- Escape LIKE wildcards so the search text is always literal.
    v_pat := '%' || replace(replace(replace(left(btrim(p_search), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
    select f.id, f.reference_number, f.feedback_type, f.subject, f.status,
           f.service_rating, f.created_at,
           btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')),
           a.assigned_employee_id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           count(*) over ()
    from public.feedback f
    join public.profiles c on c.id = f.customer_id
    left join public.feedback_assignments a on a.feedback_id = f.id and a.unassigned_at is null
    left join public.profiles e on e.id = a.assigned_employee_id
    where (p_type is null or f.feedback_type = p_type)
      and (p_status is null or f.status = p_status)
      and (v_pat is null
           or f.reference_number ilike v_pat
           or f.subject ilike v_pat
           or (c.first_name || ' ' || coalesce(c.last_name, '')) ilike v_pat
           or c.email ilike v_pat)
    order by f.created_at desc, f.id
    limit v_limit offset v_offset;
end $$;

revoke execute on function public.dashboard_stats(), public.list_feedback(text, text, text, integer, integer) from public, anon;
grant execute on function public.dashboard_stats(), public.list_feedback(text, text, text, integer, integer) to authenticated;
