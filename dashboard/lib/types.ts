/**
 * Backend response shapes for the Security Copilot dashboard.
 *
 * Canonical source is the extension's `extension/src/types/index.ts` and the
 * backend endpoint contract — these mirror it (Verdict, RunSummary, the
 * /check-links-stream events). Only fields the backend actually returns are
 * modelled here; run detail is intentionally loose because the backend serves
 * it as an untyped dict (backend/history.py::get_run).
 */
export type VerdictLabel =
  | 'legitimate'
  | 'suspicious'
  | 'impersonated'
  | 'phishing'
  | 'fraud-related'
  | 'inconclusive'
  // pre-SIH26106 labels, still present in older history rows
  | 'dangerous'
  | 'safe'

export interface LegitimateAlternative {
  title: string
  url: string
}

/** POST /check-email, and the per-URL values of POST /check-links. */
export interface Verdict {
  label: VerdictLabel
  confidence: number
  reason: string
  mitigation: string | null
  legitimate_alternatives: LegitimateAlternative[]
  run_id: string
}

/** One row from GET /runs (backend/history.py::list_runs). */
export interface RunSummary {
  id: string
  case_type: string
  raw_input: string
  created_at: number
  verdict: {
    label: VerdictLabel
    confidence: number
    reason?: string
    risk_score?: number
  }
}

/**
 * VirusTotal half of a domain_reputation tool call's artifact
 * (backend/tools/domain_reputation.py::_lookup_virustotal). `flagged_by`/
 * `categories`/`community_reputation` are only populated when `available`
 * is true and VT actually returned data (never on a 404/error/no-key path).
 */
export interface VirusTotalResult {
  available: boolean
  malicious_count?: number
  suspicious_count?: number
  harmless_count?: number
  reputation_score?: number
  detail?: string
  flagged_by?: { vendor: string; category: string | null; result: string | null }[]
  categories?: Record<string, string>
  community_reputation?: number | null
}

/** WHOIS half of the same artifact (backend/tools/domain_reputation.py::_lookup_whois). */
export interface WhoisResult {
  available: boolean
  age_days?: number | null
  detail?: string
  is_parent_domain_match?: boolean
}

/** The sandboxed-browser half of an inspect_website tool call's artifact
 * (backend/tools/inspect_website.py). `navigation_error` is only present
 * when the page never loaded — in that case there's no screenshot either
 * (screenshot_path is null), which the run page treats as its own state
 * rather than silently rendering nothing.
 *
 * `page_title`/`asset_*`/`response_headers`/`server_ip` are the DOM-asset
 * and deployment signals: `asset_dominant_foreign_origin` is only set when
 * a single foreign domain supplies most of the page's images/scripts/CSS
 * (the "cloned kit hotlinks the real brand's assets" tell); `server_ip` is
 * the address the page actually resolved to, independent of the domain
 * name itself. All are absent (not just empty) on a failed navigation,
 * same as the other fields above. */
export interface InspectWebsiteResult {
  final_url?: string
  navigation_error?: string
  error?: string
  status_code?: number | null
  redirect_chain?: { url: string; status: number | null }[]
  page_text?: string
  forms?: { action: string | null; has_password_field: boolean }[]
  links?: { href: string; text: string; same_origin: boolean }[]
  network_requests?: { url: string; method: string }[]
  page_title?: string
  asset_same_origin_count?: number
  asset_cross_origin_count?: number
  asset_dominant_foreign_origin?: { domain: string; asset_count: number } | null
  response_headers?: Record<string, string>
  server_ip?: string | null
}

/** One match from the recall_similar_cases tool's artifact
 * (backend/memory/case_index.py::recall_similar_cases). `similarity` is a
 * cosine score in [0, 1] (in practice usually clustered high — see that
 * file's docstring on why raw, un-whitened embeddings are less
 * discriminative than whitened ones), so treat it as a rough ranking
 * signal, not a calibrated probability. */
export interface SimilarCaseMatch {
  run_id: string
  case_type: string
  raw_input: string
  label: string
  reason: string
  similarity: number
}

/** recall_similar_cases tool call artifact (backend/tools/case_memory.py). */
export interface RecallSimilarCasesResult {
  matches?: SimilarCaseMatch[]
  detail?: string
}

/** One entry in RunDetail.tool_calls (backend/agent/graph.py's
 * tool_call_records — built in stream_case_traced, stored verbatim by
 * history.py::record_run). `artifact` is a different shape per tool:
 * inspect_website's is InspectWebsiteResult (screenshot_path alongside it
 * is the reliable way to get the image — a saved file under GET
 * /screenshots/, not the artifact's own screenshot_base64, which the
 * backend already wrote to disk and which is wasteful to re-render
 * inline); domain_reputation's is `{ domain, whois, virustotal }`;
 * recall_similar_cases's is RecallSimilarCasesResult. */
export interface ToolCallRecord {
  tool: string
  args: Record<string, unknown>
  artifact: Record<string, unknown> &
    InspectWebsiteResult &
    RecallSimilarCasesResult & { domain?: string; whois?: WhoisResult; virustotal?: VirusTotalResult }
  screenshot_path: string | null
}

/**
 * GET /runs/{run_id} (backend/history.py::get_run). The stored verdict predates
 * the run_id wrapper the live routes add, and may be the "inconclusive" default,
 * so every verdict field is treated as optional here.
 */
export interface RunDetail {
  id: string
  case_type: string
  raw_input: string
  created_at: number
  verdict: {
    label?: VerdictLabel
    confidence?: number
    reason?: string
    mitigation?: string | null
    legitimate_alternatives?: LegitimateAlternative[]
    risk_score?: number
    risk_factors?: string[]
    attribution?: string
    attribution_reason?: string
  }
  tool_calls: ToolCallRecord[]
  report_path: string | null
  campaign_id?: string | null
}

/** POST /report (backend/api/routes_report.py) — adds the domain to the
 * local blocklist (this tool refuses it forever after) and reports it to
 * VirusTotal. `virustotal.reported` can be false (no key configured, VT
 * unreachable, or VT rejected the URL) independently of the blocklist
 * addition always succeeding — the two are unrelated, best-effort actions. */
export interface ReportResponse {
  domain: string
  added_to_blocklist: boolean
  virustotal: { reported: boolean; detail: string }
}

/** One Server-Sent Event from POST /check-links-stream. */
export type CheckLinksStreamEvent =
  | { type: 'progress'; label: string }
  | { type: 'done'; verdict: Omit<Verdict, 'run_id'>; run_id: string; report_path: string }

/** Email-forensics artifacts (backend/agent/forensics_node.py), recorded as tool calls. */
export interface HeaderFlag {
  code: string
  severity: string
  detail: string
}

export interface ReceivedHop {
  index: number
  from_host: string | null
  by_host: string | null
  ip: string | null
  ip_is_public: boolean
  timestamp: string | null
  flags: string[]
}

export interface HeaderAnalysis {
  available: boolean
  from?: string | null
  from_domain?: string | null
  return_path?: string | null
  reply_to?: string | null
  message_id?: string | null
  subject?: string
  received_chain?: ReceivedHop[]
  origin_ip?: string | null
  flags?: HeaderFlag[]
}

export interface AuthCheck {
  result: string
  computed?: string
  reported?: string | null
  domain?: string | null
  policy?: string | null
}

export interface AuthValidation {
  available: boolean
  from_domain?: string | null
  spf?: AuthCheck
  dkim?: AuthCheck
  dmarc?: AuthCheck
  alignment?: { spf_aligned: boolean | null; dkim_aligned: boolean | null }
}

export interface Geolocation {
  ip: string
  available: boolean
  detail?: string
  location?: {
    country?: string | null
    country_code?: string | null
    region?: string | null
    city?: string | null
    lat?: number | null
    lon?: number | null
    isp?: string | null
    org?: string | null
    asn?: string | null
    source?: string
  } | null
  infrastructure?: {
    is_tor: boolean | null
    is_vpn: boolean | null
    is_proxy: boolean | null
    is_hosting: boolean | null
    anonymized: boolean
  }
  reputation?: { available: boolean; abuse_confidence_score?: number; total_reports?: number }
}

export interface AttachmentScan {
  available: boolean
  count?: number
  attachments?: {
    filename: string
    size: number
    sha256: string
    detected_mime: string | null
    claimed_extension: string | null
    flags: HeaderFlag[]
  }[]
}

/** GET /runs/{id}/graph (backend/tools/correlation_graph.py). */
export interface CaseGraph {
  nodes: { id: string; type: string; value: string; case_count: number; malicious_case_count: number; in_case: boolean }[]
  links: { source: string; target: string; case_count: number }[]
}

/** GET /campaigns. */
export interface Campaign {
  campaign_id: string
  case_count: number
  run_ids: string[]
  labels: string[]
  sample_inputs: string[]
  shared_entities: { type: string; value: string }[]
  first_seen: number | null
  last_seen: number | null
}
