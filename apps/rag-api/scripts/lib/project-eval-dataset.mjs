export function relatedDocumentIdsForQuery(query) {
  const ids = new Set();
  for (const field of ['expectedDocIds', 'sourceDocumentIds']) {
    const value = query?.[field];
    if (Array.isArray(value)) {
      for (const id of value) {
        if (typeof id === 'string' && id.trim()) ids.add(id.trim());
      }
    }
  }
  return [...ids];
}

export function validateProjectEvalDataset(
  dataset,
  { minQueries = 10, requireExpectedClaims = false, requireSplits = false } = {},
) {
  const errors = [];
  if (!dataset || typeof dataset !== 'object') {
    return ['dataset must be an object'];
  }

  if (!Array.isArray(dataset.documents) || dataset.documents.length < 5) {
    errors.push('dataset requires at least 5 documents');
  }
  if (!Array.isArray(dataset.queries) || dataset.queries.length < minQueries) {
    errors.push(`dataset requires at least ${minQueries} queries`);
  }

  const documentIds = new Set();
  for (const [index, document] of (dataset.documents ?? []).entries()) {
    const label = document?.id || `documents[${index}]`;
    if (typeof document?.id !== 'string' || !document.id.trim()) {
      errors.push(`${label}: document id is required`);
    } else if (documentIds.has(document.id)) {
      errors.push(`${label}: duplicated document id`);
    }
    if (document?.id) documentIds.add(document.id);
    if (typeof document?.content !== 'string' || document.content.length < 80) {
      errors.push(`${label}: document content must be at least 80 characters`);
    }
  }

  const queryIds = new Set();
  let hasNegative = false;
  let hasConflict = false;
  const splitCounts = { development: 0, holdout: 0 };
  for (const [index, query] of (dataset.queries ?? []).entries()) {
    const label = query?.id || `queries[${index}]`;
    if (typeof query?.id !== 'string' || !query.id.trim()) {
      errors.push(`${label}: query id is required`);
    } else if (queryIds.has(query.id)) {
      errors.push(`${label}: duplicated query id`);
    }
    if (query?.id) queryIds.add(query.id);
    if (typeof query?.query !== 'string' || !query.query.trim()) {
      errors.push(`${label}: query text is required`);
    }
    if (requireSplits) {
      if (!['development', 'holdout'].includes(query?.split)) {
        errors.push(`${label}: split must be development or holdout`);
      } else {
        splitCounts[query.split] += 1;
      }
    }

    const expectedKeywords = Array.isArray(query?.expectedKeywords)
      ? query.expectedKeywords
      : [];
    const isNegative = query?.expectRefusal === true || query?.minKeywordHits === 0;
    hasNegative ||= isNegative;
    hasConflict ||= query?.expectConflictHandling === true;

    if (!isNegative && expectedKeywords.length === 0) {
      errors.push(`${label}: expectedKeywords must contain at least one keyword`);
    }
    if (
      !Number.isInteger(query?.minKeywordHits) ||
      query.minKeywordHits < 0 ||
      query.minKeywordHits > expectedKeywords.length
    ) {
      errors.push(`${label}: minKeywordHits must be an integer within expectedKeywords length`);
    }

    for (const field of ['expectedDocIds', 'sourceDocumentIds']) {
      const value = query?.[field];
      if (value !== undefined && !Array.isArray(value)) {
        errors.push(`${label}: ${field} must be an array`);
      } else if (Array.isArray(value) && value.some((id) => typeof id !== 'string' || !id.trim())) {
        errors.push(`${label}: ${field} must contain non-empty document ids`);
      }
    }

    const relatedIds = relatedDocumentIdsForQuery(query);
    if (!isNegative && relatedIds.length === 0) {
      errors.push(`${label}: answerable query requires expectedDocIds or sourceDocumentIds`);
    }
    for (const documentId of relatedIds) {
      if (!documentIds.has(documentId)) {
        errors.push(`${label}: references unknown document ${documentId}`);
      }
    }

    if (requireExpectedClaims && !isNegative) {
      if (!Array.isArray(query?.expectedClaims) || query.expectedClaims.length === 0) {
        errors.push(`${label}: answerable query requires expectedClaims for live judging`);
      } else {
        for (const [claimIndex, claim] of query.expectedClaims.entries()) {
          if (typeof claim?.text !== 'string' || !claim.text.trim()) {
            errors.push(`${label}: expectedClaims[${claimIndex}].text is required`);
          }
          if (
            !Array.isArray(claim?.supportKeywords) ||
            claim.supportKeywords.length === 0
          ) {
            errors.push(`${label}: expectedClaims[${claimIndex}].supportKeywords is required`);
          }
        }
      }
    }
  }

  if (!hasNegative) errors.push('dataset requires at least one negative refusal query');
  if (!hasConflict) errors.push('dataset requires at least one conflict query');
  if (requireSplits && dataset.queries?.length) {
    const minimumHoldout = Math.max(20, Math.ceil(dataset.queries.length * 0.2));
    if (splitCounts.development === 0) {
      errors.push('dataset requires at least one development query');
    }
    if (splitCounts.holdout < minimumHoldout) {
      errors.push(
        `dataset requires at least ${minimumHoldout} holdout queries (20% of the dataset, with a floor of 20)`,
      );
    }
  }
  return errors;
}
