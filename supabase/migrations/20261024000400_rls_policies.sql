-- =====================================================================
-- Migration 4 of 5: Row Level Security and table privileges
--
-- Principle: default deny. The browser uses the anon key, then the signed-in
-- user's JWT (role "authenticated"). Anonymous visitors get NO table access.
-- Signed-in users get exactly what the policies below allow.
--
-- Permission summary (matches the master prompt, section 4.5):
--   customer      : own profile, own feedback (insert + read), customer-visible responses
--   employee      : only feedback CURRENTLY assigned to them
--   manager       : all feedback, assign via assign_feedback(); NO reports
--   administrator : all feedback + staff/role management + audit logs + settings
--
-- NOTE ON REPORTS: managers can read feedback rows (they need them to assign
-- work), so "no reports" is enforced by (a) no report functions or pages being
-- available to them and (b) the admin-only report functions added in
-- Milestone 9. Audit logs and settings writes are admin-only at row level.
-- =====================================================================

-- Start from nothing, then grant the minimum.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on
  public.profiles, public.feedback, public.feedback_assignments, public.feedback_responses,
  public.feedback_status_history, public.audit_logs, public.feedback_attachments,
  public.notifications, public.system_settings
  to authenticated;
grant insert on public.feedback, public.feedback_attachments to authenticated;
grant update on public.profiles, public.notifications, public.system_settings to authenticated;

alter table public.profiles                enable row level security;
alter table public.feedback                enable row level security;
alter table public.feedback_assignments    enable row level security;
alter table public.feedback_responses      enable row level security;
alter table public.feedback_status_history enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.feedback_attachments    enable row level security;
alter table public.notifications           enable row level security;
alter table public.system_settings         enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_administrator());

-- Managers see customers and employees (to review cases and assign work), not other managers/admins.
create policy profiles_select_manager on public.profiles
  for select to authenticated
  using (public.is_manager() and role in ('customer', 'employee'));

-- Employees see only the customers behind cases currently assigned to them.
create policy profiles_select_employee on public.profiles
  for select to authenticated
  using (public.is_employee() and exists (
    select 1 from public.feedback f
    join public.feedback_assignments a on a.feedback_id = f.id
    where f.customer_id = profiles.id
      and a.assigned_employee_id = auth.uid() and a.unassigned_at is null));

-- Own name/phone only (the profiles_guard trigger blocks role/status/email changes).
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.current_app_role() is not null)
  with check (id = auth.uid());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());

-- ---------------------------------------------------------------------
-- feedback  (no UPDATE or DELETE policy: changes go through workflow functions)
-- ---------------------------------------------------------------------
create policy feedback_select_customer on public.feedback
  for select to authenticated
  using (public.is_customer() and customer_id = auth.uid());

create policy feedback_select_oversight on public.feedback
  for select to authenticated
  using (public.is_administrator() or public.is_manager());

create policy feedback_select_employee on public.feedback
  for select to authenticated
  using (public.is_employee() and public.is_assigned_to_me(id));

-- Customers insert for themselves only; the trigger forces status, reference, customer_id.
create policy feedback_insert_customer on public.feedback
  for insert to authenticated
  with check (public.is_customer() and customer_id = auth.uid());

-- ---------------------------------------------------------------------
-- feedback_assignments (read-only for clients; written by assign_feedback)
-- ---------------------------------------------------------------------
create policy assignments_select_oversight on public.feedback_assignments
  for select to authenticated
  using (public.is_administrator() or public.is_manager());

create policy assignments_select_employee on public.feedback_assignments
  for select to authenticated
  using (public.is_employee() and assigned_employee_id = auth.uid());

-- ---------------------------------------------------------------------
-- feedback_responses (read-only for clients; written by workflow functions)
-- ---------------------------------------------------------------------
create policy responses_select_oversight on public.feedback_responses
  for select to authenticated
  using (public.is_administrator() or public.is_manager());

create policy responses_select_employee on public.feedback_responses
  for select to authenticated
  using (public.is_employee() and public.is_assigned_to_me(feedback_id));

-- Customers: customer-visible responses on their own feedback ONLY. Internal notes never.
create policy responses_select_customer on public.feedback_responses
  for select to authenticated
  using (public.is_customer() and visibility = 'customer' and exists (
    select 1 from public.feedback f where f.id = feedback_id and f.customer_id = auth.uid()));

-- ---------------------------------------------------------------------
-- feedback_status_history (staff only)
-- ---------------------------------------------------------------------
create policy status_history_select_oversight on public.feedback_status_history
  for select to authenticated
  using (public.is_administrator() or public.is_manager());

create policy status_history_select_employee on public.feedback_status_history
  for select to authenticated
  using (public.is_employee() and public.is_assigned_to_me(feedback_id));

-- ---------------------------------------------------------------------
-- audit_logs (administrator only)
-- ---------------------------------------------------------------------
create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_administrator());

-- ---------------------------------------------------------------------
-- feedback_attachments
-- ---------------------------------------------------------------------
create policy attachments_select_oversight on public.feedback_attachments
  for select to authenticated
  using (public.is_administrator() or public.is_manager());

create policy attachments_select_employee on public.feedback_attachments
  for select to authenticated
  using (public.is_employee() and public.is_assigned_to_me(feedback_id));

create policy attachments_select_customer on public.feedback_attachments
  for select to authenticated
  using (public.is_customer() and exists (
    select 1 from public.feedback f where f.id = feedback_id and f.customer_id = auth.uid()));

-- Customers register metadata for files they uploaded to their own folder for their own feedback.
create policy attachments_insert_customer on public.feedback_attachments
  for insert to authenticated
  with check (
    public.is_customer()
    and uploaded_by = auth.uid()
    and exists (select 1 from public.feedback f where f.id = feedback_id and f.customer_id = auth.uid())
    and storage_path like auth.uid()::text || '/' || feedback_id::text || '/%'
  );

-- ---------------------------------------------------------------------
-- notifications (own only; the guard trigger allows changing is_read only)
-- ---------------------------------------------------------------------
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.current_app_role() is not null);

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid() and public.current_app_role() is not null)
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- system_settings (read: any signed-in user; write: administrator)
-- ---------------------------------------------------------------------
create policy settings_select_all on public.system_settings
  for select to authenticated
  using (public.current_app_role() is not null);

create policy settings_update_admin on public.system_settings
  for update to authenticated
  using (public.is_administrator())
  with check (public.is_administrator());
