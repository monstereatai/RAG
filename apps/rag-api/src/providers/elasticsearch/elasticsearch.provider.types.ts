import { estypes } from '@elastic/elasticsearch';

export type IndexedDocument = {
  docId: string;
  filename: string;
  title?: string | null;
  summary?: string | null;
  content: string;
  userId?: string | null;
  sourceAuthority?: string;
  projectId?: string | null;
  activityId?: string | null;
  region?: string | null;
  locale?: string | null;
  channel?: string | null;
  roleScope?: string[];
  documentType?: string;
  lifecycleStatus?: string;
  docVersion?: string | null;
  effectiveAt?: string | null;
  expiredAt?: string | null;
};

export type EffectiveTimeRange = { from: string; to: string };

export interface ElasticsearchSearchScope {
  projectId?: string;
  activityId?: string;
  region?: string;
  locale?: string;
  channel?: string;
  role?: string;
  documentType?: string;
  includeDeprecated?: boolean;
  effectiveTime?: EffectiveTimeRange;
  /** 按文件扩展名过滤（filename.keyword wildcard `*.{fileType}`），如 'pdf' */
  fileType?: string;
  /** 按更新时间过滤：day=今天 / week=近7天 / month=近30天（updatedAt date math range） */
  updatedRange?: 'day' | 'week' | 'month';
}

export function effectiveTimeFilters(
  range: EffectiveTimeRange,
): estypes.QueryDslQueryContainer[] {
  return [
    {
      bool: {
        should: [
          { bool: { must_not: [{ exists: { field: 'effectiveAt' } }] } },
          { range: { effectiveAt: { lt: range.to } } },
        ],
        minimum_should_match: 1,
      },
    },
    {
      bool: {
        should: [
          { bool: { must_not: [{ exists: { field: 'expiredAt' } }] } },
          { range: { expiredAt: { gt: range.from } } },
        ],
        minimum_should_match: 1,
      },
    },
  ];
}
