-- =====================================================================
-- Migration 9: anonymous feedback (no registration, no login)
--
-- Design
--  * feedback.is_anonymous = true  <=>  feedback.customer_id is null (enforced by a CHECK).
--  * The ONLY way to create such a row is public.submit_anonymous_feedback(), callable
--    without logging in. There is still no RLS policy that lets anyone insert directly.
--  * Nothing identifying is stored: no IP address, no user agent, no email, no account.
--    Therefore anonymous feedback cannot be tracked by the sender and receives no replies.
--  * Staff see it everywhere with the customer name "Anonymous User" and no contact data.
--  * Abuse controls: an administrator switch (anonymous_feedback_enabled), a global hourly cap
--    (anonymous_max_per_hour), strict server-side validation, a duplicate guard and a honeypot.
--  * A logged-in customer who uses the anonymous form is NOT linked to the submission.
-- =====================================================================

alter table public.feedback alter column customer_id drop not null;
alter table public.feedback add column is_anonymous boolean not null default false;
alter table public.feedback add constraint feedback_anonymous_consistent
  check (is_anonymous = (customer_id is null));
alter table public.feedback_status_history alter column changed_by drop not null;

insert into public.system_settings (key, value, description) values
  ('anonymous_feedback_enabled', 'true'::jsonb, 'Set to false to switch the anonymous feedback form off.'),
  ('anonymous_max_per_hour', to_jsonb(30), 'Maximum anonymous submissions accepted per hour, across all visitors (flood protection).')
on conflict (key) do nothing;

-- notify_user: anonymous feedback has nobody to notify.
create or replace function public.notify_user(
  p_user_id uuid, p_feedback_id uuid, p_type text, p_message text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, feedback_id, type, message)
  select p_user_id, p_feedback_id, p_type, left(p_message, 200) where p_user_id is not null;
$$;

-- INSERT rules: anonymous rows are only accepted from submit_anonymous_feedback() (flag) or a trusted context.
create or replace function public.feedback_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_anonymous then
    if auth.uid() is not null and coalesce(current_setting('nyota.anon_submit', true), '') <> 'on' then
      raise exception 'Anonymous feedback must use the anonymous form.' using errcode = '42501';
    end if;
    new.customer_id := null;                     -- never linked to an account, even if the caller is logged in
    new.preferred_response_method := null;       -- nobody to reply to
  else
    if auth.uid() is not null then
      if not public.is_customer() then
        raise exception 'Only customers can submit feedback.' using errcode = '42501';
      end if;
      new.customer_id := auth.uid();
    end if;
    if new.customer_id is null or not exists (select 1 from public.profiles p
                   where p.id = new.customer_id and p.role = 'customer' and p.account_status = 'active') then
      raise exception 'Feedback must belong to an active customer.' using errcode = '23514';
    end if;
  end if;

  if new.served_by_employee_id is not null and not exists (
       select 1 from public.profiles p
       where p.id = new.served_by_employee_id and p.role = 'employee' and p.account_status = 'active') then
    raise exception 'The selected employee is not available.' using errcode = '23514';
  end if;

  if exists (select 1 from public.feedback f
             where f.is_anonymous = new.is_anonymous
               and f.customer_id is not distinct from new.customer_id
               and f.subject = new.subject and f.description = new.description
               and f.created_at > now() - interval '2 minutes') then
    raise exception 'This feedback was already submitted a moment ago.' using errcode = '23505';
  end if;

  new.id               := gen_random_uuid();
  new.reference_number := public.generate_reference_number();
  new.status           := 'Pending';
  new.created_at       := now();
  new.updated_at       := now();
  new.resolved_at      := null;
  new.resolved_by      := null;
  new.resolution_details := null;
  return new;
end $$;

create or replace function public.feedback_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.feedback_status_history (feedback_id, previous_status, new_status, changed_by, change_note)
  values (new.id, null, 'Pending', new.customer_id,
          case when new.is_anonymous then 'Submitted anonymously' else 'Submitted by customer' end);
  return new;
end $$;

create or replace function public.feedback_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.reference_number <> old.reference_number
     or new.customer_id is distinct from old.customer_id or new.is_anonymous <> old.is_anonymous
     or new.created_at <> old.created_at then
    raise exception 'Feedback identity fields cannot be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- submit_anonymous_feedback: callable by visitors who are not logged in.
-- Returns only the reference number (there is deliberately no way to look the case up again).
-- ---------------------------------------------------------------------
create or replace function public.submit_anonymous_feedback(
  p_type text, p_subject text, p_description text, p_rating integer,
  p_category text default null, p_product_name text default null,
  p_purchase_reference text default null,
  p_website text default null            -- honeypot: real visitors never fill this in
) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc    text := btrim(coalesce(p_description, ''));
  v_ref     text;
begin
  if public.current_app_role() in ('administrator', 'manager', 'employee') then
    raise exception 'Staff accounts cannot submit feedback.' using errcode = '42501';
  end if;
  if coalesce((select (s.value #>> '{}')::boolean from public.system_settings s where s.key = 'anonymous_feedback_enabled'), true) is not true then
    raise exception 'Anonymous feedback is currently switched off.' using errcode = '55000';
  end if;
  if nullif(btrim(coalesce(p_website, '')), '') is not null then
    return public.generate_reference_number();      -- bots: pretend it worked, store nothing
  end if;

  if p_type is null or p_type not in ('complaint', 'compliment', 'suggestion') then
    raise exception 'Choose a feedback type.' using errcode = '22023';
  end if;
  if char_length(v_subject) not between 3 and 150 then
    raise exception 'Subject must be 3 to 150 characters.' using errcode = '22023';
  end if;
  if char_length(v_desc) not between 10 and 4000 then
    raise exception 'Description must be 10 to 4000 characters.' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Rating must be from 1 to 5.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_category, '')) > 80 or char_length(coalesce(p_product_name, '')) > 150
     or char_length(coalesce(p_purchase_reference, '')) > 100 then
    raise exception 'One of the optional fields is too long.' using errcode = '22023';
  end if;

  if (select count(*) from public.feedback f
      where f.is_anonymous and f.created_at > now() - interval '1 hour')
     >= public.setting_int('anonymous_max_per_hour', 30) then
    raise exception 'Too many anonymous submissions right now. Please try again later.' using errcode = '54000';
  end if;

  perform set_config('nyota.anon_submit', 'on', true);   -- transaction-local; read by feedback_before_insert
  insert into public.feedback (is_anonymous, customer_id, feedback_type, subject, description, service_rating,
                               product_service_category, product_name, purchase_reference)
  values (true, null, p_type, v_subject, v_desc, p_rating::smallint,
          nullif(btrim(p_category), ''), nullif(btrim(p_product_name), ''), nullif(btrim(p_purchase_reference), ''))
  returning reference_number into v_ref;
  return v_ref;
end $$;

revoke execute on function public.submit_anonymous_feedback(text, text, text, integer, text, text, text, text) from public;
grant execute on function public.submit_anonymous_feedback(text, text, text, integer, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- The anonymous form needs the on/off switch and the (public) category list. Staff names are
-- deliberately NOT offered to anonymous visitors.
-- ---------------------------------------------------------------------
create or replace function public.anonymous_form_options() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((select (s.value #>> '{}')::boolean from public.system_settings s where s.key = 'anonymous_feedback_enabled'), true),
    'categories', coalesce((select s.value from public.system_settings s where s.key = 'feedback_categories'), '[]'::jsonb));
$$;
revoke execute on function public.anonymous_form_options() from public;
grant execute on function public.anonymous_form_options() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Staff listings: customer name becomes "Anonymous User"; no profile join is required
-- ---------------------------------------------------------------------
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
           case when f.is_anonymous then 'Anonymous User' else btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) end,
           a.assigned_employee_id,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           count(*) over ()
    from public.feedback f
    left join public.profiles c on c.id = f.customer_id
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
           or (f.is_anonymous and 'anonymous user' ilike v_pat)
           or (c.first_name || ' ' || coalesce(c.last_name, '')) ilike v_pat
           or c.email ilike v_pat)
    order by f.created_at desc, f.id
    limit v_limit offset v_offset;
end $$;


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
           case when f.is_anonymous then 'Anonymous User' else btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')) end,
           f.product_service_category, f.service_rating,
           nullif(btrim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
           f.resolved_at,
           case when f.resolved_at is not null then round((extract(epoch from (f.resolved_at - f.created_at)) / 3600)::numeric, 1) end
    from public.feedback f
    left join public.profiles c on c.id = f.customer_id
    left join public.feedback_assignments a on a.feedback_id = f.id and a.unassigned_at is null
    left join public.profiles e on e.id = a.assigned_employee_id
    where f.created_at >= b.t_from and f.created_at < b.t_to
    order by f.created_at, f.id
    limit 10000;
end $$;

