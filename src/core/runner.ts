import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginSystem } from './plugin-system.js';
import { estimateCarbon } from '../models/carbonModel.js';
import { buildSuggestions } from '../models/insights.js';
import {
  clearBrowserCacheFromContext,
  getPageFromContext,
  setRunLabelInContext,
} from '../plugins/browserPlugin.js';
import type {
  CarbonMetric,
  ImpactTraceReport,
  JourneyFunction,
  MeasurementPlugin,
  RunContext,
} from '../types/index.js';

export interface RunOptions {
  journeyScript?: string;
  url?: string;
  plugins: MeasurementPlugin[];
  workingDirectory?: string;
  compareCache?: boolean;
  clearCacheBeforeFirstRun?: boolean;
}

export async function runJourneyWithPlugins(options: RunOptions): Promise<ImpactTraceReport> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const journeyScriptPath = options.journeyScript
    ? path.resolve(workingDirectory, options.journeyScript)
    : path.resolve(workingDirectory, '.');

  const context: RunContext = {
    workingDirectory,
    journeyScriptPath,
    startedAt: Date.now(),
    data: new Map<string, unknown>(),
  };

  const pluginSystem = new PluginSystem(options.plugins);

  let executionError: unknown;
  await pluginSystem.startAll(context);

  try {
    const journey = await resolveJourney(options, journeyScriptPath);
    const page = getPageFromContext(context);

    if (options.compareCache) {
      if (options.clearCacheBeforeFirstRun ?? true) {
        await clearBrowserCacheFromContext(context);
      }

      setRunLabelInContext(context, 'new-user');
      await journey(page);

      setRunLabelInContext(context, 'returning-user');
      await journey(page);
    } else {
      setRunLabelInContext(context, 'single-run');
      await journey(page);
    }
  } catch (error) {
    executionError = error;
  }

  const metrics = await pluginSystem.stopAll();
  const report = buildReportFromMetrics(metrics, context, options.compareCache ?? false);

  if (executionError) {
    throw executionError;
  }

  return report;
}

function buildReportFromMetrics(
  metrics: CarbonMetric[],
  context: RunContext,
  compareCache: boolean,
): ImpactTraceReport {
  if (!compareCache) {
    const estimate = estimateCarbon(metrics);

    const firstPartyDomain = getFirstPartyDomain(context);
    const suggestions = buildSuggestions(estimate.resourceImpacts, firstPartyDomain);

    return {
      totalCarbonGrams: estimate.totalCarbonGrams,
      totalEnergyKwh: estimate.totalEnergyKwh,
      networkBytes: estimate.networkBytes,
      topResources: estimate.resourceImpacts.slice(0, 5),
      suggestions,
    };
  }

  const firstMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'new-user');
  const returningMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'returning-user');

  const firstEstimate = estimateCarbon(firstMetrics);
  const returningEstimate = estimateCarbon(returningMetrics);

  const firstPartyDomain = getFirstPartyDomain(context);
  const suggestions = buildSuggestions(firstEstimate.resourceImpacts, firstPartyDomain);

  const carbonDelta = returningEstimate.totalCarbonGrams - firstEstimate.totalCarbonGrams;
  const energyDelta = returningEstimate.totalEnergyKwh - firstEstimate.totalEnergyKwh;
  const bytesDelta = returningEstimate.networkBytes - firstEstimate.networkBytes;

  return {
    totalCarbonGrams: firstEstimate.totalCarbonGrams,
    totalEnergyKwh: firstEstimate.totalEnergyKwh,
    networkBytes: firstEstimate.networkBytes,
    topResources: firstEstimate.resourceImpacts.slice(0, 5),
    suggestions,
    comparison: {
      firstVisit: {
        totalCarbonGrams: firstEstimate.totalCarbonGrams,
        totalEnergyKwh: firstEstimate.totalEnergyKwh,
        networkBytes: firstEstimate.networkBytes,
        topResources: firstEstimate.resourceImpacts.slice(0, 5),
      },
      returningVisit: {
        totalCarbonGrams: returningEstimate.totalCarbonGrams,
        totalEnergyKwh: returningEstimate.totalEnergyKwh,
        networkBytes: returningEstimate.networkBytes,
        topResources: returningEstimate.resourceImpacts.slice(0, 5),
      },
      delta: {
        carbonGrams: carbonDelta,
        energyKwh: energyDelta,
        networkBytes: bytesDelta,
        carbonPercent: calculatePercentChange(firstEstimate.totalCarbonGrams, returningEstimate.totalCarbonGrams),
        energyPercent: calculatePercentChange(firstEstimate.totalEnergyKwh, returningEstimate.totalEnergyKwh),
        networkPercent: calculatePercentChange(firstEstimate.networkBytes, returningEstimate.networkBytes),
      },
    },
  };
}

function calculatePercentChange(baseValue: number, nextValue: number): number | null {
  if (baseValue === 0) {
    return null;
  }
  return ((nextValue - baseValue) / baseValue) * 100;
}

async function loadJourney(journeyScriptPath: string): Promise<JourneyFunction> {
  const moduleUrl = pathToFileURL(journeyScriptPath).href;
  const loaded = await import(moduleUrl);
  const journey = loaded.default as JourneyFunction | undefined;

  if (typeof journey !== 'function') {
    throw new Error(`Journey script must export a default async function(page). Received: ${typeof journey}`);
  }

  return journey;
}

async function resolveJourney(options: RunOptions, journeyScriptPath: string): Promise<JourneyFunction> {
  if (options.journeyScript) {
    return loadJourney(journeyScriptPath);
  }

  if (options.url) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch {
      throw new Error(`Invalid URL provided: ${options.url}`);
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
    }

    return async (page) => {
      await page.goto(parsedUrl.href);
    };
  }

  throw new Error('Either journeyScript or url must be provided.');
}

function getFirstPartyDomain(context: RunContext): string | undefined {
  try {
    const page = getPageFromContext(context);
    const currentUrl = page.url();
    if (!currentUrl) {
      return undefined;
    }

    return new URL(currentUrl).hostname;
  } catch {
    return undefined;
  }
}
