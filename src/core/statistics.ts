import type {
  AverageMode,
  ComparisonReport,
  ImpactTraceReport,
  ResourceImpact,
  SwdmPercentBreakdown,
  SwdmReportBreakdown,
} from '../types/index.js';

interface RepeatAveragingOptions {
  mode: AverageMode;
  trimPercent: number;
}

interface RepeatAveragingMeta {
  repeat: number;
  warmup: number;
  averageMode: AverageMode;
  trimPercent: number;
  sampleCount: number;
}

export function aggregateReportsForRepeats(
  reports: ImpactTraceReport[],
  options: RepeatAveragingOptions,
  meta: RepeatAveragingMeta,
): ImpactTraceReport {
  if (reports.length === 0) {
    throw new Error('Cannot aggregate empty report set.');
  }

  const first = reports[0];
  const topResources = mergeAndAverageTopResources(reports.map((report) => report.topResources), options, 5);
  const suggestions = dedupeSuggestions(reports.flatMap((report) => report.suggestions));

  const aggregated: ImpactTraceReport = {
    swdm: averageSwdmBreakdown(reports.map((report) => report.swdm), options),
    cpu: averageCpuDetails(reports.map((report) => report.cpu), options),
    sources: first.sources,
    networkBytes: averageByMode(reports.map((report) => report.networkBytes), options),
    topResources,
    suggestions,
    modelInputs: {
      ...(first.modelInputs ?? {}),
      repeatAveraging: meta,
    },
    urlBreakdown: first.urlBreakdown,
  };

  const comparable = reports.every((report) => report.comparison);
  if (comparable) {
    const comparisonReports = reports.map((report) => report.comparison!);
    const firstVisit = averageVisitReports(comparisonReports.map((report) => report.firstVisit), options);
    const returningVisit = averageVisitReports(comparisonReports.map((report) => report.returningVisit), options);

    const representativeVisit = comparisonReports.every((report) => report.representativeVisit)
      ? {
          weights: {
            newVisitorRatio: averageByMode(
              comparisonReports.map((report) => report.representativeVisit!.weights.newVisitorRatio),
              options,
            ),
            returnVisitorRatio: averageByMode(
              comparisonReports.map((report) => report.representativeVisit!.weights.returnVisitorRatio),
              options,
            ),
          },
          swdm: averageSwdmBreakdown(
            comparisonReports.map((report) => report.representativeVisit!.swdm),
            options,
          ),
          cpu: averageCpuDetails(
            comparisonReports.map((report) => report.representativeVisit!.cpu),
            options,
          ),
          networkBytes: averageByMode(
            comparisonReports.map((report) => report.representativeVisit!.networkBytes),
            options,
          ),
        }
      : undefined;

    const delta = {
      absolute: {
        swdm: subtractSwdmBreakdown(returningVisit.swdm, firstVisit.swdm),
        cpu: {
          timeMs: returningVisit.cpu.timeMs - firstVisit.cpu.timeMs,
          energyKwh: returningVisit.cpu.energyKwh - firstVisit.cpu.energyKwh,
          carbonGrams: returningVisit.cpu.carbonGrams - firstVisit.cpu.carbonGrams,
        },
        networkBytes: returningVisit.networkBytes - firstVisit.networkBytes,
      },
      percent: {
        swdm: buildSwdmPercentBreakdown(firstVisit.swdm, returningVisit.swdm),
        cpu: {
          time: percent(firstVisit.cpu.timeMs, returningVisit.cpu.timeMs),
          energy: percent(firstVisit.cpu.energyKwh, returningVisit.cpu.energyKwh),
          carbon: percent(firstVisit.cpu.carbonGrams, returningVisit.cpu.carbonGrams),
        },
        networkBytes: percent(firstVisit.networkBytes, returningVisit.networkBytes),
      },
    };

    aggregated.comparison = {
      firstVisit,
      returningVisit,
      representativeVisit,
      delta,
    };

    aggregated.swdm = firstVisit.swdm;
    aggregated.cpu = firstVisit.cpu;
    aggregated.networkBytes = firstVisit.networkBytes;
    aggregated.topResources = firstVisit.topResources;
  }

  return aggregated;
}

export function normalizeTrimPercent(trimPercent: number): number {
  if (!Number.isFinite(trimPercent)) {
    return 0.2;
  }

  if (trimPercent < 0) {
    return 0;
  }

  if (trimPercent > 0.5) {
    return 0.5;
  }

  return trimPercent;
}

function averageByMode(values: number[], options: RepeatAveragingOptions): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  if (options.mode === 'median') {
    return median(sorted);
  }

  if (options.mode === 'trimmed-mean') {
    const trimPercent = normalizeTrimPercent(options.trimPercent);
    const trimCount = Math.floor(sorted.length * trimPercent);
    const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
    return mean(trimmed.length > 0 ? trimmed : sorted);
  }

  return mean(sorted);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(sortedValues: number[]): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const middle = Math.floor(sortedValues.length / 2);
  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  return sortedValues[middle];
}

function averageCpuDetails(
  values: Array<ImpactTraceReport['cpu']>,
  options: RepeatAveragingOptions,
): ImpactTraceReport['cpu'] {
  return {
    timeMs: averageByMode(values.map((value) => value.timeMs), options),
    energyKwh: averageByMode(values.map((value) => value.energyKwh), options),
    carbonGrams: averageByMode(values.map((value) => value.carbonGrams), options),
    sourceId: values[0]?.sourceId,
  };
}

function averageSwdmBreakdown(
  values: SwdmReportBreakdown[],
  options: RepeatAveragingOptions,
): SwdmReportBreakdown {
  return {
    total: {
      carbonGrams: averageByMode(values.map((value) => value.total.carbonGrams), options),
      energyKwh: averageByMode(values.map((value) => value.total.energyKwh), options),
    },
    operational: {
      total: {
        carbonGrams: averageByMode(values.map((value) => value.operational.total.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.operational.total.energyKwh), options),
      },
      dataCenters: {
        carbonGrams: averageByMode(values.map((value) => value.operational.dataCenters.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.operational.dataCenters.energyKwh), options),
        sourceId: values[0]?.operational.dataCenters.sourceId,
      },
      networks: {
        carbonGrams: averageByMode(values.map((value) => value.operational.networks.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.operational.networks.energyKwh), options),
        sourceId: values[0]?.operational.networks.sourceId,
      },
      userDevices: {
        carbonGrams: averageByMode(values.map((value) => value.operational.userDevices.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.operational.userDevices.energyKwh), options),
        sourceId: values[0]?.operational.userDevices.sourceId,
      },
    },
    embodied: {
      total: {
        carbonGrams: averageByMode(values.map((value) => value.embodied.total.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.embodied.total.energyKwh), options),
      },
      dataCenters: {
        carbonGrams: averageByMode(values.map((value) => value.embodied.dataCenters.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.embodied.dataCenters.energyKwh), options),
        sourceId: values[0]?.embodied.dataCenters.sourceId,
      },
      networks: {
        carbonGrams: averageByMode(values.map((value) => value.embodied.networks.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.embodied.networks.energyKwh), options),
        sourceId: values[0]?.embodied.networks.sourceId,
      },
      userDevices: {
        carbonGrams: averageByMode(values.map((value) => value.embodied.userDevices.carbonGrams), options),
        energyKwh: averageByMode(values.map((value) => value.embodied.userDevices.energyKwh), options),
        sourceId: values[0]?.embodied.userDevices.sourceId,
      },
    },
  };
}

function averageVisitReports(
  values: ComparisonReport['firstVisit'][],
  options: RepeatAveragingOptions,
): ComparisonReport['firstVisit'] {
  return {
    swdm: averageSwdmBreakdown(values.map((value) => value.swdm), options),
    cpu: averageCpuDetails(values.map((value) => value.cpu), options),
    networkBytes: averageByMode(values.map((value) => value.networkBytes), options),
    topResources: mergeAndAverageTopResources(values.map((value) => value.topResources), options, 5),
  };
}

function mergeAndAverageTopResources(
  resourceLists: ResourceImpact[][],
  options: RepeatAveragingOptions,
  limit: number,
): ResourceImpact[] {
  const grouped = new Map<string, ResourceImpact[]>();

  for (const resources of resourceLists) {
    for (const resource of resources) {
      const key = `${resource.url}::${resource.resourceType ?? 'unknown'}`;
      const current = grouped.get(key) ?? [];
      current.push(resource);
      grouped.set(key, current);
    }
  }

  const averaged: ResourceImpact[] = [];
  for (const group of grouped.values()) {
    const first = group[0];
    averaged.push({
      url: first.url,
      resourceType: first.resourceType,
      cached: first.cached,
      networkBytes: averageByMode(group.map((resource) => resource.networkBytes), options),
      energyKwh: averageByMode(group.map((resource) => resource.energyKwh), options),
      carbonGrams: averageByMode(group.map((resource) => resource.carbonGrams), options),
    });
  }

  return averaged.sort((a, b) => b.carbonGrams - a.carbonGrams).slice(0, limit);
}

function dedupeSuggestions(suggestions: ImpactTraceReport['suggestions']): ImpactTraceReport['suggestions'] {
  const seen = new Set<string>();
  const deduped: ImpactTraceReport['suggestions'] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.rule}:${suggestion.resourceUrl ?? ''}:${suggestion.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(suggestion);
  }

  return deduped;
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
        carbonGrams: minuend.operational.dataCenters.carbonGrams - subtrahend.operational.dataCenters.carbonGrams,
        energyKwh: minuend.operational.dataCenters.energyKwh - subtrahend.operational.dataCenters.energyKwh,
      },
      networks: {
        carbonGrams: minuend.operational.networks.carbonGrams - subtrahend.operational.networks.carbonGrams,
        energyKwh: minuend.operational.networks.energyKwh - subtrahend.operational.networks.energyKwh,
      },
      userDevices: {
        carbonGrams: minuend.operational.userDevices.carbonGrams - subtrahend.operational.userDevices.carbonGrams,
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
  next: SwdmReportBreakdown,
): SwdmPercentBreakdown {
  return {
    total: {
      carbon: percent(first.total.carbonGrams, next.total.carbonGrams),
      energy: percent(first.total.energyKwh, next.total.energyKwh),
    },
    operational: {
      total: {
        carbon: percent(first.operational.total.carbonGrams, next.operational.total.carbonGrams),
        energy: percent(first.operational.total.energyKwh, next.operational.total.energyKwh),
      },
      dataCenters: {
        carbon: percent(first.operational.dataCenters.carbonGrams, next.operational.dataCenters.carbonGrams),
        energy: percent(first.operational.dataCenters.energyKwh, next.operational.dataCenters.energyKwh),
      },
      networks: {
        carbon: percent(first.operational.networks.carbonGrams, next.operational.networks.carbonGrams),
        energy: percent(first.operational.networks.energyKwh, next.operational.networks.energyKwh),
      },
      userDevices: {
        carbon: percent(first.operational.userDevices.carbonGrams, next.operational.userDevices.carbonGrams),
        energy: percent(first.operational.userDevices.energyKwh, next.operational.userDevices.energyKwh),
      },
    },
    embodied: {
      total: {
        carbon: percent(first.embodied.total.carbonGrams, next.embodied.total.carbonGrams),
        energy: percent(first.embodied.total.energyKwh, next.embodied.total.energyKwh),
      },
      dataCenters: {
        carbon: percent(first.embodied.dataCenters.carbonGrams, next.embodied.dataCenters.carbonGrams),
        energy: percent(first.embodied.dataCenters.energyKwh, next.embodied.dataCenters.energyKwh),
      },
      networks: {
        carbon: percent(first.embodied.networks.carbonGrams, next.embodied.networks.carbonGrams),
        energy: percent(first.embodied.networks.energyKwh, next.embodied.networks.energyKwh),
      },
      userDevices: {
        carbon: percent(first.embodied.userDevices.carbonGrams, next.embodied.userDevices.carbonGrams),
        energy: percent(first.embodied.userDevices.energyKwh, next.embodied.userDevices.energyKwh),
      },
    },
  };
}

function percent(baseValue: number, nextValue: number): number | null {
  if (baseValue === 0) {
    return null;
  }
  return ((nextValue - baseValue) / baseValue) * 100;
}
