import type {
  EmailStatus,
  EmailSource,
  EntityType,
  ExtractionResult,
  ProviderName,
  RiskLevel,
  RunStatus,
} from '@mri/shared';

/**
 * Wire types, mirroring `apps/api/src/routes/serializers.ts`.
 *
 * Written out rather than imported from the API package: the browser bundle
 * should not depend on server code, and an explicit contract makes a breaking
 * server change show up as a type error here rather than as a runtime surprise.
 */

export interface RiskSummary {
  level: RiskLevel;
  tags: string[];
}

export interface EmailListItem {
  id: string;
  externalId: string | null;
  source: EmailSource;
  from: string;
  to: string[];
  subject: string;
  sentAt: string | null;
  receivedAt: string;
  status: EmailStatus;
  summary: string | null;
  risk: RiskSummary | null;
  attachmentCount: number;
}

export interface EntityView {
  id: string;
  type: EntityType;
  name: string;
  surfaceForm: string;
  context: string;
}

export interface RelationshipView {
  id: string;
  type: string;
  evidence: string;
  source: { id: string; name: string; type: EntityType };
  target: { id: string; name: string; type: EntityType };
}

export interface RunView {
  id: string;
  provider: ProviderName;
  model: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  degradedReason: string | null;
  error: string | null;
}

export interface EmailDetail extends Omit<EmailListItem, 'summary'> {
  rawText: string;
  attachments: { filename: string; extractedText: string }[];
  extraction: ExtractionResult | null;
  risk: (RiskSummary & { rationale: string; confidence: number }) | null;
  run: RunView | null;
  entities: EntityView[];
  relationships: RelationshipView[];
}

export interface Health {
  status: string;
  provider: {
    name: ProviderName;
    model: string;
    degraded: boolean;
    fallbackReason: string | null;
  };
  queue: { waiting: number; inFlight: number; concurrency: number };
  counts: { emails: number; entities: number; pending: number; processing: number };
}

export interface GraphNode {
  id: string;
  type: EntityType;
  name: string;
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

export interface EmailFilters {
  minRisk?: RiskLevel;
  status?: EmailStatus;
  q?: string;
}
