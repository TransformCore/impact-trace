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
export type CpuCurveProfileId = 'if-default' | 'linear';

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
    cpuCurveSource?: ModelInputSource;
    cpuCurvePoints?: {
      x: number[];
      y: number[];
    };
    cpuPowerFactor?: number;
    cpuUtilizationPercent?: number;
    cpuMeasurementWindowMs?: number;
    cpuToDeviceEnergyFactor?: number;
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
