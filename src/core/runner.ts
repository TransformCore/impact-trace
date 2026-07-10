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
  setCpuMeasurementModeInContext,
  setRunLabelInContext,
} from '../plugins/browserPlugin.js';
import type {
  CarbonMetric,
  ComparisonDeltaReport,
  ComparisonReport,
  CpuCurveProfileId,
  CpuMeasurementMode,
  CpuDetails,
  EvidenceSourceId,
  GridIntensityConfig,
  ImpactTraceReport,
  JourneyFunction,
  MeasurementPlugin,
  ReportSources,
  RunContext,
  SwdmPercentBreakdown,
  SwdmReportBreakdown,
  VisitReport,
} from '../types/index.js';

export interface RunOptions {
  journeyScript?: string;
  url?: string;
  plugins: MeasurementPlugin[];
  workingDirectory?: string;
  compareCache?: boolean;
  clearCacheBeforeFirstRun?: boolean;
  cpuMeasurementSeconds?: number;
  cpuMode?: CpuMeasurementMode;
  cpuCurveProfile?: CpuCurveProfileId;
  disableCpuMeasurement?: boolean;
  gridIntensity?: GridIntensityConfig;
  greenHostingFactor?: number;
  returnVisitorRatio?: number;
  dataCacheRatio?: number;
}

export async function runJourneyWithPlugins(options: RunOptions): Promise<ImpactTraceReport> {
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const runtimeConfig = await resolveRuntimeConfig({ workingDirectory });
  const cpuMeasurementSeconds =
    options.cpuMeasurementSeconds && options.cpuMeasurementSeconds > 0
      ? options.cpuMeasurementSeconds
      : runtimeConfig.cpuMeasurementSeconds;
  const cpuMeasurementDurationMs = Math.round(cpuMeasurementSeconds * 1000);
  const cpuMode: CpuMeasurementMode = options.cpuMode ?? 'thread-time';
  const cpuCurveProfile: CpuCurveProfileId = options.cpuCurveProfile ?? runtimeConfig.cpuCurveProfile;
  const cpuCurveSource: 'default' | 'explicit' =
    options.cpuCurveProfile !== undefined ? 'explicit' : runtimeConfig.cpuCurveSource;
  const shouldMeasureCpu = !options.disableCpuMeasurement;
  const gridIntensity = mergeGridIntensityBySegment(runtimeConfig.gridIntensity, options.gridIntensity);
  const greenHostingFactor =
    options.greenHostingFactor !== undefined ? clampRatio(options.greenHostingFactor) : runtimeConfig.greenHostingFactor;
  const greenHostingFactorSource: 'default' | 'explicit' =
    options.greenHostingFactor !== undefined ? 'explicit' : runtimeConfig.greenHostingFactorSource;
  const returnVisitorRatio =
    options.returnVisitorRatio !== undefined
      ? clampRatio(options.returnVisitorRatio)
      : runtimeConfig.returnVisitorRatio;
  const returnVisitorRatioSource: 'default' | 'explicit' =
    options.returnVisitorRatio !== undefined ? 'explicit' : runtimeConfig.returnVisitorRatioSource;
  const explicitDataCacheRatio =
    options.dataCacheRatio !== undefined
      ? clampRatio(options.dataCacheRatio)
      : runtimeConfig.dataCacheRatio;
  const explicitDataCacheRatioSource: 'explicit' | undefined =
    options.dataCacheRatio !== undefined ? 'explicit' : runtimeConfig.dataCacheRatioSource;
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
  setCpuMeasurementModeInContext(context, cpuMode);

  try {
    const journey = await resolveJourney(options, journeyScriptPath);
    const page = getPageFromContext(context);

    if (options.compareCache) {
      if (options.clearCacheBeforeFirstRun ?? true) {
        await clearBrowserCacheFromContext(context);
      }

      if (shouldMeasureCpu) {
        await runWithCpuSamplingWindow(context, 'new-user', cpuMeasurementDurationMs, async () => {
          await journey(page);
        });

        await runWithCpuSamplingWindow(context, 'returning-user', cpuMeasurementDurationMs, async () => {
          await journey(page);
        });
      } else {
        setRunLabelInContext(context, 'new-user');
        await journey(page);
        setRunLabelInContext(context, 'returning-user');
        await journey(page);
      }
    } else {
      if (shouldMeasureCpu) {
        await runWithCpuSamplingWindow(context, 'single-run', cpuMeasurementDurationMs, async () => {
          await journey(page);
        });
      } else {
        setRunLabelInContext(context, 'single-run');
        await journey(page);
      }
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
    cpuCurveProfile,
    runtimeConfig.cpuCurvePoints,
    runtimeConfig.cpuToDeviceEnergyFactor,
    runtimeConfig.cpuActiveCores,
    cpuCurveSource,
    cpuMode,
    gridIntensity,
    greenHostingFactor,
    greenHostingFactorSource,
    returnVisitorRatio,
    returnVisitorRatioSource,
    explicitDataCacheRatio,
    explicitDataCacheRatioSource,
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
  cpuCurveProfile: CpuCurveProfileId,
  cpuCurvePoints: { x: number[]; y: number[] },
  cpuToDeviceEnergyFactor: number,
  cpuActiveCores: number,
  cpuCurveSource: 'default' | 'explicit',
  cpuMeasurementMode: CpuMeasurementMode,
  gridIntensity?: GridIntensityConfig,
  greenHostingFactor = 0,
  greenHostingFactorSource: 'default' | 'explicit' = 'default',
  returnVisitorRatio = 0.75,
  returnVisitorRatioSource: 'default' | 'explicit' = 'default',
  explicitDataCacheRatio?: number,
  explicitDataCacheRatioSource?: 'explicit',
): ImpactTraceReport {
  const clampedReturnVisitorRatio = clampRatio(returnVisitorRatio);
  const newVisitorRatio = 1 - clampedReturnVisitorRatio;

  if (!compareCache) {
    const estimate = estimateCarbon(metrics, {
      cpuWatts,
      cpuCurveProfile,
      cpuCurvePoints,
      cpuToDeviceEnergyFactor,
      cpuActiveCores,
      gridIntensity,
      greenHostingFactor,
    });

    const firstPartyDomain = getFirstPartyDomain(context);
    const suggestions = buildSuggestions(estimate.resourceImpacts, firstPartyDomain);
    const sources = buildReportSources(estimate, cpuWatts, greenHostingFactor);

    return {
      swdm: buildSwdmReportBreakdown(estimate.swdmSegments, estimate.userDeviceOperationalSource),
      cpu: buildCpuDetails(estimate),
      sources,
      networkBytes: estimate.networkBytes,
      topResources: estimate.resourceImpacts.slice(0, 5),
      suggestions,
      modelInputs: {
        cpuMeasurementMode,
        cpuCurveProfile,
        cpuCurveSource,
        cpuCurvePoints,
        cpuPowerFactor: estimate.cpuPowerFactor,
        cpuUtilizationPercent: estimate.cpuUtilizationPercent,
        cpuMeasurementWindowMs: estimate.cpuMeasurementWindowMs,
        cpuToDeviceEnergyFactor,
        cpuActiveCores,
        resolvedGridIntensity: estimate.resolvedGridIntensity,
        userDeviceOperationalSource: estimate.userDeviceOperationalSource,
        greenHostingFactor,
        greenHostingFactorSource,
        returnVisitorRatio: clampedReturnVisitorRatio,
        returnVisitorRatioSource,
        newVisitorRatio,
        ...(explicitDataCacheRatio !== undefined
          ? {
              dataCacheRatio: explicitDataCacheRatio,
              dataCacheRatioSource: explicitDataCacheRatioSource,
            }
          : {}),
      },
    };
  }

  const firstMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'new-user');
  const returningMetrics = metrics.filter((metric) => metric.metadata?.runLabel === 'returning-user');

  const firstEstimate = estimateCarbon(firstMetrics, {
    cpuWatts,
    cpuCurveProfile,
    cpuCurvePoints,
    cpuToDeviceEnergyFactor,
    cpuActiveCores,
    gridIntensity,
    greenHostingFactor,
  });
  const returningEstimate = estimateCarbon(returningMetrics, {
    cpuWatts,
    cpuCurveProfile,
    cpuCurvePoints,
    cpuToDeviceEnergyFactor,
    cpuActiveCores,
    gridIntensity,
    greenHostingFactor,
  });

  const derivedDataCacheRatio = deriveDataCacheRatio(
    firstEstimate.networkBytes,
    returningEstimate.networkBytes,
  );
  const dataCacheRatio = explicitDataCacheRatio ?? derivedDataCacheRatio;
  const dataCacheRatioSource: 'explicit' | 'derived' | undefined =
    explicitDataCacheRatio !== undefined
      ? explicitDataCacheRatioSource
      : dataCacheRatio !== undefined
        ? 'derived'
        : undefined;

  const firstPartyDomain = getFirstPartyDomain(context);
  const suggestions = buildSuggestions(firstEstimate.resourceImpacts, firstPartyDomain);

  const firstVisit = buildVisitReport(firstEstimate);
  const returningVisit = buildVisitReport(returningEstimate);
  const bytesDelta = returningVisit.networkBytes - firstVisit.networkBytes;
  const representativeVisit = buildRepresentativeVisit(
    firstEstimate,
    returningEstimate,
    newVisitorRatio,
    clampedReturnVisitorRatio,
  );
  const delta = buildComparisonDelta(firstVisit, returningVisit, bytesDelta);
  const comparison: ComparisonReport = {
    firstVisit,
    returningVisit,
    representativeVisit,
    delta,
  };
  const sources = buildReportSources(firstEstimate, cpuWatts, greenHostingFactor);

  return {
    swdm: firstVisit.swdm,
    cpu: firstVisit.cpu,
    sources,
    networkBytes: firstVisit.networkBytes,
    topResources: firstVisit.topResources,
    suggestions,
    modelInputs: {
      cpuMeasurementMode,
      cpuCurveProfile,
      cpuCurveSource,
      cpuCurvePoints,
      cpuPowerFactor: firstEstimate.cpuPowerFactor,
      cpuUtilizationPercent: firstEstimate.cpuUtilizationPercent,
      cpuMeasurementWindowMs: firstEstimate.cpuMeasurementWindowMs,
      cpuToDeviceEnergyFactor,
      cpuActiveCores,
      resolvedGridIntensity: firstEstimate.resolvedGridIntensity,
      userDeviceOperationalSource: firstEstimate.userDeviceOperationalSource,
      greenHostingFactor,
      greenHostingFactorSource,
      returnVisitorRatio: clampedReturnVisitorRatio,
      returnVisitorRatioSource,
      newVisitorRatio,
      dataCacheRatio,
      dataCacheRatioSource,
    },
    comparison,
  };
}

export function buildRepresentativeVisit(
  firstEstimate: ReturnType<typeof estimateCarbon>,
  returningEstimate: ReturnType<typeof estimateCarbon>,
  newVisitorRatio: number,
  returnVisitorRatio: number,
): NonNullable<ImpactTraceReport['comparison']>['representativeVisit'] {
  const blendedSwdmSegments = blendSwdmSegments(
    firstEstimate.swdmSegments,
    returningEstimate.swdmSegments,
    newVisitorRatio,
    returnVisitorRatio,
  );

  return {
    weights: {
      newVisitorRatio,
      returnVisitorRatio,
    },
    swdm: buildSwdmReportBreakdown(blendedSwdmSegments),
    cpu: {
      timeMs:
        firstEstimate.totalCpuTimeMs * newVisitorRatio +
        returningEstimate.totalCpuTimeMs * returnVisitorRatio,
      energyKwh:
        firstEstimate.totalCpuEnergyKwh * newVisitorRatio +
        returningEstimate.totalCpuEnergyKwh * returnVisitorRatio,
      carbonGrams:
        firstEstimate.totalCpuCarbonGrams * newVisitorRatio +
        returningEstimate.totalCpuCarbonGrams * returnVisitorRatio,
    },
    networkBytes:
      firstEstimate.networkBytes * newVisitorRatio +
      returningEstimate.networkBytes * returnVisitorRatio,
  };
}

function buildVisitReport(estimate: ReturnType<typeof estimateCarbon>): VisitReport {
  return {
    swdm: buildSwdmReportBreakdown(estimate.swdmSegments, estimate.userDeviceOperationalSource),
    cpu: buildCpuDetails(estimate),
    networkBytes: estimate.networkBytes,
    topResources: estimate.resourceImpacts.slice(0, 5),
  };
}

function buildCpuDetails(estimate: ReturnType<typeof estimateCarbon>): CpuDetails {
  return {
    timeMs: estimate.totalCpuTimeMs,
    energyKwh: estimate.totalCpuEnergyKwh,
    carbonGrams: estimate.totalCpuCarbonGrams,
    sourceId: toOperationalSourceId(estimate.userDeviceOperationalSource),
  };
}

function toOperationalSourceId(source: 'co2-transfer' | 'cpu-profiler'): EvidenceSourceId {
  return source === 'cpu-profiler' ? 'browser-cpu-profiler' : 'co2-transfer';
}

function buildSwdmReportBreakdown(
  segments: ReturnType<typeof estimateCarbon>['swdmSegments'],
  userDeviceOperationalSource: 'co2-transfer' | 'cpu-profiler' = 'co2-transfer',
): SwdmReportBreakdown {
  const dataCentersOperational = {
    carbonGrams: segments.dataCenters.operationalCarbonGrams,
    energyKwh: segments.dataCenters.operationalEnergyKwh,
    sourceId: 'co2-transfer',
  } as const;
  const networksOperational = {
    carbonGrams: segments.networks.operationalCarbonGrams,
    energyKwh: segments.networks.operationalEnergyKwh,
    sourceId: 'co2-transfer',
  } as const;
  const userDevicesOperational = {
    carbonGrams: segments.userDevices.operationalCarbonGrams,
    energyKwh: segments.userDevices.operationalEnergyKwh,
    sourceId: toOperationalSourceId(userDeviceOperationalSource),
  } as const;

  const dataCentersEmbodied = {
    carbonGrams: segments.dataCenters.embodiedCarbonGrams,
    energyKwh: segments.dataCenters.embodiedEnergyKwh,
    sourceId: 'co2-transfer',
  } as const;
  const networksEmbodied = {
    carbonGrams: segments.networks.embodiedCarbonGrams,
    energyKwh: segments.networks.embodiedEnergyKwh,
    sourceId: 'co2-transfer',
  } as const;
  const userDevicesEmbodied = {
    carbonGrams: segments.userDevices.embodiedCarbonGrams,
    energyKwh: segments.userDevices.embodiedEnergyKwh,
    sourceId: 'co2-transfer',
  } as const;

  const operationalTotal = {
    carbonGrams:
      dataCentersOperational.carbonGrams +
      networksOperational.carbonGrams +
      userDevicesOperational.carbonGrams,
    energyKwh:
      dataCentersOperational.energyKwh +
      networksOperational.energyKwh +
      userDevicesOperational.energyKwh,
  };

  const embodiedTotal = {
    carbonGrams:
      dataCentersEmbodied.carbonGrams +
      networksEmbodied.carbonGrams +
      userDevicesEmbodied.carbonGrams,
    energyKwh:
      dataCentersEmbodied.energyKwh +
      networksEmbodied.energyKwh +
      userDevicesEmbodied.energyKwh,
  };

  return {
    total: {
      carbonGrams: operationalTotal.carbonGrams + embodiedTotal.carbonGrams,
      energyKwh: operationalTotal.energyKwh + embodiedTotal.energyKwh,
    },
    operational: {
      total: operationalTotal,
      dataCenters: dataCentersOperational,
      networks: networksOperational,
      userDevices: userDevicesOperational,
    },
    embodied: {
      total: embodiedTotal,
      dataCenters: dataCentersEmbodied,
      networks: networksEmbodied,
      userDevices: userDevicesEmbodied,
    },
  };
}

function buildReportSources(
  estimate: ReturnType<typeof estimateCarbon>,
  cpuWatts: number,
  greenHostingFactor: number,
): ReportSources {
  return {
    'browser-cpu-profiler': {
      kind: 'cpu-profiler',
      cpuWatts,
      cpuCurveProfile: estimate.cpuCurveProfile,
      cpuCurvePoints: estimate.cpuCurvePoints,
      cpuPowerFactor: estimate.cpuPowerFactor,
      cpuUtilizationPercent: estimate.cpuUtilizationPercent,
      cpuMeasurementWindowMs: estimate.cpuMeasurementWindowMs,
      cpuToDeviceEnergyFactor: estimate.cpuToDeviceEnergyFactor,
      cpuActiveCores: estimate.cpuActiveCores,
    },
    'co2-transfer': {
      kind: 'transfer-model',
      model: 'swd-v4',
      greenHostingFactor,
      ...(estimate.resolvedGridIntensity ? { gridIntensity: estimate.resolvedGridIntensity } : {}),
    },
  };
}

function buildComparisonDelta(
  firstVisit: VisitReport,
  returningVisit: VisitReport,
  bytesDelta: number,
): ComparisonDeltaReport {
  return {
    absolute: {
      swdm: subtractSwdmBreakdown(returningVisit.swdm, firstVisit.swdm),
      cpu: {
        timeMs: returningVisit.cpu.timeMs - firstVisit.cpu.timeMs,
        energyKwh: returningVisit.cpu.energyKwh - firstVisit.cpu.energyKwh,
        carbonGrams: returningVisit.cpu.carbonGrams - firstVisit.cpu.carbonGrams,
      },
      networkBytes: bytesDelta,
    },
    percent: {
      swdm: buildSwdmPercentBreakdown(firstVisit.swdm, returningVisit.swdm),
      cpu: {
        time: calculatePercentChange(firstVisit.cpu.timeMs, returningVisit.cpu.timeMs),
        energy: calculatePercentChange(firstVisit.cpu.energyKwh, returningVisit.cpu.energyKwh),
        carbon: calculatePercentChange(firstVisit.cpu.carbonGrams, returningVisit.cpu.carbonGrams),
      },
      networkBytes: calculatePercentChange(firstVisit.networkBytes, returningVisit.networkBytes),
    },
  };
}

function subtractSwdmBreakdown(
  minuend: SwdmReportBreakdown,
  subtrahend: SwdmReportBreakdown,
): SwdmReportBreakdown {
  return {
    total: {
      carbonGrams: minuend.total.carbonGrams - subtrahend.total.carbonGrams,
      energyKwh: minuend.total.energyKwh - subtrahend.total.energyKwh,
    },
    operational: {
      total: {
        carbonGrams: minuend.operational.total.carbonGrams - subtrahend.operational.total.carbonGrams,
        energyKwh: minuend.operational.total.energyKwh - subtrahend.operational.total.energyKwh,
      },
      dataCenters: {
        carbonGrams:
          minuend.operational.dataCenters.carbonGrams - subtrahend.operational.dataCenters.carbonGrams,
        energyKwh: minuend.operational.dataCenters.energyKwh - subtrahend.operational.dataCenters.energyKwh,
      },
      networks: {
        carbonGrams: minuend.operational.networks.carbonGrams - subtrahend.operational.networks.carbonGrams,
        energyKwh: minuend.operational.networks.energyKwh - subtrahend.operational.networks.energyKwh,
      },
      userDevices: {
        carbonGrams:
          minuend.operational.userDevices.carbonGrams - subtrahend.operational.userDevices.carbonGrams,
        energyKwh: minuend.operational.userDevices.energyKwh - subtrahend.operational.userDevices.energyKwh,
      },
    },
    embodied: {
      total: {
        carbonGrams: minuend.embodied.total.carbonGrams - subtrahend.embodied.total.carbonGrams,
        energyKwh: minuend.embodied.total.energyKwh - subtrahend.embodied.total.energyKwh,
      },
      dataCenters: {
        carbonGrams: minuend.embodied.dataCenters.carbonGrams - subtrahend.embodied.dataCenters.carbonGrams,
        energyKwh: minuend.embodied.dataCenters.energyKwh - subtrahend.embodied.dataCenters.energyKwh,
      },
      networks: {
        carbonGrams: minuend.embodied.networks.carbonGrams - subtrahend.embodied.networks.carbonGrams,
        energyKwh: minuend.embodied.networks.energyKwh - subtrahend.embodied.networks.energyKwh,
      },
      userDevices: {
        carbonGrams: minuend.embodied.userDevices.carbonGrams - subtrahend.embodied.userDevices.carbonGrams,
        energyKwh: minuend.embodied.userDevices.energyKwh - subtrahend.embodied.userDevices.energyKwh,
      },
    },
  };
}

function buildSwdmPercentBreakdown(
  first: SwdmReportBreakdown,
  returning: SwdmReportBreakdown,
): SwdmPercentBreakdown {
  return {
    total: {
      carbon: calculatePercentChange(first.total.carbonGrams, returning.total.carbonGrams),
      energy: calculatePercentChange(first.total.energyKwh, returning.total.energyKwh),
    },
    operational: {
      total: {
        carbon: calculatePercentChange(first.operational.total.carbonGrams, returning.operational.total.carbonGrams),
        energy: calculatePercentChange(first.operational.total.energyKwh, returning.operational.total.energyKwh),
      },
      dataCenters: {
        carbon: calculatePercentChange(
          first.operational.dataCenters.carbonGrams,
          returning.operational.dataCenters.carbonGrams,
        ),
        energy: calculatePercentChange(
          first.operational.dataCenters.energyKwh,
          returning.operational.dataCenters.energyKwh,
        ),
      },
      networks: {
        carbon: calculatePercentChange(
          first.operational.networks.carbonGrams,
          returning.operational.networks.carbonGrams,
        ),
        energy: calculatePercentChange(
          first.operational.networks.energyKwh,
          returning.operational.networks.energyKwh,
        ),
      },
      userDevices: {
        carbon: calculatePercentChange(
          first.operational.userDevices.carbonGrams,
          returning.operational.userDevices.carbonGrams,
        ),
        energy: calculatePercentChange(
          first.operational.userDevices.energyKwh,
          returning.operational.userDevices.energyKwh,
        ),
      },
    },
    embodied: {
      total: {
        carbon: calculatePercentChange(first.embodied.total.carbonGrams, returning.embodied.total.carbonGrams),
        energy: calculatePercentChange(first.embodied.total.energyKwh, returning.embodied.total.energyKwh),
      },
      dataCenters: {
        carbon: calculatePercentChange(first.embodied.dataCenters.carbonGrams, returning.embodied.dataCenters.carbonGrams),
        energy: calculatePercentChange(first.embodied.dataCenters.energyKwh, returning.embodied.dataCenters.energyKwh),
      },
      networks: {
        carbon: calculatePercentChange(first.embodied.networks.carbonGrams, returning.embodied.networks.carbonGrams),
        energy: calculatePercentChange(first.embodied.networks.energyKwh, returning.embodied.networks.energyKwh),
      },
      userDevices: {
        carbon: calculatePercentChange(first.embodied.userDevices.carbonGrams, returning.embodied.userDevices.carbonGrams),
        energy: calculatePercentChange(first.embodied.userDevices.energyKwh, returning.embodied.userDevices.energyKwh),
      },
    },
  };
}

function blendSwdmSegments(
  first: ReturnType<typeof estimateCarbon>['swdmSegments'],
  returning: ReturnType<typeof estimateCarbon>['swdmSegments'],
  firstWeight: number,
  returningWeight: number,
): ReturnType<typeof estimateCarbon>['swdmSegments'] {
  return {
    dataCenters: {
      operationalCarbonGrams:
        first.dataCenters.operationalCarbonGrams * firstWeight +
        returning.dataCenters.operationalCarbonGrams * returningWeight,
      embodiedCarbonGrams:
        first.dataCenters.embodiedCarbonGrams * firstWeight +
        returning.dataCenters.embodiedCarbonGrams * returningWeight,
      operationalEnergyKwh:
        first.dataCenters.operationalEnergyKwh * firstWeight +
        returning.dataCenters.operationalEnergyKwh * returningWeight,
      embodiedEnergyKwh:
        first.dataCenters.embodiedEnergyKwh * firstWeight +
        returning.dataCenters.embodiedEnergyKwh * returningWeight,
    },
    networks: {
      operationalCarbonGrams:
        first.networks.operationalCarbonGrams * firstWeight +
        returning.networks.operationalCarbonGrams * returningWeight,
      embodiedCarbonGrams:
        first.networks.embodiedCarbonGrams * firstWeight +
        returning.networks.embodiedCarbonGrams * returningWeight,
      operationalEnergyKwh:
        first.networks.operationalEnergyKwh * firstWeight +
        returning.networks.operationalEnergyKwh * returningWeight,
      embodiedEnergyKwh:
        first.networks.embodiedEnergyKwh * firstWeight +
        returning.networks.embodiedEnergyKwh * returningWeight,
    },
    userDevices: {
      operationalCarbonGrams:
        first.userDevices.operationalCarbonGrams * firstWeight +
        returning.userDevices.operationalCarbonGrams * returningWeight,
      embodiedCarbonGrams:
        first.userDevices.embodiedCarbonGrams * firstWeight +
        returning.userDevices.embodiedCarbonGrams * returningWeight,
      operationalEnergyKwh:
        first.userDevices.operationalEnergyKwh * firstWeight +
        returning.userDevices.operationalEnergyKwh * returningWeight,
      embodiedEnergyKwh:
        first.userDevices.embodiedEnergyKwh * firstWeight +
        returning.userDevices.embodiedEnergyKwh * returningWeight,
    },
  };
}

export function deriveDataCacheRatio(firstBytes: number, returningBytes: number): number {
  if (!Number.isFinite(firstBytes) || firstBytes <= 0) {
    return 0;
  }

  return clampRatio(1 - returningBytes / firstBytes);
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

function mergeGridIntensityBySegment(
  base?: GridIntensityConfig,
  overrides?: GridIntensityConfig,
): GridIntensityConfig | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  const merged: GridIntensityConfig = {
    ...(base ?? {}),
    ...(overrides ?? {}),
  };

  if (merged.device === undefined && merged.network === undefined && merged.dataCenter === undefined) {
    return undefined;
  }

  return merged;
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
      await page.goto(parsedUrl.href, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
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
