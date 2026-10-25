-- =====================================================================
-- Migration 7: list_feedback gains an assignment filter (for the manager's
-- "awaiting assignment" queue). The function is replaced, so the old
-- signature is dropped and privileges are granted again.
-- p_assignment: null = all, 'unassigned' = no current assignee, 'assigned' = has one.
-- =====================================================================
drop function if exists public.list_feedback(text, text, text, integer, integer);

create or replace function public.list_feedback(
  p_search     text    default null,
  p_type       text    default null,
  p_status     text    default null,
  p_limit      integer default 10,
  p_offset     integer default 0,
  p_assignment text    default null
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
  if p_assignment is not null and p_assignment not in ('assigned', 'unassigned') then
    raise exception 'Invalid assignment filter.' using errcode = '22023';
  end if;
  if nullif(btrim(p_search), '') is not null then
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
      and (p_assignment is null
           or (p_assignment = 'unassigned' and a.id is null)
           or (p_assignment = 'assigned' and a.id is not null))
      and (v_pat is null
           or f.reference_number ilike v_pat
           or f.subject ilike v_pat
           or (c.first_name || ' ' || coalesce(c.last_name, '')) ilike v_pat
           or c.email ilike v_pat)
    order by f.created_at desc, f.id
    limit v_limit offset v_offset;
end $$;

revoke execute on function public.list_feedback(text, text, text, integer, integer, text) from public, anon;
grant execute on function public.list_feedback(text, text, text, integer, integer, text) to authenticated;
