"""SQLite 저장소. 제출용 DBML(PostgreSQL 논리 설계)과 같은 테이블·제약을 따른다."""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL CHECK (length(nickname) BETWEEN 2 AND 20),
  license_type TEXT NOT NULL CHECK (license_type IN ('CLASS1_ORDINARY','CLASS2_ORDINARY')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS official_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  version TEXT NOT NULL,
  effective_from TEXT,
  retrieved_at TEXT NOT NULL,
  reuse_terms TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('PENDING','SELF_REVIEWED','APPROVED','REJECTED')),
  UNIQUE (url, version)
);
CREATE TABLE IF NOT EXISTS source_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES official_sources(id),
  locator TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE (source_id, locator)
);
CREATE TABLE IF NOT EXISTS guide_steps (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES official_sources(id),
  step_order INTEGER NOT NULL CHECK (step_order > 0),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  UNIQUE (source_id, step_order)
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('WRITTEN','DRIVING')),
  name_ko TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES official_sources(id),
  chunk_id TEXT NOT NULL REFERENCES source_chunks(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  code TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('OFFICIAL','PRACTICE','AI_GENERATED_PRACTICE')),
  license_scope TEXT NOT NULL CHECK (license_scope IN ('ALL','CLASS1_ORDINARY','CLASS2_ORDINARY')),
  prompt TEXT NOT NULL,
  media_url TEXT,
  points INTEGER NOT NULL CHECK (points > 0),
  required_selections INTEGER NOT NULL CHECK (required_selections BETWEEN 1 AND 2),
  explanation TEXT NOT NULL,
  review_status TEXT NOT NULL CHECK (review_status IN ('PENDING','SELF_REVIEWED','APPROVED','REJECTED')),
  UNIQUE (code, version)
);
CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 5),
  content TEXT NOT NULL,
  is_correct INTEGER NOT NULL CHECK (is_correct IN (0,1)),
  UNIQUE (question_id, position)
);
CREATE TABLE IF NOT EXISTS written_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  license_type TEXT NOT NULL CHECK (license_type IN ('CLASS1_ORDINARY','CLASS2_ORDINARY')),
  mode TEXT NOT NULL CHECK (mode IN ('PRACTICE')),
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','SUBMITTED','ABORTED')),
  question_count INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 40),
  max_score INTEGER NOT NULL CHECK (max_score > 0),
  started_at TEXT NOT NULL,
  submitted_at TEXT,
  score INTEGER,
  correct_count INTEGER,
  CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL AND score IS NOT NULL AND correct_count IS NOT NULL)),
  CHECK (score IS NULL OR score BETWEEN 0 AND max_score),
  CHECK (correct_count IS NULL OR correct_count BETWEEN 0 AND question_count)
);
CREATE INDEX IF NOT EXISTS ix_written_attempts_user ON written_attempts(user_id, started_at);
CREATE TABLE IF NOT EXISTS attempt_questions (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES written_attempts(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  position INTEGER NOT NULL CHECK (position > 0),
  UNIQUE (attempt_id, position),
  UNIQUE (attempt_id, question_id)
);
CREATE TABLE IF NOT EXISTS written_answers (
  id TEXT PRIMARY KEY,
  attempt_question_id TEXT NOT NULL UNIQUE REFERENCES attempt_questions(id),
  is_correct INTEGER CHECK (is_correct IS NULL OR is_correct IN (0,1)),
  earned_points INTEGER CHECK (earned_points IS NULL OR earned_points >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS answer_selections (
  answer_id TEXT NOT NULL REFERENCES written_answers(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES question_options(id),
  PRIMARY KEY (answer_id, option_id)
);
CREATE TRIGGER IF NOT EXISTS trg_selection_same_question
BEFORE INSERT ON answer_selections
WHEN (SELECT qo.question_id FROM question_options qo WHERE qo.id = NEW.option_id)
  IS NOT (SELECT aq.question_id FROM written_answers wa JOIN attempt_questions aq ON aq.id = wa.attempt_question_id WHERE wa.id = NEW.answer_id)
BEGIN
  SELECT RAISE(ABORT, 'option does not belong to the attempt question');
END;
CREATE TABLE IF NOT EXISTS official_scoring_rules (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES official_sources(id),
  category_id TEXT REFERENCES categories(id),
  code TEXT NOT NULL,
  name_ko TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DEDUCTION','DISQUALIFICATION')),
  deduction_points INTEGER,
  support TEXT NOT NULL CHECK (support IN ('A','B','C')),
  method TEXT NOT NULL,
  limitations TEXT NOT NULL,
  locator TEXT NOT NULL,
  auto_scoring_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_scoring_enabled IN (0,1)),
  UNIQUE (source_id, code),
  CHECK ((kind = 'DEDUCTION' AND deduction_points > 0) OR (kind = 'DISQUALIFICATION' AND deduction_points IS NULL)),
  CHECK (auto_scoring_enabled = 0 OR support = 'A')
);
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('FUNCTION','ROAD')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  sim_version TEXT NOT NULL,
  definition TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  UNIQUE (code, version)
);
CREATE TABLE IF NOT EXISTS scenario_rules (
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  rule_id TEXT NOT NULL REFERENCES official_scoring_rules(id),
  event_code TEXT NOT NULL,
  PRIMARY KEY (scenario_id, rule_id, event_code)
);
CREATE TABLE IF NOT EXISTS training_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  scenario_id TEXT NOT NULL REFERENCES scenarios(id),
  input_mode TEXT NOT NULL CHECK (input_mode IN ('KEYBOARD','SENSOR')),
  calibration_snapshot TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING','COMPLETED','DISQUALIFIED','INCOMPLETE','ABORTED')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('PENDING','VERIFIED','MISMATCH','NOT_APPLICABLE')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  total_ticks INTEGER CHECK (total_ticks IS NULL OR total_ticks >= 0),
  input_log TEXT,
  input_hash TEXT,
  pause_count INTEGER NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  end_reason TEXT,
  distance_m REAL,
  max_speed_kmh REAL,
  reference_deduction INTEGER CHECK (reference_deduction IS NULL OR reference_deduction >= 0),
  CHECK ((input_mode = 'SENSOR') = (calibration_snapshot IS NOT NULL)),
  CHECK ((status = 'RUNNING') = (ended_at IS NULL))
);
CREATE INDEX IF NOT EXISTS ix_training_sessions_user ON training_sessions(user_id, started_at);
CREATE TABLE IF NOT EXISTS driving_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES training_sessions(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  event_code TEXT NOT NULL,
  rule_id TEXT REFERENCES official_scoring_rules(id),
  category_id TEXT NOT NULL REFERENCES categories(id),
  tick INTEGER NOT NULL CHECK (tick >= 0),
  s_m REAL NOT NULL,
  speed_kmh REAL NOT NULL CHECK (speed_kmh >= 0),
  is_terminal INTEGER NOT NULL CHECK (is_terminal IN (0,1)),
  evidence TEXT NOT NULL,
  UNIQUE (session_id, seq)
);
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('EXPLANATION','REPORT')),
  answer_id TEXT REFERENCES written_answers(id),
  status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FALLBACK','INSUFFICIENT_DATA','FAILED')),
  evidence_snapshot TEXT NOT NULL,
  result TEXT,
  model_version TEXT,
  prompt_version TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  CHECK ((kind = 'EXPLANATION') = (answer_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_ai_jobs_user ON ai_jobs(user_id, created_at);
CREATE TABLE IF NOT EXISTS ai_citations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL REFERENCES source_chunks(id),
  claim_key TEXT NOT NULL,
  UNIQUE (job_id, chunk_id, claim_key)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  route TEXT NOT NULL,
  request_key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, route, request_key)
);
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return str(uuid.uuid4())


def connect() -> sqlite3.Connection:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


@contextmanager
def tx(conn: sqlite3.Connection):
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def init_db() -> None:
    from .seed import seed

    conn = connect()
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(SCHEMA)
        seed(conn)
    finally:
        conn.close()


def jloads(value):
    return json.loads(value) if value else None


def jdumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
