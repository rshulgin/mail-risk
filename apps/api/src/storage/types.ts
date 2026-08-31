import type {
  AgentName,
  EmailSource,
  EmailStatus,
  EntityType,
  ExtractionResult,
  InvocationStatus,
  ProviderName,
  RiskLevel,
  RunStatus,
} from '@mri/shared';

export interface EmailRecord {
  id: string;
  externalId: string | null;
  source: EmailSource;
  rawText: string;
  from: string;
  to: string[];
  subject: string;
  sentAt: string | null;
  createdAt: string;
  status: EmailStatus;
  latestRunId: string | null;
  attachments: { filename: string; extractedText: string }[];
}

/** Inbox row: enough to render the list without loading bodies or graphs. */
export interface EmailSummary {
  id: string;
  externalId: string | null;
  source: EmailSource;
  from: string;
  to: string[];
  subject: string;
  sentAt: string | null;
  createdAt: string;
  status: EmailStatus;
  summary: string | null;
  riskLevel: RiskLevel | null;
  riskTags: string[];
  attachmentCount: number;
}

export interface RunRecord {
  id: string;
  emailId: string;
  provider: ProviderName;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  degradedReason: string | null;
  error: string | null;
}

export interface InvocationRecord {
  id: string;
  runId: string;
  agent: AgentName;
  attempt: number;
  status: InvocationStatus;
  durationMs: number;
  error: string | null;
  rawResponse: string | null;
  createdAt: string;
}

export interface StoredRisk {
  level: RiskLevel;
  rationale: string;
  tags: string[];
  confidence: number;
}

export interface EntityRecord {
  id: string;
  type: EntityType;
  canonicalKey: string;
  displayName: string;
  firstSeenAt: string;
}

export interface EntityWithMention extends EntityRecord {
  surfaceForm: string;
  context: string;
}

export interface RelationshipRecord {
  id: string;
  type: string;
  evidence: string;
  emailId: string;
  source: EntityRecord;
  target: EntityRecord;
}

/** Aggregate graph node: an entity plus how widely it has been observed. */
export interface GraphNode extends EntityRecord {
  mentionCount: number;
  emailIds: string[];
  highestRisk: RiskLevel | null;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  evidence: string;
  emailIds: string[];
}

export interface EmailGraph {
  entities: EntityWithMention[];
  relationships: RelationshipRecord[];
}

export type { ExtractionResult };

/**
 * An entity's history, as fed back into Agent B.
 *
 * Deliberately small: a prompt has a budget, and what matters is "have we seen
 * this party before, was it risky, and what was it connected to" — not the
 * full subgraph.
 */
export interface PriorEntityContext {
  id: string;
  type: EntityType;
  name: string;
  canonicalKey: string;
  emailCount: number;
  lastSeenAt: string | null;
  highestRisk: RiskLevel | null;
  related: {
    type: EntityType;
    name: string;
    relationship: string;
    direction: 'incoming' | 'outgoing';
  }[];
}
