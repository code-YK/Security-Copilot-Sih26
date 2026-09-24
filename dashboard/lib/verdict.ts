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

export const ATTRIBUTION_TEXT: Record<string, string> = {
  compromised_account: 'Compromised account',
  spoofed_domain: 'Spoofed domain',
  anonymized_infrastructure: 'Anonymized infrastructure',
  direct_actor: 'Direct actor',
  unknown: 'Unknown',
}
