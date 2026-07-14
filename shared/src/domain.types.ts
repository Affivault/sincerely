export interface SendingDomain {
  id: string;
  user_id: string;
  domain: string;
  /** Unique token for TXT ownership verification */
  verification_token: string;
  /** Overall domain verification status */
  is_verified: boolean;
  /** Individual DNS record statuses */
  txt_verified: boolean;
  spf_ok: boolean;
  dkim_ok: boolean;
  dmarc_ok: boolean;
  /** Last DNS check results (stored as JSON) */
  last_dns_check: DnsCheckResult | null;
  last_checked_at: string | null;
  /** Provider detected from MX records */
  detected_provider: string | null;
  created_at: string;
  updated_at: string;
}

export interface DnsCheckResult {
  mx: { found: boolean; records: Array<{ exchange: string; priority: number }> };
  spf: {
    found: boolean;
    record: string | null;
    valid: boolean;
    includes_provider: boolean;
    /** More than one SPF record published — a permanent error per RFC 7208 */
    multiple?: boolean;
  };
  dkim: { found: boolean; selector: string | null; note: string };
  dmarc: { found: boolean; record: string | null; policy: string | null };
  verification_txt: { found: boolean };
  provider_hint: string | null;
}

export interface DnsRecordInstruction {
  /** Stable identifier: ownership | spf | dkim | dmarc */
  id?: string;
  /** Short display name, e.g. "SPF" */
  label?: string;
  type: 'TXT' | 'CNAME' | 'MX';
  host: string;
  /** The value the user should publish (empty when there's nothing to copy) */
  value: string;
  /** What we actually found in DNS, when different from `value` */
  current?: string | null;
  purpose: string;
  status: 'verified' | 'missing' | 'warning';
  /** Extra guidance shown under the record (warnings, provider steps) */
  note?: string;
  /** False when the value is informational and shouldn't offer a copy button */
  copyable?: boolean;
}

export interface CreateDomainInput {
  domain: string;
}

export interface DomainVerifyResponse {
  domain: SendingDomain;
  dns: DnsCheckResult;
  records: DnsRecordInstruction[];
}
