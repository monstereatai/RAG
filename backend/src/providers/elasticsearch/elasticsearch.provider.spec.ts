import { ConfigService } from '@nestjs/config';
import { ElasticsearchProvider } from './elasticsearch.provider';

const effectiveAtFilter = {
  bool: {
    should: [
      { bool: { must_not: [{ exists: { field: 'effectiveAt' } }] } },
      { range: { effectiveAt: { lt: '2025-10-01T00:00:00.000Z' } } },
    ],
    minimum_should_match: 1,
  },
};
const expiredAtFilter = {
  bool: {
    should: [
      { bool: { must_not: [{ exists: { field: 'expiredAt' } }] } },
      { range: { expiredAt: { gt: '2025-09-01T00:00:00.000Z' } } },
    ],
    minimum_should_match: 1,
  },
};
const deprecatedFilter = {
  bool: { must_not: [{ term: { lifecycleStatus: 'deprecated' } }] },
};
const approvalAndArchiveFilter = {
  bool: {
    must_not: [
      { term: { lifecycleStatus: 'draft' } },
      { term: { lifecycleStatus: 'archived' } },
    ],
  },
};

function createProvider() {
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const provider = new ElasticsearchProvider(
    config as unknown as ConfigService,
  );
  const client = {
    search: jest.fn().mockResolvedValue({ hits: { hits: [] } }),
  };
  const internals = provider as unknown as {
    enabled: boolean;
    client: typeof client;
  };
  internals.enabled = true;
  internals.client = client;
  return { provider, client };
}

function firstSearchRequest(
  client: ReturnType<typeof createProvider>['client'],
): unknown {
  const calls = client.search.mock.calls as unknown[][];
  return calls[0]?.[0];
}

function searchFilters(client: ReturnType<typeof createProvider>['client']) {
  const request = firstSearchRequest(client) as {
    query: { bool: { filter?: unknown[] } };
  };
  return request.query.bool.filter ?? [];
}

function knnFilters(client: ReturnType<typeof createProvider>['client']) {
  const request = firstSearchRequest(client) as {
    knn: { filter: unknown[] };
  };
  return request.knn.filter;
}

describe('ElasticsearchProvider historical effective-time filters', () => {
  const effectiveTime = {
    from: '2025-09-01T00:00:00.000Z',
    to: '2025-10-01T00:00:00.000Z',
  };

  it('filters chunk search by interval overlap and includes deprecated history by default', async () => {
    const { provider, client } = createProvider();

    await provider.search('policy', 5, 'user-1', { effectiveTime });

    const filters = searchFilters(client);
    expect(filters).toContainEqual(effectiveAtFilter);
    expect(filters).toContainEqual(expiredAtFilter);
    expect(filters).toContainEqual(approvalAndArchiveFilter);
    expect(filters).not.toContainEqual(deprecatedFilter);
  });

  it('keeps ordinary chunk search behavior and honors explicit deprecated exclusion for history', async () => {
    const ordinary = createProvider();
    await ordinary.provider.search('policy', 5, 'user-1');
    const ordinaryFilters = searchFilters(ordinary.client);
    expect(ordinaryFilters).toContainEqual(deprecatedFilter);
    expect(ordinaryFilters).toContainEqual(approvalAndArchiveFilter);
    expect(ordinaryFilters).not.toContainEqual(effectiveAtFilter);
    expect(ordinaryFilters).not.toContainEqual(expiredAtFilter);

    const historical = createProvider();
    await historical.provider.search('policy', 5, 'user-1', {
      effectiveTime,
      includeDeprecated: false,
    });
    expect(searchFilters(historical.client)).toContainEqual(deprecatedFilter);
  });

  it('filters kNN by interval overlap and includes deprecated history by default', async () => {
    const { provider, client } = createProvider();

    await provider.knnSearch([0.1], 5, 'user-1', { effectiveTime });

    const filters = knnFilters(client);
    expect(filters).toContainEqual(effectiveAtFilter);
    expect(filters).toContainEqual(expiredAtFilter);
    expect(filters).toContainEqual(approvalAndArchiveFilter);
    expect(filters).not.toContainEqual(deprecatedFilter);
  });

  it('keeps ordinary kNN behavior and honors explicit deprecated exclusion for history', async () => {
    const ordinary = createProvider();
    await ordinary.provider.knnSearch([0.1], 5, 'user-1');
    const ordinaryFilters = knnFilters(ordinary.client);
    expect(ordinaryFilters).toContainEqual(deprecatedFilter);
    expect(ordinaryFilters).toContainEqual(approvalAndArchiveFilter);
    expect(ordinaryFilters).not.toContainEqual(effectiveAtFilter);
    expect(ordinaryFilters).not.toContainEqual(expiredAtFilter);

    const historical = createProvider();
    await historical.provider.knnSearch([0.1], 5, 'user-1', {
      effectiveTime,
      includeDeprecated: false,
    });
    expect(knnFilters(historical.client)).toContainEqual(deprecatedFilter);
  });
});
