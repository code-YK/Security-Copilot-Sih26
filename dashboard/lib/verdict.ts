import type { VerdictLabel } from '@/lib/types'

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low' | 'Safe' | 'Unknown'

// SIH26106's five verdict classes, plus the pre-taxonomy labels still in old history rows.
const SEVERITY: Record<string, Severity> = {
  'fraud-related': 'Critical',
  phishing: 'Critical',
  impersonated: 'High',
  suspicious: 'Medium',
  legitimate: 'Safe',
  inconclusive: 'Low',
  dangerous: 'Critical',
  safe: 'Safe',
}

export function severityOf(label?: VerdictLabel | string): Severity {
  return (label && SEVERITY[label]) || 'Low'
}

export function isThreatLabel(label?: string): boolean {
  const sev = severityOf(label)
  return sev === 'Critical' || sev === 'High' || sev === 'Medium'
}

/**
 * A tone is the one colour a verdict is drawn in (CSS: `.tone-<tone>` sets
 * `--tone` / `--tone-soft`). Colour in this UI only ever means a verdict —
 * everything else is monochrome — so each of the five classes gets its own
 * tone instead of collapsing phishing and fraud into one "critical" red.
 */
export type Tone = 'safe' | 'low' | 'medium' | 'high' | 'critical' | 'fraud' | 'unknown'

const LABEL_TONE: Record<string, Tone> = {
  legitimate: 'safe',
  safe: 'safe',
  inconclusive: 'low',
  suspicious: 'medium',
  impersonated: 'high',
  phishing: 'critical',
  dangerous: 'critical',
  'fraud-related': 'fraud',
}

export function toneOfLabel(label?: string): Tone {
  return (label && LABEL_TONE[label]) || 'low'
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
  Safe: 'safe',
  Unknown: 'unknown',
}

export function toneOfSeverity(sev: Severity): Tone {
  return SEVERITY_TONE[sev]
}

/** The five SIH26106 classes, least to most harmful — the order every spectrum uses. */
export const VERDICT_CLASSES = ['legitimate', 'suspicious', 'impersonated', 'phishing', 'fraud-related'] as const
export type VerdictClass = (typeof VERDICT_CLASSES)[number]

export const CLASS_NAME: Record<string, string> = {
  legitimate: 'Legitimate',
  suspicious: 'Suspicious',
  impersonated: 'Impersonated',
  phishing: 'Phishing',
  'fraud-related': 'Fraud',
  inconclusive: 'Inconclusive',
  dangerous: 'Dangerous',
  safe: 'Safe',
}

export function className(label?: string): string {
  return (label && CLASS_NAME[label]) || 'Inconclusive'
}

/** Old rows used dangerous/safe; fold them into the five-class spectrum. */
export function classOf(label?: string): VerdictClass | null {
  if (label === 'dangerous') return 'phishing'
  if (label === 'safe') return 'legitimate'
  return (VERDICT_CLASSES as readonly string[]).includes(label ?? '') ? (label as VerdictClass) : null
}

/**
 * 0–100 risk. `risk_score` (agent/verdict_rules.py) is the real thing; rows
 * from before it existed only carry the model's *confidence in its label*,
 * which for a legitimate verdict means confidence it's safe — so invert it
 * there rather than showing "95" on a harmless case.
 */
export function riskOf(verdict?: { label?: string; risk_score?: number; confidence?: number } | null): number {
  if (!verdict) return 0
  if (typeof verdict.risk_score === 'number') return Math.round(verdict.risk_score * 100)
  const conf = verdict.confidence ?? 0
  return Math.round((severityOf(verdict.label) === 'Safe' ? 1 - conf : conf) * 100)
}

export const ATTRIBUTION_TEXT: Record<string, string> = {
  compromised_account: 'Compromised account',
  spoofed_domain: 'Spoofed domain',
  anonymized_infrastructure: 'Anonymized infrastructure',
  direct_actor: 'Direct actor',
  unknown: 'Unknown',
}
