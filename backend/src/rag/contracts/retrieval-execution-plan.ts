import type {
  RetrievalProfile,
  RetrievalScope,
} from '../evidence/retrieval.types';
import type { QuerySourcePolicy } from '../planning/query-plan';

export interface PlannedRetrievalQuery {
  text: string;
  kind: 'original' | 'standalone' | 'sub_query';
  weight: number;
}

/** Immutable retrieval decisions shared by chat entry points and retrieval implementations. */
export interface RetrievalExecutionPlan {
  planVersion: 2;
  sourcePolicy: QuerySourcePolicy;
  queries: PlannedRetrievalQuery[];
  profile: RetrievalProfile;
  useGraph: boolean;
  scope?: RetrievalScope;
  /** Whether the user or plan explicitly constrained local retrieval. */
  scopeRestricted?: boolean;
  reasonCode:
    | 'internal_evidence_required'
    | 'realtime_web_allowed'
    | 'stable_public_direct'
    | 'public_retrieval';
}
