import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PluginSystem } from './plugin-system.js';
import { estimateCarbon } from '../models/carbonModel.js';
import { resolveRuntimeConfig } from './config.js';
import { buildSuggestions } from '../models/insights.js';
import {
  beginCpuMeasurementForRunLabel,
  clearBrowserCacheFromContext,
  endCpuMeasurementForRunLabel,
  getPageFromContext,
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
  cpuMeasurementSeconds?: number;
}

export async function runJourneyWithPlugins(options: RunOptions): Promise<ImpactTraceReport> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const runtimeConfig = await resolveRuntimeConfig({ workingDirectory });
  const cpuMeasurementSeconds =
    options.cpuMeasurementSeconds && options.cpuMeasurementSeconds > 0
      ? options.cpuMeasurementSeconds
      : runtimeConfig.cpuMeasurementSeconds;
  const cpuMeasurementDurationMs = Math.round(cpuMeasurementSeconds * 1000);
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

      await runWithCpuSamplingWindow(context, 'new-user', cpuMeasurementDurationMs, async () => {
        await journey(page);
      });

      await runWithCpuSamplingWindow(context, 'returning-user', cpuMeasurementDurationMs, async () => {
        await journey(page);
      });
    } else {
      await runWithCpuSamplingWindow(context, 'single-run', cpuMeasurementDurationMs, async () => {
        await journey(page);
      });
    }
  } catch (error) {
    executionError = error;
  }

  const metrics = await pluginSystem.stopAll();
  const report = buildReportFromMetrics(
    metrics,
    context,
    options.compareCache ?? false,
    runtimeConfig.cpuWatts,
  );

  if (executionError) {
    throw executionError;
  }

  return report;
}

async function runWithCpuSamplingWindow(
  context: RunContext,
  label: 'single-run' | 'new-user' | 'returning-user',
  minimumDurationMs: number,
  runJourney: () => Promise<void>,
): Promise<void> {
  await beginCpuMeasurementForRunLabel(context, label);
  const startedAt = Date.now();

  try {
    await runJourney();

    const elapsedMs = Date.now() - startedAt;
    const remainingMs = minimumDurationMs - elapsedMs;
    if (remainingMs > 0) {
      await wait(remainingMs);
    }
  } finally {
    await endCpuMeasurementForRunLabel(context, label);
  }
}

async function wait(durationMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function buildReportFromMetrics(
  metrics: CarbonMetric[],
  context: RunContext,
  compareCache: boolean,
  cpuWatts: number,
): ImpactTraceReport {
  if (!compareCache) {
    const estimate = estimateCarbon(metrics, { cpuWatts });

    const firstPartyDomain = getFirstPartyDomain(context);
    const suggestions = buildSuggestions(estimate.resourceImpacts, firstPartyDomain);

    return {
      totalCarbonGrams: estimate.totalCarbonGrams,
      totalEnergyKwh: estimate.totalEnergyKwh,
      networkCarbonGrams: estimate.totalNetworkCarbonGrams,
      networkEnergyKwh: estimate.totalNetworkEnergyKwh,
      cpuTimeMs: estimate.totalCpuTimeMs,
      cpuEnergyKwh: estimate.totalCpuEnergyKwh,
      cpuCarbonGrams: estimate.totalCpuCarbonGrams,
      networkBytes: estimate.networkBytes,
      topResources: estimate.resourceImpacts.slice(0, 5),
      suggestions,
    };
  }

  const firstMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'new-user');
  const returningMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'returning-user');

  const firstEstimate = estimateCarbon(firstMetrics, { cpuWatts });
  const returningEstimate = estimateCarbon(returningMetrics, { cpuWatts });

  const firstPartyDomain = getFirstPartyDomain(context);
  const suggestions = buildSuggestions(firstEstimate.resourceImpacts, firstPartyDomain);

  const carbonDelta = returningEstimate.totalCarbonGrams - firstEstimate.totalCarbonGrams;
  const energyDelta = returningEstimate.totalEnergyKwh - firstEstimate.totalEnergyKwh;
  const networkCarbonDelta =
    returningEstimate.totalNetworkCarbonGrams - firstEstimate.totalNetworkCarbonGrams;
  const networkEnergyDelta =
    returningEstimate.totalNetworkEnergyKwh - firstEstimate.totalNetworkEnergyKwh;
  const cpuTimeDelta = returningEstimate.totalCpuTimeMs - firstEstimate.totalCpuTimeMs;
  const cpuEnergyDelta = returningEstimate.totalCpuEnergyKwh - firstEstimate.totalCpuEnergyKwh;
  const cpuCarbonDelta = returningEstimate.totalCpuCarbonGrams - firstEstimate.totalCpuCarbonGrams;
  const bytesDelta = returningEstimate.networkBytes - firstEstimate.networkBytes;

  return {
    totalCarbonGrams: firstEstimate.totalCarbonGrams,
    totalEnergyKwh: firstEstimate.totalEnergyKwh,
    networkCarbonGrams: firstEstimate.totalNetworkCarbonGrams,
    networkEnergyKwh: firstEstimate.totalNetworkEnergyKwh,
    cpuTimeMs: firstEstimate.totalCpuTimeMs,
    cpuEnergyKwh: firstEstimate.totalCpuEnergyKwh,
    cpuCarbonGrams: firstEstimate.totalCpuCarbonGrams,
    networkBytes: firstEstimate.networkBytes,
    topResources: firstEstimate.resourceImpacts.slice(0, 5),
    suggestions,
    comparison: {
      firstVisit: {
        totalCarbonGrams: firstEstimate.totalCarbonGrams,
        totalEnergyKwh: firstEstimate.totalEnergyKwh,
        networkCarbonGrams: firstEstimate.totalNetworkCarbonGrams,
        networkEnergyKwh: firstEstimate.totalNetworkEnergyKwh,
        cpuTimeMs: firstEstimate.totalCpuTimeMs,
        cpuEnergyKwh: firstEstimate.totalCpuEnergyKwh,
        cpuCarbonGrams: firstEstimate.totalCpuCarbonGrams,
        networkBytes: firstEstimate.networkBytes,
        topResources: firstEstimate.resourceImpacts.slice(0, 5),
      },
      returningVisit: {
        totalCarbonGrams: returningEstimate.totalCarbonGrams,
        totalEnergyKwh: returningEstimate.totalEnergyKwh,
        networkCarbonGrams: returningEstimate.totalNetworkCarbonGrams,
        networkEnergyKwh: returningEstimate.totalNetworkEnergyKwh,
        cpuTimeMs: returningEstimate.totalCpuTimeMs,
        cpuEnergyKwh: returningEstimate.totalCpuEnergyKwh,
        cpuCarbonGrams: returningEstimate.totalCpuCarbonGrams,
        networkBytes: returningEstimate.networkBytes,
        topResources: returningEstimate.resourceImpacts.slice(0, 5),
      },
      delta: {
        carbonGrams: carbonDelta,
        energyKwh: energyDelta,
        networkCarbonGrams: networkCarbonDelta,
        networkEnergyKwh: networkEnergyDelta,
        cpuTimeMs: cpuTimeDelta,
        cpuEnergyKwh: cpuEnergyDelta,
        cpuCarbonGrams: cpuCarbonDelta,
        networkBytes: bytesDelta,
        carbonPercent: calculatePercentChange(firstEstimate.totalCarbonGrams, returningEstimate.totalCarbonGrams),
        energyPercent: calculatePercentChange(firstEstimate.totalEnergyKwh, returningEstimate.totalEnergyKwh),
        networkCarbonPercent: calculatePercentChange(
          firstEstimate.totalNetworkCarbonGrams,
          returningEstimate.totalNetworkCarbonGrams,
        ),
        networkEnergyPercent: calculatePercentChange(
          firstEstimate.totalNetworkEnergyKwh,
          returningEstimate.totalNetworkEnergyKwh,
        ),
        cpuTimePercent: calculatePercentChange(firstEstimate.totalCpuTimeMs, returningEstimate.totalCpuTimeMs),
        cpuEnergyPercent: calculatePercentChange(
          firstEstimate.totalCpuEnergyKwh,
          returningEstimate.totalCpuEnergyKwh,
        ),
        cpuCarbonPercent: calculatePercentChange(
          firstEstimate.totalCpuCarbonGrams,
          returningEstimate.totalCpuCarbonGrams,
        ),
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
