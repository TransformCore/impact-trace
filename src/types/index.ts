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

export interface CarbonEstimate {
  totalEnergyKwh: number;
  totalCarbonGrams: number;
  networkBytes: number;
  resourceImpacts: ResourceImpact[];
}

export interface DeveloperSuggestion {
  rule: 'image-compression' | 'js-splitting' | 'third-party-review';
  message: string;
  resourceUrl?: string;
}

export interface ImpactTraceReport {
  totalCarbonGrams: number;
  totalEnergyKwh: number;
  networkBytes: number;
  topResources: ResourceImpact[];
  suggestions: DeveloperSuggestion[];
  urlBreakdown?: UrlBreakdown[];
  comparison?: {
    firstVisit: {
      totalCarbonGrams: number;
      totalEnergyKwh: number;
      networkBytes: number;
      topResources: ResourceImpact[];
    };
    returningVisit: {
      totalCarbonGrams: number;
      totalEnergyKwh: number;
      networkBytes: number;
      topResources: ResourceImpact[];
    };
    delta: {
      carbonGrams: number;
      energyKwh: number;
      networkBytes: number;
      carbonPercent: number | null;
      energyPercent: number | null;
      networkPercent: number | null;
    };
  };
}

export interface UrlBreakdown {
  url: string;
  totalCarbonGrams: number;
  totalEnergyKwh: number;
  networkBytes: number;
  topResources: ResourceImpact[];
  suggestions: DeveloperSuggestion[];
  comparison?: ImpactTraceReport['comparison'];
}
