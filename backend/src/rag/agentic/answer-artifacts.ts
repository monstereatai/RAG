import type { AgenticRagStateType } from './agentic-rag.state';
import {
  createAgenticArtifact,
  type AgenticArtifact,
  type AnswerContractArtifactPayload,
} from './agentic-rag.state';
import { buildStructuredDeliveryArtifacts } from './structured-delivery-artifacts';

/** Assemble the answer contract and any structured delivery artifacts. */
export function buildAnswerArtifacts(
  state: AgenticRagStateType,
  answer: string,
  citationSupported: boolean,
  subQuestionCoverage: number,
  reason: string,
): AgenticArtifact[] {
  const payload: AnswerContractArtifactPayload = {
    answer,
    citationSupported,
    subQuestionCoverage,
    valid: citationSupported && subQuestionCoverage >= 1,
    reason,
  };
  const artifact = createAgenticArtifact(
    'answer_contract',
    'generate',
    payload,
  );
  const artifacts = [
    ...(state.artifacts ?? []).filter(
      (item) =>
        item.type !== 'answer_contract' &&
        ![
          'requirement_brief',
          'assumption_register',
          'claim_evidence_matrix',
          'solution_brief',
          'api_contract',
          'event_tracking_plan',
          'test_plan',
          'acceptance_checklist',
          'risk_register',
          'rollout_plan',
          'code_context_pack',
        ].includes(item.type),
    ),
    artifact,
  ];
  return [
    ...artifacts,
    ...buildStructuredDeliveryArtifacts(
      state.query,
      state.retrievedChunks,
      answer,
      state.retrievalSufficient,
    ),
  ];
}
