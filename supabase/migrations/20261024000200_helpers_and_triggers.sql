-- =====================================================================
-- Migration 2 of 5: authorization helpers, reference numbers, triggers
--
-- SECURITY NOTES
-- * Every SECURITY DEFINER function pins search_path to '' and uses fully
--   qualified names, so a caller cannot shadow objects.
-- * "Trusted context" means auth.uid() IS NULL: the SQL editor, migrations,
--   or the service-role key used by an Edge Function. A request carrying a
--   user's JWT always has a uid, so browser clients are never "trusted".
-- * Browser requests are made with the anon key; anon has no table access.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Authorization helpers (used by RLS policies and workflow functions)
-- They return NULL/false for inactive accounts, so deactivation takes
-- effect immediately even if the user's session token is still valid.
-- ---------------------------------------------------------------------
create or replace function public.current_app_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.account_status = 'active'
$$;

create or replace function public.is_administrator() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'administrator', false)
$$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'manager', false)
$$;

create or replace function public.is_employee() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'employee', false)
$$;

create or replace function public.is_customer() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = 'customer', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() in ('administrator', 'manager', 'employee'), false)
$$;

-- True when the caller is an active employee AND the case is currently assigned to them.
create or replace function public.is_assigned_to_me(p_feedback_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_employee() and exists (
    select 1 from public.feedback_assignments a
    where a.feedback_id = p_feedback_id
      and a.assigned_employee_id = auth.uid()
      and a.unassigned_at is null)
$$;

-- May the caller read this feedback record at all?
create or replace function public.can_view_feedback(p_feedback_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.current_app_role()
    when 'administrator' then true
    when 'manager'       then true
    when 'employee'      then public.is_assigned_to_me(p_feedback_id)
    when 'customer'      then exists (
      select 1 from public.feedback f where f.id = p_feedback_id and f.customer_id = auth.uid())
    else false
  end
$$;

-- ---------------------------------------------------------------------
-- Internal helpers (NOT callable by clients; see revokes at the bottom)
-- ---------------------------------------------------------------------
create or replace function public.log_audit(
  p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

create or replace function public.notify_user(
  p_user_id uuid, p_feedback_id uuid, p_type text, p_message text
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, feedback_id, type, message)
  values (p_user_id, p_feedback_id, p_type, left(p_message, 200));
$$;

-- Reference number: NYO-YYYYMMDD-XXXXXXXX (date in Nairobi time + 8 random hex chars).
-- The existence check must see ALL rows (definer), and the UNIQUE constraint on
-- feedback.reference_number is the final guard against a concurrent collision.
create or replace function public.generate_reference_number() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v text;
begin
  loop
    v := 'NYO-' || to_char(now() at time zone 'Africa/Nairobi', 'YYYYMMDD') || '-'
         || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.feedback where reference_number = v);
  end loop;
  return v;
end $$;

create or replace function public.setting_int(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select (s.value #>> '{}')::integer from public.system_settings s where s.key = p_key), p_default)
$$;

-- ---------------------------------------------------------------------
-- New Supabase Auth user -> profile. ALWAYS a customer.
-- Sign-up metadata is only used for names/phone, never for role, so a
-- crafted sign-up request cannot create a privileged account.
-- Staff accounts are promoted afterwards by an administrator / Edge Function.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first text := left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'first_name'), ''),
                                split_part(new.email, '@', 1)), 60);
  v_last  text := left(coalesce(btrim(new.raw_user_meta_data ->> 'last_name'), ''), 60);
  v_phone text := nullif(left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'phone', ''), '[^0-9+]', '', 'g'), 20), '');
begin
  if v_phone is not null and char_length(v_phone) < 7 then
    v_phone := null;
  end if;
  insert into public.profiles (id, first_name, last_name, email, phone, role, account_status)
  values (new.id, v_first, v_last, lower(new.email), v_phone, 'customer', 'active');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- profiles guard: who may change what
--  * Normal users may change only their own name/phone.
--  * Role, account_status and email changes need an administrator (or a trusted context).
--  * The last active administrator cannot be demoted or deactivated.
--  * Role and status changes are written to the audit log.
-- ---------------------------------------------------------------------
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_trusted boolean := auth.uid() is null or public.is_administrator();
begin
  if new.id <> old.id or new.created_at <> old.created_at then
    raise exception 'Immutable profile fields cannot be changed.' using errcode = '42501';
  end if;

  if not v_trusted and (new.role <> old.role
                        or new.account_status <> old.account_status
                        or lower(new.email) <> lower(old.email)) then
    raise exception 'You are not allowed to change role, status or email.' using errcode = '42501';
  end if;

  if old.role = 'administrator' and old.account_status = 'active'
     and (new.role <> 'administrator' or new.account_status <> 'active') then
    if not exists (select 1 from public.profiles p
                   where p.role = 'administrator' and p.account_status = 'active' and p.id <> old.id) then
      raise exception 'The only active administrator cannot be demoted or deactivated.' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();

  if new.role <> old.role then
    perform public.log_audit('role_changed', 'profile', old.id::text,
      jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.account_status <> old.account_status then
    perform public.log_audit('account_status_changed', 'profile', old.id::text,
      jsonb_build_object('from', old.account_status, 'to', new.account_status));
  end if;
  return new;
end $$;

create trigger profiles_guard_trg
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- Prevent deleting the last active administrator profile (e.g. by deleting the auth user).
create or replace function public.profiles_protect_last_admin_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'administrator' and old.account_status = 'active'
     and not exists (select 1 from public.profiles p
                     where p.role = 'administrator' and p.account_status = 'active' and p.id <> old.id) then
    raise exception 'The only active administrator cannot be deleted.' using errcode = '23514';
  end if;
  return old;
end $$;

create trigger profiles_protect_last_admin_delete_trg
  before delete on public.profiles
  for each row execute function public.profiles_protect_last_admin_delete();

-- ---------------------------------------------------------------------
-- feedback: server-side rules on INSERT
--  * customer_id is forced to the caller; status is forced to Pending
--  * reference number is generated here, never by the browser
--  * the "served by" employee must be an active employee
--  * identical resubmission within 2 minutes is rejected (double clicks)
-- ---------------------------------------------------------------------
create or replace function public.feedback_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    if not public.is_customer() then
      raise exception 'Only customers can submit feedback.' using errcode = '42501';
    end if;
    new.customer_id := auth.uid();
  end if;

  if not exists (select 1 from public.profiles p
                 where p.id = new.customer_id and p.role = 'customer' and p.account_status = 'active') then
    raise exception 'Feedback must belong to an active customer.' using errcode = '23514';
  end if;

  if new.served_by_employee_id is not null and not exists (
       select 1 from public.profiles p
       where p.id = new.served_by_employee_id and p.role = 'employee' and p.account_status = 'active') then
    raise exception 'The selected employee is not available.' using errcode = '23514';
  end if;

  if exists (select 1 from public.feedback f
             where f.customer_id = new.customer_id
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

create trigger feedback_before_insert_trg
  before insert on public.feedback
  for each row execute function public.feedback_before_insert();

-- First history row: (nothing) -> Pending
create or replace function public.feedback_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.feedback_status_history (feedback_id, previous_status, new_status, changed_by, change_note)
  values (new.id, null, 'Pending', new.customer_id, 'Submitted by customer');
  return new;
end $$;

create trigger feedback_after_insert_trg
  after insert on public.feedback
  for each row execute function public.feedback_after_insert();

-- Identity fields can never change after creation, whoever is updating.
create or replace function public.feedback_before_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.reference_number <> old.reference_number
     or new.customer_id <> old.customer_id or new.created_at <> old.created_at then
    raise exception 'Feedback identity fields cannot be changed.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger feedback_before_update_trg
  before update on public.feedback
  for each row execute function public.feedback_before_update();

-- ---------------------------------------------------------------------
-- Attachments: enforce limits from system_settings
-- ---------------------------------------------------------------------
create or replace function public.attachments_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_max_bytes integer := public.setting_int('attachment_max_bytes', 5242880);
  v_max_count integer := public.setting_int('attachments_max_per_feedback', 3);
  v_allowed   jsonb   := coalesce((select s.value from public.system_settings s
                                   where s.key = 'attachment_allowed_mime_types'), '[]'::jsonb);
begin
  if new.size_bytes > v_max_bytes then
    raise exception 'Attachment is too large.' using errcode = '23514';
  end if;
  if not (v_allowed ? new.mime_type) then
    raise exception 'This file type is not allowed.' using errcode = '23514';
  end if;
  if (select count(*) from public.feedback_attachments a where a.feedback_id = new.feedback_id) >= v_max_count then
    raise exception 'Too many attachments for this feedback.' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger attachments_before_insert_trg
  before insert on public.feedback_attachments
  for each row execute function public.attachments_before_insert();

-- ---------------------------------------------------------------------
-- notifications: users may only flip is_read on their own rows
-- ---------------------------------------------------------------------
create or replace function public.notifications_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (
       new.id <> old.id or new.user_id <> old.user_id or new.feedback_id is distinct from old.feedback_id
       or new.type <> old.type or new.message <> old.message or new.created_at <> old.created_at) then
    raise exception 'Only the read flag can be changed.' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger notifications_guard_trg
  before update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------
-- system_settings: stamp who changed what
-- ---------------------------------------------------------------------
create or replace function public.system_settings_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.key <> old.key then
    raise exception 'Setting keys cannot be renamed.' using errcode = '42501';
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger system_settings_guard_trg
  before update on public.system_settings
  for each row execute function public.system_settings_guard();

create or replace function public.system_settings_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.log_audit('setting_changed', 'system_setting', new.key,
    jsonb_build_object('key', new.key));
  return new;
end $$;

create trigger system_settings_audit_trg
  after update on public.system_settings
  for each row execute function public.system_settings_audit();

-- ---------------------------------------------------------------------
-- Function privileges
-- Postgres grants EXECUTE to PUBLIC by default, so take it away first.
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

-- Helpers used inside RLS policies must be callable by signed-in users.
grant execute on function
  public.current_app_role(), public.is_administrator(), public.is_manager(),
  public.is_employee(), public.is_customer(), public.is_staff(),
  public.is_assigned_to_me(uuid), public.can_view_feedback(uuid)
  to authenticated;
-- log_audit, notify_user, generate_reference_number, setting_int and all trigger
-- functions stay un-callable by clients; triggers and definer functions run as owner.
