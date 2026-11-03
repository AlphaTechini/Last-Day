-- Workflow engine additions.

-- Pairs an HR user said "Not her" about. The matcher and resolver never re-propose them.
CREATE TABLE IF NOT EXISTS match_rejections (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  decided_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, employee_id)
);
CREATE INDEX IF NOT EXISTS match_rejections_employee ON match_rejections(employee_id);

-- How the structured output was requested ('json_schema' | 'json_object') and whether this was the escalation call.
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS mode text;
ALTER TABLE ai_calls ADD COLUMN IF NOT EXISTS escalated boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS ai_calls_run ON ai_calls(run_id);
CREATE INDEX IF NOT EXISTS ai_calls_account ON ai_calls(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS run_items_status ON run_items(status);
CREATE INDEX IF NOT EXISTS accounts_connection ON accounts(connection_id);
