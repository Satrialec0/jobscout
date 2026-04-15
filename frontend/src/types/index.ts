// ── Auth ──────────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  has_api_key: boolean;
  created_at: string;
}

// ── Job Analysis ──────────────────────────────────────────────────────────────

export interface SalaryEstimate {
  low: number;
  high: number;
  currency: string;
  per: string;
  confidence: string;
  assessment: string | null;
}

export interface JobHistoryItem {
  id: number;
  job_title: string;
  company: string;
  fit_score: number;
  should_apply: boolean;
  one_line_verdict: string;
  direct_matches: string[];
  transferable: string[];
  gaps: string[];
  red_flags: string[];
  green_flags: string[];
  salary_estimate: SalaryEstimate | null;
  status: string | null;
  url: string | null;
  created_at: string;
  applied_date: string | null;
  profile_id: number | null;
  profile_name: string | null;
}

export type AppStatus =
  | "applied"
  | "phone_screen"
  | "interviewed"
  | "offer"
  | "rejected"
  | null;

// ── Scraped Jobs ──────────────────────────────────────────────────────────────

export interface ScrapedJob {
  id: number;
  title: string;
  company: string;
  apply_url: string;
  found_at: string;
  saved_search_name: string | null;
  analysis: JobHistoryItem | null;
}

// ── Saved Searches ────────────────────────────────────────────────────────────

export interface SavedSearch {
  id: number;
  name: string;
  is_active: boolean;
  last_polled: string | null;
  created_at: string;
}

// ── Profiles ──────────────────────────────────────────────────────────────────

export interface Profile {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
}

// ── Keywords ──────────────────────────────────────────────────────────────────

export interface SignalItem {
  ngram: string;
  hide_count: number;
  show_count: number;
}

// ── Targeting ─────────────────────────────────────────────────────────────────

export interface TargetKeywordItem {
  id: number;
  keyword: string;
  source: string;
}

export interface TargetSignalItem {
  ngram: string;
  target_count: number;
  show_count: number;
}

export interface CompanyItem {
  id: number;
  name: string;
  list_type: "target" | "block";
  profile_id: number | null;
}

export interface CompaniesResponse {
  targets: CompanyItem[];
  blocks: CompanyItem[];
}

// ── Credentials ───────────────────────────────────────────────────────────────

export interface CredentialStatus {
  active: boolean;
  last_used: string | null;
  last_error: string | null;
}
