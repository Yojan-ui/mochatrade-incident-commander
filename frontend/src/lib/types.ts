// Mirrors backend/app/models.py. Keep in sync when the API changes.

export type Status = 'pass' | 'warn' | 'fail' | 'info' | 'error'
export type VectorId = 'spf' | 'dkim' | 'dmarc' | 'mx' | 'starttls' | 'mta_sts' | 'tls_rpt'
export type PathState = 'open' | 'closed' | 'not_applicable'
export type Effort = 'paste' | 'paste+host' | 'provider'

export interface CheckResult {
  id: VectorId
  name: string
  weight: number
  applicable: boolean
  status: Status
  score: number
  points: number
  summary: string
  findings: string[]
  records: string[]
  details: Record<string, unknown>
}

export interface AttackPath {
  id: string
  title: string
  severity: number
  description: string
  state: PathState
  dns_fixable: boolean
  remedy: string
}

export interface DnsRecord {
  type: string
  host: string
  value: string
}

export interface Fix {
  id: string
  title: string
  rationale: string
  record: DnsRecord
  closes: string[]
  severity_closed: number
  score_before: number
  score_after: number
  effort: Effort
  caveats: string[]
}

export interface ScanReport {
  domain: string
  mode: 'live' | 'demo'
  scanned_at: string
  duration_ms: number
  score: number
  grade: string
  summary: string
  checks: CheckResult[]
  attack_paths: AttackPath[]
  one_fix: Fix | null
  other_fixes: Fix[]
  observations: Record<string, unknown>
}

export interface DemoScenario {
  id: string
  domain: string
  title: string
  description: string
}
