-- Document Metadata
-- Doc ID: schema.d1.v0
-- Version: 1.0.0
-- Status: authoritative
-- Kind: database-schema
-- Last Updated: 2026-04-02
-- Authority: This is the current source of truth for the v0.1 D1 schema shape.
-- Supersedes: none

-- Agentic Search v0.1 schema

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  query_raw TEXT NOT NULL,
  query_normalized TEXT NOT NULL,
  phase TEXT NOT NULL,
  target_results INTEGER NOT NULL,
  entity_type TEXT NOT NULL,
  status_summary TEXT NOT NULL,
  latest_run_id TEXT
);

CREATE TABLE IF NOT EXISTS query_plans (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  search_budget INTEGER NOT NULL,
  fetch_budget INTEGER NOT NULL,
  verification_budget INTEGER NOT NULL,
  notes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS criteria (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  color TEXT,
  field_hint TEXT,
  operator_hint TEXT,
  value_hint TEXT,
  rank_weight REAL,
  order_index INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS columns_spec (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,
  value_type TEXT NOT NULL,
  preferred_sources_json TEXT NOT NULL,
  requires_verification INTEGER NOT NULL,
  allow_inference INTEGER NOT NULL,
  null_policy TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS planned_search_queries (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  text TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES query_plans(id)
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  error_message TEXT,
  progress_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  canceled_at INTEGER,
  FOREIGN KEY (thread_id) REFERENCES threads(id)
);

CREATE TABLE IF NOT EXISTS stage_markers (
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, stage),
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS rows_result (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  status TEXT NOT NULL,
  processing_state TEXT NOT NULL,
  score REAL NOT NULL,
  rank INTEGER,
  source_count INTEGER NOT NULL,
  duplicate_of_row_id TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS result_cells (
  id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL,
  column_key TEXT NOT NULL,
  value_text TEXT,
  value_json TEXT,
  state TEXT NOT NULL,
  confidence REAL NOT NULL,
  reason_code TEXT,
  primary_evidence_id TEXT,
  FOREIGN KEY (row_id) REFERENCES rows_result(id)
);

CREATE TABLE IF NOT EXISTS criterion_evaluations (
  id TEXT PRIMARY KEY,
  row_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  verdict TEXT NOT NULL,
  summary TEXT NOT NULL,
  confidence REAL NOT NULL,
  primary_evidence_id TEXT,
  FOREIGN KEY (row_id) REFERENCES rows_result(id),
  FOREIGN KEY (criterion_id) REFERENCES criteria(id)
);

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  url TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  fetch_status INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  trust_tier TEXT NOT NULL,
  cache_key TEXT,
  blob_ref TEXT,
  snippet TEXT NOT NULL,
  favicon TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  locator_json TEXT NOT NULL,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  confidence REAL NOT NULL,
  FOREIGN KEY (source_document_id) REFERENCES source_documents(id)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  provider_name TEXT NOT NULL,
  operation TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  token_in INTEGER NOT NULL,
  token_out INTEGER NOT NULL,
  estimated_cost_usd REAL NOT NULL,
  cache_hit INTEGER NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  format TEXT NOT NULL,
  download_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE INDEX IF NOT EXISTS idx_runs_thread_started ON runs(thread_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_rows_run_status_rank ON rows_result(run_id, status, rank);
CREATE INDEX IF NOT EXISTS idx_cells_row_column ON result_cells(row_id, column_key);
CREATE INDEX IF NOT EXISTS idx_eval_row_criterion ON criterion_evaluations(row_id, criterion_id);
CREATE INDEX IF NOT EXISTS idx_source_run_url ON source_documents(run_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_activity_run_created ON activity_events(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_run_timestamp ON usage_ledger(run_id, timestamp);
