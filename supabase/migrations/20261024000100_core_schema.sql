-- =====================================================================
-- Migration 1 of 5: core tables, constraints, indexes, default settings
-- Nyota Electronics Centralised Web-Based Feedback Management System
--
-- Roles (profiles.role): customer | administrator | manager | employee
-- Feedback status       : Pending -> In Progress -> Resolved
-- Nothing in this file grants access. See migration 4 (RLS) for that.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles: one row per Supabase Auth user (customers AND staff).
-- The application role lives here, never in user-editable auth metadata.
-- ---------------------------------------------------------------------
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  first_name     text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name      text not null default '' check (char_length(last_name) <= 60),
  email          text not null check (char_length(email) between 3 and 254),
  phone          text check (phone is null or char_length(phone) between 7 and 20),
  role           text not null default 'customer'
                 check (role in ('customer', 'administrator', 'manager', 'employee')),
  account_status text not null default 'active'
                 check (account_status in ('active', 'inactive')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index profiles_email_uidx       on public.profiles (lower(email));
create index        profiles_role_status_idx  on public.profiles (role, account_status);
comment on table public.profiles is
  'One row per login. role/account_status are the authority for every permission check.';

-- ---------------------------------------------------------------------
-- feedback: a customer submission and its current state
-- ---------------------------------------------------------------------
create table public.feedback (
  id                       uuid primary key default gen_random_uuid(),
  reference_number         text not null unique,
  customer_id              uuid not null references public.profiles (id),
  feedback_type            text not null check (feedback_type in ('complaint', 'compliment', 'suggestion')),
  subject                  text not null check (char_length(btrim(subject)) between 3 and 150),
  description              text not null check (char_length(btrim(description)) between 10 and 4000),
  service_rating           smallint not null check (service_rating between 1 and 5),
  served_by_employee_id    uuid references public.profiles (id),   -- who served the customer (optional)
  product_service_category text check (char_length(product_service_category) <= 80),
  product_name             text check (char_length(product_name) <= 150),
  purchase_reference       text check (char_length(purchase_reference) <= 100),
  preferred_response_method text check (preferred_response_method in ('email', 'phone', 'sms', 'whatsapp')),
  status                   text not null default 'Pending'
                           check (status in ('Pending', 'In Progress', 'Resolved')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  resolved_at              timestamptz,
  resolved_by              uuid references public.profiles (id),
  resolution_details       text,   -- customer-visible resolution summary
  -- A case is Resolved exactly when all three resolution fields are filled in.
  constraint feedback_resolution_consistent check (
    (status = 'Resolved'
       and resolved_at is not null and resolved_by is not null
       and resolution_details is not null and char_length(btrim(resolution_details)) >= 10)
    or
    (status <> 'Resolved'
       and resolved_at is null and resolved_by is null and resolution_details is null)
  )
);
create index feedback_customer_idx     on public.feedback (customer_id, created_at desc);
create index feedback_status_idx       on public.feedback (status, created_at desc);
create index feedback_type_idx         on public.feedback (feedback_type);
create index feedback_created_idx      on public.feedback (created_at desc);
create index feedback_served_by_idx    on public.feedback (served_by_employee_id);
comment on table public.feedback is
  'Customer feedback. Customers may only INSERT; every later change goes through the workflow functions.';
comment on column public.feedback.served_by_employee_id is
  'Employee the customer says served them. Distinct from the employee later assigned to handle the case.';
comment on column public.feedback.resolution_details is
  'Customer-visible resolution summary. Internal handling notes live in feedback_responses (visibility = internal).';

-- ---------------------------------------------------------------------
-- feedback_assignments: full assignment history
-- ---------------------------------------------------------------------
create table public.feedback_assignments (
  id                     uuid primary key default gen_random_uuid(),
  feedback_id            uuid not null references public.feedback (id) on delete cascade,
  assigned_employee_id   uuid not null references public.profiles (id),
  assigned_by_manager_id uuid not null references public.profiles (id),
  assigned_at            timestamptz not null default now(),
  unassigned_at          timestamptz,
  assignment_note        text check (char_length(assignment_note) <= 500),
  constraint assignment_dates_ordered check (unassigned_at is null or unassigned_at >= assigned_at)
);
-- At most ONE current assignment (unassigned_at IS NULL) per feedback record.
create unique index feedback_assignments_one_current_uidx
  on public.feedback_assignments (feedback_id) where unassigned_at is null;
create index feedback_assignments_employee_idx
  on public.feedback_assignments (assigned_employee_id) where unassigned_at is null;
create index feedback_assignments_feedback_idx
  on public.feedback_assignments (feedback_id, assigned_at desc);
comment on table public.feedback_assignments is
  'Assignment history. The row with unassigned_at IS NULL is the current assignee. Rows are never overwritten.';

-- ---------------------------------------------------------------------
-- feedback_responses: customer-visible replies and internal notes
-- ---------------------------------------------------------------------
create table public.feedback_responses (
  id            uuid primary key default gen_random_uuid(),
  feedback_id   uuid not null references public.feedback (id) on delete cascade,
  author_id     uuid not null references public.profiles (id),
  response_text text not null check (char_length(btrim(response_text)) between 1 and 4000),
  visibility    text not null check (visibility in ('customer', 'internal')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index feedback_responses_feedback_idx on public.feedback_responses (feedback_id, created_at);
comment on table public.feedback_responses is
  'visibility = customer is shown to the customer; visibility = internal is staff-only. Enforced by RLS.';

-- ---------------------------------------------------------------------
-- feedback_status_history: every status transition
-- ---------------------------------------------------------------------
create table public.feedback_status_history (
  id              uuid primary key default gen_random_uuid(),
  feedback_id     uuid not null references public.feedback (id) on delete cascade,
  previous_status text check (previous_status in ('Pending', 'In Progress', 'Resolved')),
  new_status      text not null check (new_status in ('Pending', 'In Progress', 'Resolved')),
  changed_by      uuid not null references public.profiles (id),
  change_note     text check (char_length(change_note) <= 500),
  changed_at      timestamptz not null default now()
);
create index feedback_status_history_idx on public.feedback_status_history (feedback_id, changed_at);
comment on table public.feedback_status_history is
  'Append-only. Written by triggers and workflow functions, never directly by clients.';

-- ---------------------------------------------------------------------
-- audit_logs: significant actions (admin-readable only)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                 -- null = trusted server/admin context (dashboard, migration, Edge Function)
  action      text not null,
  entity_type text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,   -- safe metadata only: no passwords, tokens or message bodies
  created_at  timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx   on public.audit_logs (actor_id, created_at desc);
create index audit_logs_entity_idx  on public.audit_logs (entity_type, entity_id);
comment on table public.audit_logs is
  'Append-only audit trail. Written by SECURITY DEFINER code only; readable by administrators only.';

-- ---------------------------------------------------------------------
-- feedback_attachments: metadata for files in the private storage bucket
-- ---------------------------------------------------------------------
create table public.feedback_attachments (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.feedback (id) on delete cascade,
  uploaded_by  uuid not null references public.profiles (id),
  storage_path text not null unique,   -- <customer_id>/<feedback_id>/<uuid>.<ext>
  file_name    text not null check (char_length(file_name) between 1 and 200),
  mime_type    text not null,
  size_bytes   integer not null check (size_bytes > 0),
  created_at   timestamptz not null default now()
);
create index feedback_attachments_feedback_idx on public.feedback_attachments (feedback_id);
comment on table public.feedback_attachments is
  'Limits (size, types, count) come from system_settings and are enforced by a trigger.';

-- ---------------------------------------------------------------------
-- notifications: simple in-app notifications (no private case details)
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  feedback_id uuid references public.feedback (id) on delete cascade,
  type        text not null check (type in ('assignment', 'reassignment', 'status_change', 'response', 'resolution')),
  message     text not null check (char_length(message) <= 200),
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, is_read, created_at desc);
comment on table public.notifications is
  'In-app only. Messages contain the reference number, never case content. No email is implied.';

-- ---------------------------------------------------------------------
-- system_settings: configurable limits and lists
-- ---------------------------------------------------------------------
create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
comment on table public.system_settings is
  'Administrator-managed configuration. Readable by signed-in users; contains no secrets.';

insert into public.system_settings (key, value, description) values
  ('attachment_max_bytes',          to_jsonb(5242880),
   'Maximum attachment size in bytes (5 MB). Also set on the storage bucket; keep both in step.'),
  ('attachment_allowed_mime_types', '["image/jpeg","image/png","application/pdf"]'::jsonb,
   'Allowed attachment MIME types. Also set on the storage bucket; keep both in step.'),
  ('attachments_max_per_feedback',  to_jsonb(3),
   'Maximum attachments per feedback record.'),
  ('min_resolution_details_length', to_jsonb(10),
   'Minimum characters of resolution details required to mark a case Resolved.'),
  ('feedback_categories',
   '["Electronics","Home Appliances","Phones & Accessories","Customer Service","Delivery","Other"]'::jsonb,
   'Options shown in the optional product/service category dropdown.');
