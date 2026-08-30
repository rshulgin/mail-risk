import {
  normalizeEntityKey,
  type ExtractedEntity,
  type ExtractedFact,
  type ExtractedRelationship,
  type ExtractionResult,
  type RawEmail,
  type RiskGraphResult,
  type RiskLevel,
} from '@mri/shared';

/**
 * Deterministic fallback for both agents.
 *
 * This is what runs when no model is reachable, and it is a real
 * implementation rather than a stub: the app must stay useful with Ollama
 * stopped and no API key. It is deliberately coarser than a model — it reads
 * addresses, amounts and phrase patterns, not meaning — so results produced
 * this way are labelled `rules` all the way to the UI. Never passed off as
 * model output.
 */

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'protonmail.com',
  'proton.me', 'fastmail.com', 'icloud.com', 'aol.com', 'gmx.com',
  'mail.com', 'yandex.com', 'zoho.com', 'tutanota.com',
]);

export interface HeuristicOptions {
  /** Domains treated as "inside the organisation" for recipient checks. */
  internalDomains: readonly string[];
}

const DEFAULT_OPTIONS: HeuristicOptions = { internalDomains: ['arcline.com'] };

// ---------------------------------------------------------------------------
// Address helpers
// ---------------------------------------------------------------------------

const addressOf = (value: string): string => {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
};

const domainOf = (value: string): string => addressOf(value).split('@')[1] ?? '';

/** `arclne-corp.com` -> `arclne`; used for lookalike comparison. */
const brandOf = (domain: string): string => (domain.split('.')[0] ?? '').split('-')[0] ?? '';

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/**
 * True when the sender's domain is a near-miss of an internal one — the
 * signature of `arclne-corp.com` (E001) and `arclline-portal.com` (E008).
 * Exact matches are not lookalikes, and neither are wholly unrelated domains.
 */
export function isLookalikeDomain(
  domain: string,
  internalDomains: readonly string[],
): boolean {
  if (!domain || internalDomains.includes(domain)) return false;

  return internalDomains.some((internal) => {
    const brand = brandOf(internal);
    const candidate = brandOf(domain);
    if (!brand || !candidate || brand === candidate) return false;

    const distance = levenshtein(brand, candidate);
    // Within a couple of edits, and long enough that the distance means
    // something — "ab" vs "cd" is distance 2 but not a lookalike.
    return distance > 0 && distance <= 2 && brand.length >= 5;
  });
}

// ---------------------------------------------------------------------------
// Fact extraction
// ---------------------------------------------------------------------------

// Digit groups must not end on a comma: "$47,300, due in 10 days" was
// capturing the sentence comma and storing the amount as "$47,300,".
const AMOUNT_RE = /\$\s?\d+(?:,\d{3})*(?:\.\d{1,2})?\s*(?:k|m|bn|million|thousand)?/gi;
const ACCOUNT_RE = /(?:account|acct|routing)[^\d\n]{0,20}(\d{4,})/gi;
const REFERENCE_RE = /(?:invoice|reference|ref)\s*#?\s*([A-Z]{1,5}-?\d{3,})/gi;
const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}(?:T[\d:]+Z?)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:\s*[-–]\s*\d{1,2})?)\b/gi;

const uniqueMatches = (text: string, pattern: RegExp, group = 0): string[] => {
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const value = (match[group] ?? '').trim();
    if (value) seen.add(value);
  }
  return [...seen];
};

/** Body plus every attachment, which is where the account numbers usually are. */
function fullText(email: RawEmail): string {
  return [email.subject, email.body, ...email.attachments.map((a) => a.extractedText)]
    .filter(Boolean)
    .join('\n');
}

function firstSentences(body: string, limit = 220): string {
  const collapsed = body.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= limit) return collapsed;
  const cut = collapsed.slice(0, limit);
  const lastStop = cut.lastIndexOf('. ');
  return `${lastStop > 60 ? cut.slice(0, lastStop + 1) : cut.trimEnd()}…`;
}

export function heuristicExtraction(email: RawEmail): ExtractionResult {
  const text = fullText(email);

  const facts: ExtractedFact[] = [
    ...uniqueMatches(text, AMOUNT_RE).map(
      (value): ExtractedFact => ({ kind: 'amount', value, context: 'matched currency pattern' }),
    ),
    ...uniqueMatches(text, ACCOUNT_RE, 1).map(
      (value): ExtractedFact => ({ kind: 'account', value, context: 'matched account or routing number' }),
    ),
    ...uniqueMatches(text, REFERENCE_RE, 1).map(
      (value): ExtractedFact => ({ kind: 'reference', value, context: 'matched invoice or reference number' }),
    ),
    ...uniqueMatches(text, DATE_RE).map(
      (value): ExtractedFact => ({ kind: 'date', value, context: 'matched date pattern' }),
    ),
  ];

  return {
    sender: email.from,
    recipients: email.to,
    date: email.date,
    subject: email.subject,
    summary: firstSentences(email.body) || email.subject,
    facts,
  };
}

// ---------------------------------------------------------------------------
// Risk signals
// ---------------------------------------------------------------------------

interface Signal {
  tag: string;
  weight: number;
  reason: string;
  matches(context: SignalContext): boolean;
}

interface SignalContext {
  text: string;
  amounts: string[];
  senderDomain: string;
  recipientDomains: string[];
  internalDomains: readonly string[];
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

const SIGNALS: readonly Signal[] = [
  {
    tag: 'urgency',
    weight: 2,
    reason: 'demands action within a compressed deadline',
    matches: (c) =>
      has(
        c.text,
        /\b(urgent|immediately|asap|right away|before noon|time-sensitive|cannot wait|can'?t wait|action required|expires? in \d+ hours?|within \d+ hours?)\b/i,
      ),
  },
  {
    tag: 'confidentiality',
    weight: 2,
    reason: 'asks for the request to be kept off normal channels',
    matches: (c) =>
      has(
        c.text,
        /\b(treat this as confidential|don'?t loop in|do not loop in|delete this|delete after reading|keep this (?:quiet|between)|don'?t reply to this from your work)\b/i,
      ),
  },
  {
    tag: 'payment-redirect',
    weight: 4,
    reason: 'requests payment to bank details that differ from those on file',
    matches: (c) =>
      has(
        c.text,
        /\b(new (?:bank |payment )?account|updated payment details|changed banking|change of bank|new account details|new payment account)\b/i,
      ),
  },
  {
    tag: 'financial-anomaly',
    weight: 2,
    reason: 'references a prior account or asks for records to be updated',
    matches: (c) =>
      has(c.text, /\b(account on file|previous invoices|update your records|rather than the account)\b/i),
  },
  {
    tag: 'financial-anomaly',
    weight: 2,
    reason: 'moves a specific sum by wire or transfer',
    matches: (c) => c.amounts.length > 0 && has(c.text, /\b(wire|transfer|escrow|remit)\b/i),
  },
  {
    tag: 'threat-language',
    weight: 6,
    reason: 'contains intimidating or threatening language',
    matches: (c) =>
      has(
        c.text,
        /\b(you'?ll regret|you will regret|i know where|i know people|this isn'?t over|this is not over|you won'?t like|watch your back|hearing from me again)\b/i,
      ),
  },
  {
    tag: 'mnpi-risk',
    weight: 5,
    reason: 'discusses an unannounced deal alongside a trading suggestion',
    matches: (c) =>
      has(
        c.text,
        /\b(before the market|pick up some shares|buy some shares|announcement is|not (?:yet )?public|deal is basically done|before it'?s announced|insider)\b/i,
      ),
  },
  {
    tag: 'data-exfiltration',
    weight: 5,
    reason: 'sends internal material to a personal address',
    matches: (c) =>
      c.recipientDomains.some((domain) => FREE_MAIL_DOMAINS.has(domain)) &&
      has(
        c.text,
        /\b(forwarding|taking copies|copies of the|before i (?:officially )?resign|contracts with me|roadmap|confidential)\b/i,
      ),
  },
  {
    tag: 'phishing',
    weight: 5,
    reason: 'asks for credentials via an external link under threat of lockout',
    matches: (c) =>
      has(
        c.text,
        /\b(hxxp|verify your identity|reset your password|password (?:will )?expires?|account suspension|secure link below|failure to act)\b/i,
      ),
  },
  {
    tag: 'accounting-irregularity',
    weight: 3,
    reason: 'describes unexplained movement of spend between cost centres',
    matches: (c) =>
      has(
        c.text,
        /\b(cost cent(?:er|re)|reclassif|restat|before the board review|no clear business reason)\b/i,
      ),
  },
  {
    tag: 'impersonation',
    weight: 3,
    reason: 'sender domain is a near-miss of an internal domain',
    matches: (c) => isLookalikeDomain(c.senderDomain, c.internalDomains),
  },
  {
    tag: 'unusual-recipient',
    weight: 2,
    reason: 'internal sender writing to a personal mailbox',
    matches: (c) =>
      c.internalDomains.includes(c.senderDomain) &&
      c.recipientDomains.some((domain) => FREE_MAIL_DOMAINS.has(domain)),
  },
];

/** Score thresholds, tuned against the seed corpus and pinned by tests. */
function levelForScore(score: number): RiskLevel {
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  if (score >= 1) return 'low';
  return 'none';
}

function heuristicEntities(
  email: RawEmail,
  extraction: ExtractionResult,
  internalDomains: readonly string[],
): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  const push = (entity: ExtractedEntity) => {
    const key = `${entity.type}:${normalizeEntityKey(entity.type, entity.name) ?? entity.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    entities.push(entity);
  };

  for (const [address, role] of [
    [email.from, 'sender'] as const,
    ...email.to.map((to) => [to, 'recipient'] as const),
  ]) {
    if (!address) continue;
    // Only keep addresses that reduce to something person-shaped; functional
    // mailboxes like `accounts-payable@` become organisations via the domain.
    if (normalizeEntityKey('person', address)) {
      push({ type: 'person', name: address, context: `email ${role}` });
    }
    const domain = domainOf(address);
    if (domain && !FREE_MAIL_DOMAINS.has(domain)) {
      push({
        type: 'organization',
        name: domain,
        context: internalDomains.includes(domain) ? 'internal domain' : `domain of ${role}`,
      });
    }
  }

  for (const fact of extraction.facts) {
    if (fact.kind === 'amount') push({ type: 'amount', name: fact.value, context: fact.context });
    if (fact.kind === 'account') push({ type: 'account', name: fact.value, context: fact.context });
  }

  return entities;
}

export function heuristicRiskGraph(
  email: RawEmail,
  extraction: ExtractionResult,
  options: HeuristicOptions = DEFAULT_OPTIONS,
): RiskGraphResult {
  const context: SignalContext = {
    text: fullText(email),
    amounts: extraction.facts.filter((f) => f.kind === 'amount').map((f) => f.value),
    senderDomain: domainOf(email.from),
    recipientDomains: email.to.map(domainOf).filter(Boolean),
    internalDomains: options.internalDomains,
  };

  const fired = SIGNALS.filter((signal) => signal.matches(context));
  const score = fired.reduce((total, signal) => total + signal.weight, 0);
  const level = levelForScore(score);
  const tags = [...new Set(fired.map((signal) => signal.tag))];

  const rationale = fired.length
    ? `Rule-based assessment: ${fired.map((s) => s.reason).join('; ')}.`
    : 'Rule-based assessment: no risk patterns matched.';

  const entities = heuristicEntities(email, extraction, options.internalDomains);
  const relationships: ExtractedRelationship[] = [];

  if (email.from) {
    for (const recipient of email.to) {
      const target = normalizeEntityKey('person', recipient) ? recipient : domainOf(recipient);
      if (!target) continue;
      relationships.push({
        source: email.from,
        target,
        type: 'sends_to',
        evidence: 'appears in the email header',
      });
    }

    const firstAmount = context.amounts[0];
    if (firstAmount && has(context.text, /\b(wire|transfer|escrow|remit|pay)\b/i)) {
      relationships.push({
        source: email.from,
        target: firstAmount,
        type: 'requests_transfer_of',
        evidence: 'transfer language alongside a stated amount',
      });
    }
  }

  return {
    risk: {
      level,
      rationale,
      tags,
      // Deliberately capped: rules should never claim model-level certainty.
      confidence: fired.length === 0 ? 0.4 : Math.min(0.7, 0.35 + fired.length * 0.08),
    },
    entities,
    relationships,
  };
}
