import type {
  BudgetResult,
  CiSummary,
  DeveloperReport,
  DeveloperVerboseReport,
  ImpactBudgets,
  ImpactCategory,
  ImpactCategoryBreakdownItem,
  ImpactScoreResult,
  ImpactScoreThresholds,
  ImpactTraceOutput,
  ImpactTraceReport,
  KeyFinding,
  RecommendationEffort,
  ReportingOutputSettings,
  ResourceImpact,
  SavingsItem,
} from '../types/index.js';

const BYTES_PER_MB = 1024 * 1024;

const DEFAULT_SCORE_THRESHOLDS: ImpactScoreThresholds = {
  A: 0.5,
  B: 1,
  C: 2,
  D: 5,
  E: 10,
};

interface ReportingOptions {
  thresholds?: Partial<ImpactScoreThresholds>;
  budgets?: ImpactBudgets;
  baseline?: ImpactTraceReport;
  verbose?: boolean;
  url?: string;
  settings?: ReportingOutputSettings;
}

interface ClassifiedResource {
  resource: ResourceImpact;
  category: ImpactCategory;
}

const CATEGORY_ORDER: ImpactCategory[] = ['video', 'images', 'javascript', 'fonts', 'thirdParty', 'other'];

const CATEGORY_LABELS: Record<ImpactCategory, string> = {
  video: 'Video',
  images: 'Images',
  javascript: 'JavaScript',
  fonts: 'Fonts',
  thirdParty: 'Third Party',
  other: 'Other',
};

const CATEGORY_SAVINGS_FACTOR: Record<ImpactCategory, number> = {
  video: 0.72,
  images: 0.35,
  javascript: 0.25,
  fonts: 0.2,
  thirdParty: 0.3,
  other: 0.1,
};

const CATEGORY_EFFORT: Record<ImpactCategory, RecommendationEffort> = {
  video: 'medium',
  images: 'low',
  javascript: 'medium',
  fonts: 'low',
  thirdParty: 'high',
  other: 'medium',
};

const CATEGORY_RECOMMENDATION: Record<ImpactCategory, string> = {
  video: 'Use adaptive streaming, lazy loading, and poster images for non-critical video.',
  images: 'Convert large images to AVIF/WebP and serve responsive sizes.',
  javascript: 'Split large JavaScript bundles and defer non-critical scripts.',
  fonts: 'Subset fonts, preload only critical variants, and remove unused families.',
  thirdParty: 'Audit third-party dependencies and self-host or remove low-value scripts.',
  other: 'Optimize request payloads and remove non-critical heavy assets.',
};

const CATEGORY_TITLE: Record<ImpactCategory, string> = {
  video: 'Large video assets dominate total emissions.',
  images: 'Image payloads are a major contributor.',
  javascript: 'JavaScript transfer drives avoidable impact.',
  fonts: 'Font payloads can be reduced with subsetting.',
  thirdParty: 'Third-party dependencies add significant overhead.',
  other: 'Non-media assets still contribute measurable emissions.',
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function toPercent(part: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return (part / total) * 100;
}

function toDeltaPercent(previous: number, current: number): number | null {
  if (previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function resolveThresholds(input?: Partial<ImpactScoreThresholds>): ImpactScoreThresholds {
  return {
    A: input?.A ?? DEFAULT_SCORE_THRESHOLDS.A,
    B: input?.B ?? DEFAULT_SCORE_THRESHOLDS.B,
    C: input?.C ?? DEFAULT_SCORE_THRESHOLDS.C,
    D: input?.D ?? DEFAULT_SCORE_THRESHOLDS.D,
    E: input?.E ?? DEFAULT_SCORE_THRESHOLDS.E,
  };
}

function gradeFromCarbon(valueGrams: number, thresholds: ImpactScoreThresholds): ImpactScoreResult['grade'] {
  if (valueGrams < thresholds.A) {
    return 'A';
  }
  if (valueGrams < thresholds.B) {
    return 'B';
  }
  if (valueGrams < thresholds.C) {
    return 'C';
  }
  if (valueGrams < thresholds.D) {
    return 'D';
  }
  if (valueGrams < thresholds.E) {
    return 'E';
  }
  return 'F';
}

function isThirdPartyResource(url: string, firstPartyHost?: string): boolean {
  if (!firstPartyHost) {
    return false;
  }

  try {
    const host = new URL(url).hostname;
    return host !== firstPartyHost && !host.endsWith(`.${firstPartyHost}`);
  } catch {
    return false;
  }
}

function classifyResource(resource: ResourceImpact, firstPartyHost?: string): ImpactCategory {
  const type = resource.resourceType?.toLowerCase() ?? '';
  const lowerUrl = resource.url.toLowerCase();

  if (type === 'media' || type === 'video' || /\.(mp4|webm|mov|m3u8)(\?|$)/.test(lowerUrl)) {
    return 'video';
  }

  if (type === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/.test(lowerUrl)) {
    return 'images';
  }

  if (type === 'script' || /\.m?js(\?|$)/.test(lowerUrl)) {
    return 'javascript';
  }

  if (type === 'font' || /\.(woff2?|ttf|otf)(\?|$)/.test(lowerUrl)) {
    return 'fonts';
  }

  if (isThirdPartyResource(resource.url, firstPartyHost)) {
    return 'thirdParty';
  }

  return 'other';
}

function inferFirstPartyHost(report: ImpactTraceReport, explicitUrl?: string): string | undefined {
  if (explicitUrl) {
    try {
      return new URL(explicitUrl).hostname;
    } catch {
      return undefined;
    }
  }

  if (report.urlBreakdown && report.urlBreakdown.length > 0) {
    try {
      return new URL(report.urlBreakdown[0].url).hostname;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function computeRepresentativeMetrics(report: ImpactTraceReport): { carbonGrams: number; transferBytes: number; cpuSeconds: number } {
  if (report.comparison?.representativeVisit) {
    return {
      carbonGrams: report.comparison.representativeVisit.swdm.total.carbonGrams,
      transferBytes: report.comparison.representativeVisit.networkBytes,
      cpuSeconds: report.comparison.representativeVisit.cpu.timeMs / 1000,
    };
  }

  return {
    carbonGrams: report.swdm.total.carbonGrams,
    transferBytes: report.networkBytes,
    cpuSeconds: report.cpu.timeMs / 1000,
  };
}

function computeScore(carbonGrams: number, thresholds: ImpactScoreThresholds): ImpactScoreResult {
  const grade = gradeFromCarbon(carbonGrams, thresholds);
  const reason =
    grade === 'A' || grade === 'B'
      ? 'Light transfer and efficient asset profile keep page impact low.'
      : grade === 'C' || grade === 'D'
        ? 'Transfer-heavy assets are increasing overall page impact.'
        : 'Large media and script payloads are driving high page impact.';

  return {
    grade,
    valueGrams: carbonGrams,
    reason,
    thresholds,
  };
}

function buildBreakdown(resources: ClassifiedResource[], totalCarbonGrams: number): ImpactCategoryBreakdownItem[] {
  const buckets = new Map<ImpactCategory, { carbonGrams: number; topAsset?: string }>();

  for (const category of CATEGORY_ORDER) {
    buckets.set(category, { carbonGrams: 0 });
  }

  for (const { resource, category } of resources) {
    const bucket = buckets.get(category);
    if (!bucket) {
      continue;
    }

    bucket.carbonGrams += resource.carbonGrams;
    if (!bucket.topAsset || resource.carbonGrams > 0) {
      bucket.topAsset = resource.url;
    }
  }

  const items: ImpactCategoryBreakdownItem[] = [];
  for (const category of CATEGORY_ORDER) {
    const bucket = buckets.get(category);
    if (!bucket) {
      continue;
    }

    items.push({
      category,
      carbonGrams: bucket.carbonGrams,
      percentage: toPercent(bucket.carbonGrams, totalCarbonGrams),
      topAssetUrl: bucket.topAsset,
    });
  }

  return items.sort((a, b) => b.percentage - a.percentage);
}

function normalize(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) {
    return 0;
  }
  return Math.min(Math.max(value / max, 0), 1);
}

function effortScore(effort: RecommendationEffort): number {
  if (effort === 'low') {
    return 0.2;
  }
  if (effort === 'medium') {
    return 0.6;
  }
  return 1;
}

function buildFindings(
  breakdown: ImpactCategoryBreakdownItem[],
  representativeCarbonGrams: number,
  budgets?: ImpactBudgets,
  findingsLimit = 5,
): KeyFinding[] {
  const topCategories = breakdown.filter((item) => item.carbonGrams > 0).slice(0, 5);
  const maxSaving = Math.max(...topCategories.map((item) => item.carbonGrams * CATEGORY_SAVINGS_FACTOR[item.category]), 0);

  const findings = topCategories.map((item, index) => {
    const effort = CATEGORY_EFFORT[item.category];
    const estimatedSavingGrams = item.carbonGrams * CATEGORY_SAVINGS_FACTOR[item.category];
    const ciUrgency = budgets?.carbonGrams !== undefined && representativeCarbonGrams > budgets.carbonGrams ? 1 : 0;
    const confidence = item.percentage >= 30 ? 0.95 : item.percentage >= 10 ? 0.8 : 0.65;

    const priorityScore =
      0.45 * normalize(estimatedSavingGrams, maxSaving) +
      0.25 * normalize(item.percentage, 100) +
      0.15 * confidence +
      0.1 * ciUrgency -
      0.2 * effortScore(effort);

    return {
      id: `finding-${index + 1}`,
      title: CATEGORY_TITLE[item.category],
      category: item.category,
      assetUrl: item.topAssetUrl,
      carbonGrams: item.carbonGrams,
      recommendation: CATEGORY_RECOMMENDATION[item.category],
      estimatedSavingGrams,
      priorityScore,
      confidence,
      effort,
    } as KeyFinding;
  });

  return findings.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, findingsLimit);
}

function buildSavingsSummary(findings: KeyFinding[], representativeCarbonGrams: number): { items: SavingsItem[]; totalEstimatedSavingGrams: number; totalEstimatedSavingPercent: number } {
  const items = findings.map((finding) => ({
    label: `${CATEGORY_LABELS[finding.category]} optimization`,
    estimatedSavingGrams: finding.estimatedSavingGrams,
  }));

  const totalEstimatedSavingGrams = items.reduce((sum, item) => sum + item.estimatedSavingGrams, 0);
  return {
    items,
    totalEstimatedSavingGrams,
    totalEstimatedSavingPercent: clampPercent(toPercent(totalEstimatedSavingGrams, representativeCarbonGrams)),
  };
}

function buildCacheAssessment(report: ImpactTraceReport): DeveloperReport['cache'] {
  if (!report.comparison) {
    return undefined;
  }

  const firstVisitCarbonGrams = report.comparison.firstVisit.swdm.total.carbonGrams;
  const returningVisitCarbonGrams = report.comparison.returningVisit.swdm.total.carbonGrams;
  const reductionPercent = clampPercent(toPercent(firstVisitCarbonGrams - returningVisitCarbonGrams, firstVisitCarbonGrams));

  const assessment = reductionPercent >= 35 ? 'good' : reductionPercent >= 15 ? 'moderate' : 'poor';
  const message =
    assessment === 'good'
      ? 'Caching is performing well.'
      : assessment === 'moderate'
        ? 'Caching is helping, but there is room for improvement.'
        : 'Caching benefits are limited for returning users.';

  return {
    firstVisitCarbonGrams,
    returningVisitCarbonGrams,
    reductionPercent,
    assessment,
    message,
  };
}

function buildBudgetResults(
  representative: { carbonGrams: number; transferBytes: number; cpuSeconds: number },
  resources: ClassifiedResource[],
  budgets?: ImpactBudgets,
): BudgetResult[] {
  const thirdPartyBytes = resources
    .filter((item) => item.category === 'thirdParty')
    .reduce((sum, item) => sum + item.resource.networkBytes, 0);

  const rows: Array<{ metric: BudgetResult['metric']; actual: number; budget?: number; unit: BudgetResult['unit'] }> = [
    { metric: 'carbon', actual: representative.carbonGrams, budget: budgets?.carbonGrams, unit: 'g' },
    { metric: 'transfer', actual: representative.transferBytes, budget: budgets?.transferBytes, unit: 'bytes' },
    { metric: 'cpu', actual: representative.cpuSeconds, budget: budgets?.cpuSeconds, unit: 'seconds' },
    { metric: 'thirdParty', actual: thirdPartyBytes, budget: budgets?.thirdPartyBytes, unit: 'bytes' },
  ];

  return rows.map((row) => {
    if (row.budget === undefined) {
      return {
        ...row,
        status: 'not-configured',
      };
    }

    const delta = row.actual - row.budget;
    return {
      ...row,
      status: delta <= 0 ? 'pass' : 'fail',
      delta,
      deltaPercent: toDeltaPercent(row.budget, row.actual),
    };
  });
}

function buildStatus(
  score: ImpactScoreResult,
  breakdown: ImpactCategoryBreakdownItem[],
  budgets: BudgetResult[],
  cache?: DeveloperReport['cache'],
): string[] {
  const status: string[] = [];

  const transferBudget = budgets.find((budget) => budget.metric === 'transfer');
  if (transferBudget?.status === 'fail') {
    status.push('Transfer budget exceeded');
  } else if (transferBudget?.status === 'pass') {
    status.push('Transfer budget is within target');
  }

  const top = breakdown[0];
  if (top && top.percentage > 0) {
    status.push(`${CATEGORY_LABELS[top.category]} dominates page impact (${top.percentage.toFixed(0)}%)`);
  }

  if (cache) {
    status.push(cache.message);
  }

  if (status.length === 0) {
    status.push(`Impact score ${score.grade} with no active budget violations.`);
  }

  return status.slice(0, 3);
}

function pickLargestContributor(breakdown: ImpactCategoryBreakdownItem[]): string | undefined {
  const largest = breakdown.find((item) => item.topAssetUrl);
  return largest?.topAssetUrl;
}

function buildCiSummary(
  currentRepresentative: { carbonGrams: number; transferBytes: number },
  budgets: BudgetResult[],
  breakdown: ImpactCategoryBreakdownItem[],
  baseline?: ImpactTraceReport,
): CiSummary {
  const baselineRepresentative = baseline ? computeRepresentativeMetrics(baseline) : undefined;

  const carbonDeltaGrams = baselineRepresentative
    ? currentRepresentative.carbonGrams - baselineRepresentative.carbonGrams
    : undefined;
  const carbonDeltaPercent = baselineRepresentative
    ? toDeltaPercent(baselineRepresentative.carbonGrams, currentRepresentative.carbonGrams)
    : undefined;
  const transferDeltaBytes = baselineRepresentative
    ? currentRepresentative.transferBytes - baselineRepresentative.transferBytes
    : undefined;
  const transferDeltaPercent = baselineRepresentative
    ? toDeltaPercent(baselineRepresentative.transferBytes, currentRepresentative.transferBytes)
    : undefined;

  const failedBudget = budgets.find((budget) => budget.status === 'fail');
  const result: CiSummary['result'] = failedBudget ? 'fail' : 'pass';
  const largestContributor = pickLargestContributor(breakdown);

  return {
    carbonDeltaGrams,
    carbonDeltaPercent,
    transferDeltaBytes,
    transferDeltaPercent,
    largestContributor,
    result,
    summaryLine: failedBudget
      ? `${failedBudget.metric} budget exceeded.`
      : 'All configured budgets passed.',
  };
}

function formatDelta(value?: number, percent?: number | null, unit = ''): string {
  if (value === undefined) {
    return 'n/a';
  }

  const signedValue = `${value >= 0 ? '+' : ''}${value.toFixed(2)}${unit}`;
  if (percent === undefined || percent === null) {
    return signedValue;
  }

  return `${signedValue} (${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%)`;
}

function formatBytesToMb(value: number): string {
  return `${(value / BYTES_PER_MB).toFixed(2)} MB`;
}

function applyMaxLines(markdown: string, maxLines?: number): string {
  if (!maxLines || !Number.isInteger(maxLines) || maxLines <= 0) {
    return markdown;
  }

  const lines = markdown.split('\n');
  if (lines.length <= maxLines) {
    return markdown;
  }

  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}

export function buildGithubComment(defaultView: DeveloperReport, maxLines?: number): string {
  const budgetRows = defaultView.budgets.map((budget) => {
    const actual = budget.unit === 'bytes'
      ? formatBytesToMb(budget.actual)
      : budget.unit === 'seconds'
        ? `${budget.actual.toFixed(2)} s`
        : `${budget.actual.toFixed(2)} g`;
    const configuredBudget = budget.budget === undefined
      ? 'n/a'
      : budget.unit === 'bytes'
        ? formatBytesToMb(budget.budget)
        : budget.unit === 'seconds'
          ? `${budget.budget.toFixed(2)} s`
          : `${budget.budget.toFixed(2)} g`;
    const delta = budget.delta === undefined
      ? 'n/a'
      : budget.unit === 'bytes'
        ? formatDelta(budget.delta / BYTES_PER_MB, budget.deltaPercent, ' MB')
        : budget.unit === 'seconds'
          ? formatDelta(budget.delta, budget.deltaPercent, ' s')
          : formatDelta(budget.delta, budget.deltaPercent, ' g');

    return `| ${budget.metric} | ${actual} | ${configuredBudget} | ${delta} | ${budget.status.toUpperCase()} |`;
  });

  const contributorLines = defaultView.findings
    .slice(0, 3)
    .map((finding, index) => `${index + 1}. ${finding.assetUrl ?? CATEGORY_LABELS[finding.category]} (${(finding.carbonGrams ?? 0).toFixed(2)} g CO2)`);

  const actionLines = defaultView.findings
    .slice(0, 3)
    .map((finding, index) => `${index + 1}. ${finding.recommendation} (estimated -${finding.estimatedSavingGrams.toFixed(2)} g)`);

  const markdown = [
    '### ImpactTrace Summary',
    `Score: ${defaultView.score.grade} | Representative Visit: ${defaultView.representativeVisit.carbonGrams.toFixed(2)} g CO2 | Transfer: ${formatBytesToMb(defaultView.representativeVisit.transferBytes)}`,
    '',
    `Result: ${defaultView.ciSummary?.result.toUpperCase() ?? 'PASS'} (${defaultView.ciSummary?.summaryLine ?? 'No budget data'})`,
    '',
    '| Metric | Current | Budget | Delta vs baseline | Status |',
    '|---|---:|---:|---:|---|',
    ...budgetRows,
    '',
    'Top Contributors',
    ...(contributorLines.length > 0 ? contributorLines : ['1. No contributors captured']),
    '',
    'Top Actions',
    ...(actionLines.length > 0 ? actionLines : ['1. No actions available']),
  ].join('\n');

  return applyMaxLines(markdown, maxLines);
}

export function buildReportingOutput(report: ImpactTraceReport, options: ReportingOptions = {}): ImpactTraceOutput {
  const representative = computeRepresentativeMetrics(report);
  const thresholds = resolveThresholds(options.thresholds);
  const score = computeScore(representative.carbonGrams, thresholds);
  const firstPartyHost = inferFirstPartyHost(report, options.url);

  const classifiedResources: ClassifiedResource[] = report.topResources.map((resource) => ({
    resource,
    category: classifyResource(resource, firstPartyHost),
  }));

  const findingsLimit =
    options.settings?.findingsLimit && Number.isInteger(options.settings.findingsLimit)
      ? Math.max(1, Math.min(options.settings.findingsLimit, 10))
      : 5;

  const breakdown = buildBreakdown(classifiedResources, representative.carbonGrams);
  const findings = buildFindings(breakdown, representative.carbonGrams, options.budgets, findingsLimit);
  const savings = buildSavingsSummary(findings, representative.carbonGrams);
  const cache = buildCacheAssessment(report);
  const budgets = buildBudgetResults(representative, classifiedResources, options.budgets);
  const status = buildStatus(score, breakdown, budgets, cache);
  const ciSummary = buildCiSummary(representative, budgets, breakdown, options.baseline);

  const defaultView: DeveloperReport = {
    score,
    representativeVisit: representative,
    status,
    breakdown,
    findings,
    savings,
    cache,
    budgets,
    ciSummary,
  };

  const output: ImpactTraceOutput = {
    formatVersion: '2.0',
    generatedAt: new Date().toISOString(),
    raw: report,
    defaultView,
    ci: ciSummary,
    githubComment: buildGithubComment(defaultView, options.settings?.githubCommentMaxLines),
  };

  if (options.verbose) {
    output.verboseView = {
      ...defaultView,
      modelInternals: {
        swdm: report.swdm,
        cpu: report.cpu,
        assumptions: report.modelInputs ?? {},
        sources: report.sources,
      },
    } satisfies DeveloperVerboseReport;
  }

  return output;
}
