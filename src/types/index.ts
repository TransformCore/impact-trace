import type { Page } from 'playwright';

export interface CarbonMetric {
  source: 'browser' | 'network';
  timestampStart: number;
  timestampEnd: number;
  cpuTimeMs?: number;
  networkBytes?: number;
  metadata?: {
    url?: string;
    resourceType?: string;
    cached?: boolean;
    runLabel?: 'single-run' | 'new-user' | 'returning-user';
    cpuMeasurementWindowMs?: number;
  };
}

export interface RunContext {
  workingDirectory: string;
  journeyScriptPath: string;
  startedAt: number;
  data: Map<string, unknown>;
}

export interface MeasurementPlugin {
  name: string;
  start(context: RunContext): Promise<void>;
  stop(): Promise<CarbonMetric[]>;
}

export type JourneyFunction = (page: Page) => Promise<void>;

export interface ResourceImpact {
  url: string;
  resourceType?: string;
  networkBytes: number;
  energyKwh: number;
  carbonGrams: number;
  cached?: boolean;
}

export interface GridIntensityCountry {
  country: string;
}

export type GridIntensitySegment = number | GridIntensityCountry;

export interface GridIntensityConfig {
  device?: GridIntensitySegment;
  network?: GridIntensitySegment;
  dataCenter?: GridIntensitySegment;
}

export interface TransferSegmentTotals {
  deviceCarbonGrams: number;
  networkCarbonGrams: number;
  dataCenterCarbonGrams: number;
  deviceEnergyKwh: number;
  networkEnergyKwh: number;
  dataCenterEnergyKwh: number;
}

export interface SwdmCategoryTotals {
  operationalCarbonGrams: number;
  embodiedCarbonGrams: number;
  operationalEnergyKwh: number;
  embodiedEnergyKwh: number;
}

export interface SwdmSegmentsTotals {
  dataCenters: SwdmCategoryTotals;
  networks: SwdmCategoryTotals;
  userDevices: SwdmCategoryTotals;
}

export interface ResolvedGridIntensity {
  device: number;
  network: number;
  dataCenter: number;
}

export type AverageMode = 'mean' | 'median' | 'trimmed-mean';
export type CpuMeasurementMode = 'thread-time' | 'process-info';
export type CpuCurveProfileId = 'realistic' | 'conservative' | 'aggressive' | 'linear' | 'if-default';
export type CpuDeviceProfileId = 'desktop' | 'laptop' | 'tablet' | 'mobile';
export type DeviceMixProfileId = 'enterprise' | 'consumer' | 'mobile-first' | 'desktop-first' | 'custom';

export interface CpuDeviceProfileFactors {
  desktop: number;
  laptop: number;
  tablet: number;
  mobile: number;
}

export interface CpuDeviceUsageWeights {
  desktop: number;
  laptop: number;
  tablet: number;
  mobile: number;
}

export type CpuToDeviceFactorSource =
  | 'scalar-explicit'
  | 'scalar-config'
  | 'profile-blend-default'
  | 'profile-blend-explicit';

export type DeviceMixProfileSource = 'default' | 'explicit';

export type ModelInputSource = 'default' | 'explicit' | 'derived';

export type EvidenceSourceId = 'browser-cpu-profiler' | 'co2-transfer' | string;

export interface SwdmLeafValue {
  carbonGrams: number;
  energyKwh: number;
  sourceId?: EvidenceSourceId;
}

export interface SwdmRollupValue {
  carbonGrams: number;
  energyKwh: number;
}

export interface SwdmDimensionBreakdown {
  total: SwdmRollupValue;
  dataCenters: SwdmLeafValue;
  networks: SwdmLeafValue;
  userDevices: SwdmLeafValue;
}

export interface SwdmReportBreakdown {
  total: SwdmRollupValue;
  operational: SwdmDimensionBreakdown;
  embodied: SwdmDimensionBreakdown;
}

export interface SwdmPercentValue {
  carbon: number | null;
  energy: number | null;
}

export interface SwdmPercentDimensionBreakdown {
  total: SwdmPercentValue;
  dataCenters: SwdmPercentValue;
  networks: SwdmPercentValue;
  userDevices: SwdmPercentValue;
}

export interface SwdmPercentBreakdown {
  total: SwdmPercentValue;
  operational: SwdmPercentDimensionBreakdown;
  embodied: SwdmPercentDimensionBreakdown;
}

export interface CpuDetails {
  timeMs: number;
  energyKwh: number;
  carbonGrams: number;
  sourceId?: EvidenceSourceId;
}

export interface ReportSource {
  kind: 'cpu-profiler' | 'transfer-model';
  [key: string]: unknown;
}

export type ReportSources = Record<string, ReportSource>;

export interface VisitReport {
  swdm: SwdmReportBreakdown;
  cpu: CpuDetails;
  networkBytes: number;
  topResources: ResourceImpact[];
}

export interface RepresentativeVisitReport {
  weights: {
    newVisitorRatio: number;
    returnVisitorRatio: number;
  };
  swdm: SwdmReportBreakdown;
  cpu: CpuDetails;
  networkBytes: number;
}

export interface ComparisonDeltaReport {
  absolute: {
    swdm: SwdmReportBreakdown;
    cpu: CpuDetails;
    networkBytes: number;
  };
  percent: {
    swdm: SwdmPercentBreakdown;
    cpu: {
      time: number | null;
      energy: number | null;
      carbon: number | null;
    };
    networkBytes: number | null;
  };
}

export interface ComparisonReport {
  firstVisit: VisitReport;
  returningVisit: VisitReport;
  representativeVisit?: RepresentativeVisitReport;
  delta: ComparisonDeltaReport;
}

export interface CarbonEstimate {
  totalEnergyKwh: number;
  totalCarbonGrams: number;
  totalNetworkEnergyKwh: number;
  totalNetworkCarbonGrams: number;
  totalCpuTimeMs: number;
  totalCpuEnergyKwh: number;
  totalCpuCarbonGrams: number;
  networkBytes: number;
  resolvedGridIntensity?: ResolvedGridIntensity;
  greenHostingFactor: number;
  transferSegments: TransferSegmentTotals;
  swdmSegments: SwdmSegmentsTotals;
  userDeviceOperationalSource: 'co2-transfer' | 'cpu-profiler';
  cpuCurveProfile: CpuCurveProfileId;
  cpuCurvePoints: {
    x: number[];
    y: number[];
  };
  cpuPowerFactor: number;
  cpuUtilizationPercent: number;
  cpuMeasurementWindowMs: number;
  cpuToDeviceEnergyFactor: number;
  cpuActiveCores: number;
  resourceImpacts: ResourceImpact[];
}

export interface DeveloperSuggestion {
  rule: 'image-compression' | 'js-splitting' | 'third-party-review';
  message: string;
  resourceUrl?: string;
}

export interface ImpactTraceReport {
  swdm: SwdmReportBreakdown;
  cpu: CpuDetails;
  sources: ReportSources;
  networkBytes: number;
  topResources: ResourceImpact[];
  suggestions: DeveloperSuggestion[];
  modelInputs?: {
    cpuMeasurementMode?: CpuMeasurementMode;
    cpuCurveProfile?: CpuCurveProfileId;
    cpuCurveProfileCanonical?: Exclude<CpuCurveProfileId, 'if-default'>;
    cpuCurveSource?: ModelInputSource;
    cpuCurvePoints?: {
      x: number[];
      y: number[];
    };
    cpuPowerFactor?: number;
    cpuUtilizationPercent?: number;
    cpuMeasurementWindowMs?: number;
    cpuToDeviceEnergyFactor?: number;
    cpuToDeviceEnergyFactorBlended?: number;
    cpuToDeviceFactorSource?: CpuToDeviceFactorSource;
    deviceMixProfile?: DeviceMixProfileId;
    deviceMixProfileSource?: DeviceMixProfileSource;
    cpuToDeviceProfileFactors?: CpuDeviceProfileFactors;
    cpuToDeviceUsageWeights?: CpuDeviceUsageWeights;
    cpuActiveCores?: number;
    resolvedGridIntensity?: ResolvedGridIntensity;
    userDeviceOperationalSource?: 'co2-transfer' | 'cpu-profiler';
    greenHostingFactor?: number;
    greenHostingFactorSource?: ModelInputSource;
    returnVisitorRatio?: number;
    returnVisitorRatioSource?: ModelInputSource;
    newVisitorRatio?: number;
    dataCacheRatio?: number;
    dataCacheRatioSource?: ModelInputSource;
    repeatAveraging?: {
      repeat: number;
      warmup: number;
      averageMode: AverageMode;
      trimPercent: number;
      sampleCount: number;
    };
  };
  urlBreakdown?: UrlBreakdown[];
  comparison?: ComparisonReport;
}

export interface UrlBreakdown {
  url: string;
  swdm: SwdmReportBreakdown;
  cpu: CpuDetails;
  sources: ReportSources;
  networkBytes: number;
  topResources: ResourceImpact[];
  suggestions: DeveloperSuggestion[];
  modelInputs?: ImpactTraceReport['modelInputs'];
  comparison?: ComparisonReport;
}

export type ImpactScoreGrade = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface ImpactScoreThresholds {
  A: number;
  B: number;
  C: number;
  D: number;
  E: number;
}

export interface ImpactScoreResult {
  grade: ImpactScoreGrade;
  valueGrams: number;
  reason: string;
  thresholds: ImpactScoreThresholds;
}

export type ImpactCategory = 'video' | 'images' | 'javascript' | 'fonts' | 'thirdParty' | 'other';

export interface ImpactCategoryBreakdownItem {
  category: ImpactCategory;
  carbonGrams: number;
  percentage: number;
  topAssetUrl?: string;
  topAssetBytes?: number;
}

export type RecommendationEffort = 'low' | 'medium' | 'high';

export interface KeyFinding {
  id: string;
  title: string;
  category: ImpactCategory;
  assetUrl?: string;
  transferBytes?: number;
  carbonGrams?: number;
  recommendation: string;
  estimatedSavingGrams: number;
  priorityScore: number;
  confidence: number;
  effort: RecommendationEffort;
}

export interface SavingsItem {
  label: string;
  estimatedSavingGrams: number;
}

export interface SavingsSummary {
  items: SavingsItem[];
  totalEstimatedSavingGrams: number;
  totalEstimatedSavingPercent: number;
}

export interface CacheAssessment {
  firstVisitCarbonGrams: number;
  returningVisitCarbonGrams: number;
  reductionPercent: number;
  assessment: 'good' | 'moderate' | 'poor';
  message: string;
}

export interface ImpactBudgets {
  carbonGrams?: number;
  transferBytes?: number;
  cpuSeconds?: number;
  thirdPartyBytes?: number;
}

export type BudgetMetric = 'carbon' | 'transfer' | 'cpu' | 'thirdParty';
export type BudgetStatus = 'pass' | 'fail' | 'not-configured';

export interface BudgetResult {
  metric: BudgetMetric;
  actual: number;
  budget?: number;
  unit: 'g' | 'bytes' | 'seconds';
  status: BudgetStatus;
  delta?: number;
  deltaPercent?: number | null;
  baselineDelta?: number;
  baselineDeltaPercent?: number | null;
}

export interface CiSummary {
  carbonDeltaGrams?: number;
  carbonDeltaPercent?: number | null;
  transferDeltaBytes?: number;
  transferDeltaPercent?: number | null;
  largestContributor?: string;
  result: 'pass' | 'fail';
  summaryLine: string;
}

export interface DeveloperReportRepresentativeVisit {
  carbonGrams: number;
  transferBytes: number;
  cpuSeconds: number;
}

export interface DeveloperReport {
  score: ImpactScoreResult;
  representativeVisit: DeveloperReportRepresentativeVisit;
  status: string[];
  breakdown: ImpactCategoryBreakdownItem[];
  findings: KeyFinding[];
  savings: SavingsSummary;
  cache?: CacheAssessment;
  budgets: BudgetResult[];
  ciSummary?: CiSummary;
}

export interface DeveloperVerboseReport extends DeveloperReport {
  modelInternals: {
    swdm: SwdmReportBreakdown;
    cpu: CpuDetails;
    assumptions: NonNullable<ImpactTraceReport['modelInputs']>;
    sources: ReportSources;
  };
}

export interface ImpactTraceOutput {
  formatVersion: '2.0';
  generatedAt: string;
  raw: ImpactTraceReport;
  defaultView: DeveloperReport;
  ci: CiSummary;
  githubComment: string;
  verboseView?: DeveloperVerboseReport;
}

export type ReportingOutputFormat = 'console' | 'json' | 'github-pr';

export interface ReportingOutputSettings {
  defaultFormat?: ReportingOutputFormat;
  findingsLimit?: number;
  githubCommentMaxLines?: number;
}
