-- Last Day initial schema. Applied by scripts/migrate.ts in filename order.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  work_email text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  role text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  manager_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','offboarding','offboarded')),
  start_date date,
  end_date date,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','hr','manager','judge')),
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id text PRIMARY KEY, -- sha256 of the cookie token
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system text NOT NULL UNIQUE CHECK (system IN ('keycloak','mattermost','github','vultr')),
  config_json jsonb NOT NULL DEFAULT '{}',
  credential_ciphertext text, -- base64(iv|tag|ciphertext) AES-256-GCM of a JSON object
  status text NOT NULL DEFAULT 'untested' CHECK (status IN ('healthy','error','untested')),
  last_error text,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  system text NOT NULL,
  external_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('user','service','invitation','apikey','instance')),
  username text,
  display_name text,
  emails text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz,
  last_active_at timestamptz,
  parent_external_id text, -- e.g. the Vultr user that owns an api key
  raw_json jsonb NOT NULL DEFAULT '{}',
  flag text NOT NULL DEFAULT 'unlinked' CHECK (flag IN ('unlinked','service','flagged')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  gone_at timestamptz, -- not returned by the last sweep
  UNIQUE (system, kind, external_id)
);

CREATE TABLE account_links (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  link_method text NOT NULL, -- rule:manual | rule:sso_subject | rule:work_email | rule:username | ai | manual
  confidence real,
  evidence_json jsonb NOT NULL DEFAULT '[]',
  confirmed boolean NOT NULL DEFAULT false, -- AI links become confirmed after HR "yes"
  decided_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_links_employee ON account_links(employee_id);

-- AI suggestions for accounts that have no link (shown in Unknown owners and as probable matches)
CREATE TABLE ai_suggestions (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  confidence real NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '[]',
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, employee_id)
);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  started_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'review' CHECK (status IN ('review','executing','verified','partial','failed','regressed')),
  verified_at timestamptz,
  ai_cost_usd numeric(12,6) NOT NULL DEFAULT 0
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  approver_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('hr_revoke','manager_destroy')),
  item_ids uuid[] NOT NULL,
  action_list jsonb NOT NULL DEFAULT '[]', -- exact actions approved
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  match_kind text NOT NULL CHECK (match_kind IN ('exact','probable','server')),
  link_method text,
  confidence real,
  evidence_json jsonb NOT NULL DEFAULT '[]',
  steps_json jsonb NOT NULL DEFAULT '[]', -- ActionStep[]
  approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  destroy_approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
  status text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  verified_state text,
  verified_at timestamptz,
  snapshot_id text,
  snapshot_cost_usd_month numeric(10,4),
  still_billing_usd_month numeric(10,4),
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (run_id, account_id)
);

CREATE TABLE rechecks (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','clean','regressed')),
  result_json jsonb,
  fired_at timestamptz
);

CREATE TABLE ai_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  requested_model text NOT NULL,
  returned_model text,
  prompt_tokens int NOT NULL DEFAULT 0,
  completion_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric(12,8) NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  ok boolean NOT NULL DEFAULT true,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  actor_name text NOT NULL DEFAULT 'system',
  run_id uuid REFERENCES runs(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  system text,
  kind text NOT NULL,
  summary text NOT NULL,
  detail_json jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_at ON audit_log(at DESC);
CREATE INDEX audit_log_run ON audit_log(run_id);

CREATE TABLE settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  recheck_delay_seconds int NOT NULL DEFAULT 86400,
  ai_confidence_threshold real NOT NULL DEFAULT 0.8,
  default_model text NOT NULL DEFAULT 'glm-5.3-flash',
  escalation_model text NOT NULL DEFAULT 'glm-5.2',
  last_sweep_at timestamptz
);
INSERT INTO settings (id) VALUES (1);
