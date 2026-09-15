import type { CourseDefinition } from '../sim/engine'
import type { Calibration } from '../input/controller'

export type LicenseType = 'CLASS1_ORDINARY' | 'CLASS2_ORDINARY'
export const LICENSE_LABEL: Record<LicenseType, string> = { CLASS1_ORDINARY: '1종 보통', CLASS2_ORDINARY: '2종 보통' }

export interface User { id: string; email: string; nickname: string; license_type: LicenseType; created_at: string }

export interface Guide {
  steps: { order: number; title: string; content: string }[]
  sources: { id: string; title: string; publisher: string; url: string; version: string; effective_from: string | null; retrieved_at: string; review_status: string }[]
  road_rule_support: { support: 'A' | 'B' | 'C'; kind: string; n: number }[]
  notice: string
}

export interface Dashboard {
  user: User
  written: {
    submitted_count: number; correct_total: number; answer_total: number
    recent: { id: string; score: number; max_score: number; correct_count: number; question_count: number; submitted_at: string }[]
    in_progress: { id: string; question_count: number; started_at: string } | null
  }
  driving: {
    session_count: number; completed_count: number; disqualified_count: number
    recent: { id: string; status: SessionStatus; ended_at: string; reference_deduction: number | null; input_mode: string; title: string; kind: string; event_count: number }[]
  }
  latest_report: { id: string; status: AiStatus; created_at: string } | null
  llm_configured: boolean
}

export interface Catalog {
  license_type: LicenseType
  categories: { id: string; name: string; question_count: number }[]
  total_questions: number
  modes: { mode: string; available: boolean; label: string; reason?: string }[]
  data_notice: string
}

export interface AttemptQuestion {
  attempt_question_id: string; position: number; question_id: string; code: string
  category: { id: string; name: string }; kind: string; review_status: string
  prompt: string; media_url: string | null; points: number; required_selections: number
  options: { id: string; position: number; content: string; is_correct?: boolean }[]
  selected_option_ids: string[]
}
export interface Attempt {
  id: string; mode: string; status: 'IN_PROGRESS' | 'SUBMITTED' | 'ABORTED'; license_type: LicenseType
  question_count: number; answered_count: number; max_score: number; started_at: string; submitted_at: string | null
  questions: AttemptQuestion[]
}
export interface WrittenResult {
  attempt_id: string; mode: string; status: string; score: number; max_score: number; correct_count: number; question_count: number
  submitted_at: string; outcome: string; outcome_notice: string
  by_category: { category_id: string; name: string; correct: number; total: number }[]
  items: { answer_id: string; position: number; question_id: string; prompt: string; category: { id: string; name: string }; is_correct: boolean; earned_points: number; points: number }[]
}

export type AiStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FALLBACK' | 'INSUFFICIENT_DATA' | 'FAILED'
export interface AiJob<R = unknown> {
  id: string; kind: 'EXPLANATION' | 'REPORT'; answer_id: string | null; status: AiStatus; result: R | null
  model_version: string | null; prompt_version: string; error_code: string | null; error_message: string | null
  created_at: string; finished_at: string | null
  citations: { chunk_id: string; claim_key: string; locator: string; content: string; source_title: string; source_url: string }[]
}
export interface ExplanationResult { summary: string; why_selected_wrong: string; key_rule: string; memory_tip: string; citation_chunk_ids: string[] }

export interface AnswerReview {
  answer_id: string; attempt_id: string; position: number; is_correct: boolean; earned_points: number
  selected_option_ids: string[]; correct_option_ids: string[]
  question: { id: string; code: string; prompt: string; points: number; required_selections: number; kind: string; review_status: string; category: { id: string; name: string }; options: { id: string; position: number; content: string; is_correct: boolean }[]; explanation: string }
  evidence: { chunk_id: string; locator: string; content: string; source_title: string; source_url: string; retrieved_at: string }
  prev_answer_id: string | null; next_answer_id: string | null
  latest_ai_job: AiJob<ExplanationResult> | null
}

export interface ScenarioItem {
  id: string; code: string; version: string; kind: 'FUNCTION' | 'ROAD'; title: string; summary: string; sim_version: string
  length_m: number; time_limit_s: number; practice_rule_count: number
  features: { signals: number; school_zones: number; crosswalks: number; stages: number }
}
export interface PracticeRule {
  code: string; name_ko: string; kind: 'DEDUCTION' | 'DISQUALIFICATION'; deduction_points: number | null; support: 'A' | 'B' | 'C'
  method: string; limitations: string; locator: string; event_codes: string[]; event_labels: string[]
}
export interface ScenarioDetail extends Omit<ScenarioItem, 'length_m' | 'time_limit_s' | 'practice_rule_count' | 'features'> {
  definition: CourseDefinition
  practice_rules: PracticeRule[]
  scoring_notice: string
}
export interface ScoringRule {
  code: string; name_ko: string; kind: 'DEDUCTION' | 'DISQUALIFICATION'; deduction_points: number | null; support: 'A' | 'B' | 'C'
  method: string; limitations: string; locator: string; auto_scoring_enabled: boolean; source_title: string; source_url: string; source_version: string; effective_from: string | null
}

export type SessionStatus = 'RUNNING' | 'COMPLETED' | 'DISQUALIFIED' | 'INCOMPLETE' | 'ABORTED'
export interface SessionSummary {
  id: string; scenario: { id: string; code: string; version: string; kind: 'FUNCTION' | 'ROAD'; title: string }
  input_mode: 'KEYBOARD' | 'SENSOR'; calibration: Calibration | null; status: SessionStatus
  verification_status: 'PENDING' | 'VERIFIED' | 'MISMATCH' | 'NOT_APPLICABLE'; started_at: string; ended_at: string | null; end_reason: string | null
}
export interface DrivingEvent {
  seq: number; code: string; label: string; tick: number; time_s: number; s_m: number; speed_kmh: number; terminal: boolean; category_id: string
  evidence: Record<string, unknown>
  rule: { code: string; name_ko: string; kind: 'DEDUCTION' | 'DISQUALIFICATION'; deduction_points: number | null; support: string; locator: string } | null
}
export interface TrainingResult extends SessionSummary {
  total_ticks: number; duration_s: number; distance_m: number | null; max_speed_kmh: number | null; pause_count: number
  reference_deduction: number | null; official_scoring: false; events: DrivingEvent[]; scoring_notice: string; unmeasured: string[]
  replay?: { inputs: [number, number, number][]; total_ticks: number }
}

export interface ReportStats {
  written: { attempts: { id: string; submitted_at: string; correct: number; total: number }[]; categories: { id: string; name: string; correct: number; total: number; accuracy_pct: number }[]; total_correct: number; total_answers: number }
  driving: { sessions: { id: string; scenario: string; scenario_code: string; status: string; events: string[] }[]; event_counts: { code: string; label: string; count: number }[]; total_sessions: number; disqualified_sessions: number; completed_sessions: number }
  evidence_ids: string[]
  unmeasured: string[]
  sufficient: boolean
}
export interface ReportNarrative {
  headline: string; summary: string
  focus_areas: { title: string; reason: string; evidence_ids: string[] }[]
  next_steps: { title: string; detail: string; target: 'WRITTEN' | 'DRIVE'; ref: string }[]
}
export interface ReportResult { stats: ReportStats; narrative: ReportNarrative; narrative_source: 'llm' | 'rule' }
