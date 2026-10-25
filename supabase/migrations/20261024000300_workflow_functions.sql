-- =====================================================================
-- Migration 3 of 5: controlled workflow functions (the ONLY way to change
-- assignment, status, responses and resolution)
--
-- Clients have no UPDATE/INSERT/DELETE rights on these tables (see
-- migration 4). Each function below is SECURITY DEFINER with a pinned
-- search_path, validates the caller's role from the profiles table, locks
-- the row it changes, writes history/audit rows and creates notifications.
--
-- Workflow: Pending --(manager assigns)--> Pending, assigned
--           --(employee starts)--> In Progress --(employee resolves)--> Resolved
-- Assigning does not change the status; the employee moves it to In Progress.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Employees a customer may name as "served by": first names only.
-- ---------------------------------------------------------------------
create or replace function public.list_servable_employees()
returns table (id uuid, first_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.first_name
  from public.profiles p
  where auth.uid() is not null
    and public.current_app_role() is not null
    and p.role = 'employee' and p.account_status = 'active'
  order by p.first_name, p.id
$$;

-- ---------------------------------------------------------------------
-- Active employees a manager can assign cases to (with current workload).
-- ---------------------------------------------------------------------
create or replace function public.list_assignable_employees()
returns table (id uuid, first_name text, last_name text, open_cases bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_manager() or public.is_administrator()) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
    select p.id, p.first_name, p.last_name,
           (select count(*) from public.feedback_assignments a
              join public.feedback f on f.id = a.feedback_id
             where a.assigned_employee_id = p.id and a.unassigned_at is null and f.status <> 'Resolved')
    from public.profiles p
    where p.role = 'employee' and p.account_status = 'active'
    order by p.first_name, p.last_name, p.id;
end $$;

-- ---------------------------------------------------------------------
-- Manager assigns or reassigns a case. History is preserved.
-- ---------------------------------------------------------------------
create or replace function public.assign_feedback(
  p_feedback_id uuid, p_employee_id uuid, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fb   public.feedback%rowtype;
  v_prev public.feedback_assignments%rowtype;
  v_had_prev boolean;
  v_id   uuid;
begin
  if not public.is_manager() then
    raise exception 'Only managers can assign feedback.' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Assignment note is too long.' using errcode = '22001';
  end if;

  select * into v_fb from public.feedback where id = p_feedback_id for update;
  if not found then
    raise exception 'Feedback not found.' using errcode = 'P0002';
  end if;
  if v_fb.status = 'Resolved' then
    raise exception 'Resolved feedback cannot be assigned.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.profiles p
                 where p.id = p_employee_id and p.role = 'employee' and p.account_status = 'active') then
    raise exception 'Choose an active employee.' using errcode = '23514';
  end if;

  select * into v_prev from public.feedback_assignments
   where feedback_id = p_feedback_id and unassigned_at is null for update;
  v_had_prev := found;

  if v_had_prev and v_prev.assigned_employee_id = p_employee_id then
    raise exception 'This case is already assigned to that employee.' using errcode = '23505';
  end if;
  if v_had_prev then
    update public.feedback_assignments set unassigned_at = now() where id = v_prev.id;
  end if;

  insert into public.feedback_assignments
    (feedback_id, assigned_employee_id, assigned_by_manager_id, assignment_note)
  values (p_feedback_id, p_employee_id, auth.uid(), nullif(btrim(p_note), ''))
  returning id into v_id;

  update public.feedback set updated_at = now() where id = p_feedback_id;

  perform public.log_audit(
    case when v_had_prev then 'feedback_reassigned' else 'feedback_assigned' end,
    'feedback', p_feedback_id::text,
    jsonb_build_object('reference', v_fb.reference_number, 'employee_id', p_employee_id,
                       'previous_employee_id', case when v_had_prev then v_prev.assigned_employee_id end));

  perform public.notify_user(p_employee_id, p_feedback_id,
    case when v_had_prev then 'reassignment' else 'assignment' end,
    'A case has been assigned to you: ' || v_fb.reference_number);
  if v_had_prev then
    perform public.notify_user(v_prev.assigned_employee_id, p_feedback_id, 'reassignment',
      'Case ' || v_fb.reference_number || ' was reassigned to another employee.');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Employee starts work: Pending -> In Progress (own assigned case only)
-- ---------------------------------------------------------------------
create or replace function public.start_feedback(p_feedback_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fb public.feedback%rowtype;
begin
  if not public.is_assigned_to_me(p_feedback_id) then
    raise exception 'You can only update cases assigned to you.' using errcode = '42501';
  end if;
  if p_note is not null and char_length(p_note) > 500 then
    raise exception 'Note is too long.' using errcode = '22001';
  end if;

  select * into v_fb from public.feedback where id = p_feedback_id for update;
  if v_fb.status <> 'Pending' then
    raise exception 'Only Pending cases can be started.' using errcode = '23514';
  end if;

  update public.feedback set status = 'In Progress' where id = p_feedback_id;
  insert into public.feedback_status_history (feedback_id, previous_status, new_status, changed_by, change_note)
  values (p_feedback_id, 'Pending', 'In Progress', auth.uid(), nullif(btrim(p_note), ''));

  perform public.log_audit('status_changed', 'feedback', p_feedback_id::text,
    jsonb_build_object('reference', v_fb.reference_number, 'from', 'Pending', 'to', 'In Progress'));
  perform public.notify_user(v_fb.customer_id, p_feedback_id, 'status_change',
    'Your feedback ' || v_fb.reference_number || ' is now In Progress.');
end $$;

-- ---------------------------------------------------------------------
-- Employee adds an internal note or a customer-visible response
-- ---------------------------------------------------------------------
create or replace function public.add_feedback_response(
  p_feedback_id uuid, p_text text, p_visibility text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_fb public.feedback%rowtype;
  v_id uuid;
begin
  if not public.is_assigned_to_me(p_feedback_id) then
    raise exception 'You can only respond to cases assigned to you.' using errcode = '42501';
  end if;
  if p_visibility not in ('customer', 'internal') then
    raise exception 'Invalid visibility.' using errcode = '22023';
  end if;
  if p_text is null or char_length(btrim(p_text)) not between 1 and 4000 then
    raise exception 'Enter a message of up to 4000 characters.' using errcode = '22023';
  end if;

  select * into v_fb from public.feedback where id = p_feedback_id for update;
  if v_fb.status = 'Resolved' then
    raise exception 'This case is already resolved.' using errcode = '23514';
  end if;

  insert into public.feedback_responses (feedback_id, author_id, response_text, visibility)
  values (p_feedback_id, auth.uid(), btrim(p_text), p_visibility)
  returning id into v_id;

  perform public.log_audit('response_added', 'feedback', p_feedback_id::text,
    jsonb_build_object('reference', v_fb.reference_number, 'visibility', p_visibility));
  if p_visibility = 'customer' then
    perform public.notify_user(v_fb.customer_id, p_feedback_id, 'response',
      'There is a new response to your feedback ' || v_fb.reference_number || '.');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Employee resolves their own case. Resolution details are mandatory;
-- the resolver and timestamp are recorded.
-- ---------------------------------------------------------------------
create or replace function public.resolve_feedback(
  p_feedback_id uuid,
  p_resolution_details text,
  p_customer_response text default null,
  p_internal_note text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_fb  public.feedback%rowtype;
  v_min integer := public.setting_int('min_resolution_details_length', 10);
begin
  if not public.is_assigned_to_me(p_feedback_id) then
    raise exception 'You can only resolve cases assigned to you.' using errcode = '42501';
  end if;
  if p_resolution_details is null or char_length(btrim(p_resolution_details)) < v_min
     or char_length(p_resolution_details) > 4000 then
    raise exception 'Enter resolution details (at least % characters).', v_min using errcode = '22023';
  end if;
  if p_customer_response is not null and char_length(p_customer_response) > 4000 then
    raise exception 'Response is too long.' using errcode = '22001';
  end if;
  if p_internal_note is not null and char_length(p_internal_note) > 4000 then
    raise exception 'Note is too long.' using errcode = '22001';
  end if;

  select * into v_fb from public.feedback where id = p_feedback_id for update;
  if v_fb.status <> 'In Progress' then
    raise exception 'Start the case (In Progress) before resolving it.' using errcode = '23514';
  end if;

  update public.feedback
     set status = 'Resolved', resolved_at = now(), resolved_by = auth.uid(),
         resolution_details = btrim(p_resolution_details)
   where id = p_feedback_id;

  insert into public.feedback_status_history (feedback_id, previous_status, new_status, changed_by, change_note)
  values (p_feedback_id, 'In Progress', 'Resolved', auth.uid(), 'Resolved by employee');

  if nullif(btrim(p_customer_response), '') is not null then
    insert into public.feedback_responses (feedback_id, author_id, response_text, visibility)
    values (p_feedback_id, auth.uid(), btrim(p_customer_response), 'customer');
  end if;
  if nullif(btrim(p_internal_note), '') is not null then
    insert into public.feedback_responses (feedback_id, author_id, response_text, visibility)
    values (p_feedback_id, auth.uid(), btrim(p_internal_note), 'internal');
  end if;

  perform public.log_audit('feedback_resolved', 'feedback', p_feedback_id::text,
    jsonb_build_object('reference', v_fb.reference_number));
  perform public.notify_user(v_fb.customer_id, p_feedback_id, 'resolution',
    'Your feedback ' || v_fb.reference_number || ' has been resolved.');
end $$;

-- ---------------------------------------------------------------------
-- Function privileges: signed-in users only (each function re-checks role)
-- ---------------------------------------------------------------------
revoke execute on function
  public.list_servable_employees(), public.list_assignable_employees(),
  public.assign_feedback(uuid, uuid, text), public.start_feedback(uuid, text),
  public.add_feedback_response(uuid, text, text),
  public.resolve_feedback(uuid, text, text, text)
  from public, anon;
grant execute on function
  public.list_servable_employees(), public.list_assignable_employees(),
  public.assign_feedback(uuid, uuid, text), public.start_feedback(uuid, text),
  public.add_feedback_response(uuid, text, text),
  public.resolve_feedback(uuid, text, text, text)
  to authenticated;
