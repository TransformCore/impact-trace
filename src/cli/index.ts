#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserPlugin } from '../plugins/browserPlugin.js';
import { runJourneyWithPlugins } from '../core/runner.js';
import { aggregateReportsForRepeats, normalizeTrimPercent } from '../core/statistics.js';
import type {
  AverageMode,
  ComparisonReport,
  GridIntensityConfig,
  GridIntensitySegment,
  ImpactTraceReport,
  ResourceImpact,
  SwdmPercentBreakdown,
  SwdmReportBreakdown,
  UrlBreakdown,
} from '../types/index.js';

interface CliArgs {
  command?: string;
  journeyScript?: string;
  urls: string[];
  outputPath: string;
  compareCache: boolean;
  clearCacheBeforeFirstRun: boolean;
  cpuMeasurementSeconds?: number;
  disableCpuMeasurement: boolean;
  gridIntensity?: GridIntensityConfig;
  greenHostingFactor?: number;
  returnVisitorRatio?: number;
  dataCacheRatio?: number;
  repeat?: number;
  warmup?: number;
  average?: AverageMode;
  trimPercent?: number;
  parseError?: string;
}

interface RepeatExecutionOptions {
  repeat: number;
  warmup: number;
  average: AverageMode;
  trimPercent: number;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== 'run' || (!args.journeyScript && args.urls.length === 0)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.parseError) {
    console.error(args.parseError);
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (
    args.cpuMeasurementSeconds !== undefined &&
    (!Number.isFinite(args.cpuMeasurementSeconds) || args.cpuMeasurementSeconds <= 0)
  ) {
    console.error('CPU measurement window must be a positive number of seconds.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const inputErrors = validateInputArgs(args);
  if (inputErrors.length > 0) {
    for (const error of inputErrors) {
      console.error(error);
    }
    printUsage();
    process.exitCode = 1;
    return;
  }

  const repeatOptions = resolveRepeatExecutionOptions(args);

  if (args.journeyScript && args.urls.length > 0) {
    console.error('Please provide either a journey script or one/more --url flags, not both.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const report = args.urls.length > 0
    ? await runMultiUrlMode(args, repeatOptions)
    : await runWithRepeatAveraging(
        repeatOptions,
        async () =>
          runJourneyWithPlugins({
            journeyScript: args.journeyScript,
            plugins: [new BrowserPlugin()],
            compareCache: args.compareCache,
            clearCacheBeforeFirstRun: args.clearCacheBeforeFirstRun,
            cpuMeasurementSeconds: args.cpuMeasurementSeconds,
            disableCpuMeasurement: args.disableCpuMeasurement,
            gridIntensity: args.gridIntensity,
            greenHostingFactor: args.greenHostingFactor,
            returnVisitorRatio: args.returnVisitorRatio,
            dataCacheRatio: args.dataCacheRatio,
          }),
      );

  printReport(report);

  const outputPath = path.resolve(process.cwd(), args.outputPath);
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  console.log(`\nJSON report written to ${outputPath}`);
}

function parseArgs(argv: string[]): CliArgs {
  const command = argv[0];
  const maybeJourneyScript = argv[1];
  const journeyScript = maybeJourneyScript && !maybeJourneyScript.startsWith('-') ? maybeJourneyScript : undefined;

  let outputPath = 'impact-trace-report.json';
  const urls: string[] = [];
  let compareCache = false;
  let clearCacheBeforeFirstRun = true;
  let cpuMeasurementSeconds: number | undefined;
  let disableCpuMeasurement = false;
  let gridIntensity: GridIntensityConfig | undefined;
  let greenHostingFactor: number | undefined;
  let returnVisitorRatio: number | undefined;
  let dataCacheRatio: number | undefined;
  let repeat: number | undefined;
  let warmup: number | undefined;
  let average: AverageMode | undefined;
  let trimPercent: number | undefined;
  let parseError: string | undefined;

  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--output' && argv[i + 1]) {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }

    if (argv[i] === '--url' && argv[i + 1]) {
      urls.push(argv[i + 1]);
      i += 1;
      continue;
    }

    if (argv[i] === '--compare-cache') {
      compareCache = true;
      continue;
    }

    if ((argv[i] === '--cpu-seconds' || argv[i] === '--cpu-measurement-seconds') && argv[i + 1]) {
      cpuMeasurementSeconds = Number.parseFloat(argv[i + 1]);
      i += 1;
      continue;
    }

    if (argv[i] === '--no-cpu') {
      disableCpuMeasurement = true;
      continue;
    }

    if (argv[i] === '--green-hosting-factor') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --green-hosting-factor.';
        continue;
      }

      greenHostingFactor = Number.parseFloat(rawValue);
      i += 1;
      continue;
    }

    if (argv[i] === '--return-visitor-ratio') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --return-visitor-ratio.';
        continue;
      }

      returnVisitorRatio = Number.parseFloat(rawValue);
      i += 1;
      continue;
    }

    if (argv[i] === '--data-cache-ratio') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --data-cache-ratio.';
        continue;
      }

      dataCacheRatio = Number.parseFloat(rawValue);
      i += 1;
      continue;
    }

    if (argv[i] === '--repeat') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --repeat.';
        continue;
      }

      repeat = Number.parseInt(rawValue, 10);
      i += 1;
      continue;
    }

    if (argv[i] === '--warmup') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --warmup.';
        continue;
      }

      warmup = Number.parseInt(rawValue, 10);
      i += 1;
      continue;
    }

    if (argv[i] === '--average') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --average.';
        continue;
      }

      const parsedAverage = parseAverageMode(rawValue);
      if (!parsedAverage) {
        parseError = 'Invalid value for --average. Use mean, median, or trimmed-mean.';
        continue;
      }

      average = parsedAverage;
      i += 1;
      continue;
    }

    if (argv[i] === '--trim-percent') {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = 'Missing value for --trim-percent.';
        continue;
      }

      trimPercent = Number.parseFloat(rawValue);
      i += 1;
      continue;
    }

    if (
      argv[i] === '--grid-intensity-device' ||
      argv[i] === '--grid-intensity-network' ||
      argv[i] === '--grid-intensity-networks' ||
      argv[i] === '--grid-intensity-datacenter' ||
      argv[i] === '--grid-intensity-data-center'
    ) {
      const rawValue = argv[i + 1];
      if (!rawValue) {
        parseError = `Missing value for ${argv[i]}.`;
        continue;
      }

      const parsedSegment = parseGridIntensityArg(rawValue);
      if (!parsedSegment) {
        parseError =
          `${argv[i]} must be a positive number, an ISO country code (for example TWN), or country:<ISO3>.`;
        continue;
      }

      const key =
        argv[i] === '--grid-intensity-device'
          ? 'device'
          : argv[i] === '--grid-intensity-datacenter' || argv[i] === '--grid-intensity-data-center'
            ? 'dataCenter'
            : 'network';

      gridIntensity = {
        ...(gridIntensity ?? {}),
        [key]: parsedSegment,
      };

      i += 1;
      continue;
    }

    if (argv[i] === '--no-clear-cache') {
      clearCacheBeforeFirstRun = false;
    }
  }

  return {
    command,
    journeyScript,
    urls,
    outputPath,
    compareCache,
    clearCacheBeforeFirstRun,
    cpuMeasurementSeconds,
    disableCpuMeasurement,
    gridIntensity,
    greenHostingFactor,
    returnVisitorRatio,
    dataCacheRatio,
    repeat,
    warmup,
    average,
    trimPercent,
    parseError,
  };
}

function printUsage(): void {
  console.log('Usage: impact-trace run <journey-script> [--output <file>] [--compare-cache] [--no-clear-cache] [--cpu-seconds <seconds>] [--no-cpu] [--grid-intensity-<segment> <value>] [--green-hosting-factor <0..1>] [--return-visitor-ratio <0..1>] [--data-cache-ratio <0..1>] [--repeat <n>] [--warmup <n>] [--average <mean|median|trimmed-mean>] [--trim-percent <0..0.5>]');
  console.log('   or: impact-trace run --url <https://example.com> [--url <https://another.com> ...] [--output <file>] [--compare-cache] [--no-clear-cache] [--cpu-seconds <seconds>] [--no-cpu] [--grid-intensity-<segment> <value>] [--green-hosting-factor <0..1>] [--return-visitor-ratio <0..1>] [--data-cache-ratio <0..1>] [--repeat <n>] [--warmup <n>] [--average <mean|median|trimmed-mean>] [--trim-percent <0..0.5>]');
}

function validateInputArgs(args: CliArgs): string[] {
  const errors: string[] = [];

  if (args.greenHostingFactor !== undefined && !isRatio(args.greenHostingFactor)) {
    errors.push('Green hosting factor must be a number between 0 and 1.');
  }

  if (args.returnVisitorRatio !== undefined && !isRatio(args.returnVisitorRatio)) {
    errors.push('Return visitor ratio must be a number between 0 and 1.');
  }

  if (args.dataCacheRatio !== undefined && !isRatio(args.dataCacheRatio)) {
    errors.push('Data cache ratio must be a number between 0 and 1.');
  }

  if (
    args.repeat !== undefined &&
    (!Number.isInteger(args.repeat) || args.repeat < 1)
  ) {
    errors.push('Repeat must be an integer greater than or equal to 1.');
  }

  if (
    args.warmup !== undefined &&
    (!Number.isInteger(args.warmup) || args.warmup < 0)
  ) {
    errors.push('Warmup must be an integer greater than or equal to 0.');
  }

  if (args.trimPercent !== undefined && (!Number.isFinite(args.trimPercent) || args.trimPercent < 0 || args.trimPercent > 0.5)) {
    errors.push('Trim percent must be a number between 0 and 0.5.');
  }

  if (args.average === 'trimmed-mean') {
    const repeat = args.repeat ?? 1;
    if (repeat < 3) {
      errors.push('Trimmed mean requires --repeat of at least 3.');
    }
  }

  return errors;
}

function isRatio(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function printReport(report: ImpactTraceReport): void {
  if (report.urlBreakdown && report.urlBreakdown.length > 0) {
    printUrlBreakdown(report.urlBreakdown, Boolean(report.comparison));
    console.log('');
  }

  if (report.comparison) {
    printComparisonReport(report);
    return;
  }

  const networkMb = report.networkBytes / (1024 * 1024);

  console.log('ImpactTrace Report\n');
  console.log(`Total Carbon: ${report.swdm.total.carbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${report.swdm.total.energyKwh.toFixed(6)} kWh`);
  printSwdmSegmentsMatrix(report.swdm);
  printCpuDetails(report.cpu);
  console.log(`Network Transfer: ${networkMb.toFixed(3)} MB\n`);
  printModelInputs(report.modelInputs);

  console.log('Top Contributors:');
  if (report.topResources.length === 0) {
    console.log('1. No network resources captured');
  } else {
    report.topResources.forEach((resource, index) => {
      const printableName = shortenUrl(resource.url);
      console.log(
        `${index + 1}. ${printableName} - ${formatAssetSize(resource.networkBytes)} - ${resource.carbonGrams.toFixed(3)}g`,
      );
    });
  }

  console.log('\nSuggestions:');
  if (report.suggestions.length === 0) {
    console.log('- No optimization suggestions detected for current thresholds.');
  } else {
    for (const suggestion of report.suggestions) {
      console.log(`- ${suggestion.message}`);
    }
  }
}

function printComparisonReport(report: ImpactTraceReport): void {
  const comparison = report.comparison;
  if (!comparison) {
    return;
  }

  console.log('ImpactTrace Report (Cache Comparison)\n');

  console.log('New User (Cold-ish):');
  console.log(`Total Carbon: ${comparison.firstVisit.swdm.total.carbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${comparison.firstVisit.swdm.total.energyKwh.toFixed(6)} kWh`);
  printSwdmSegmentsMatrix(comparison.firstVisit.swdm);
  printCpuDetails(comparison.firstVisit.cpu);
  console.log(`Network Transfer: ${(comparison.firstVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB\n`);

  console.log('Returning User (Warm):');
  console.log(`Total Carbon: ${comparison.returningVisit.swdm.total.carbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${comparison.returningVisit.swdm.total.energyKwh.toFixed(6)} kWh`);
  printSwdmSegmentsMatrix(comparison.returningVisit.swdm);
  printCpuDetails(comparison.returningVisit.cpu);
  console.log(`Network Transfer: ${(comparison.returningVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB\n`);

  if (comparison.representativeVisit) {
    console.log('Representative Visit (Weighted):');
    console.log(`Total Carbon: ${comparison.representativeVisit.swdm.total.carbonGrams.toFixed(3)}g CO2`);
    console.log(`Total Energy: ${comparison.representativeVisit.swdm.total.energyKwh.toFixed(6)} kWh`);
    printSwdmSegmentsMatrix(comparison.representativeVisit.swdm);
    printCpuDetails(comparison.representativeVisit.cpu);
    console.log(`Network Transfer: ${(comparison.representativeVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB\n`);
  }

  console.log('Difference (Returning - New):');
  console.log(
    `Carbon Delta: ${comparison.delta.absolute.swdm.total.carbonGrams.toFixed(3)}g (${formatPercent(comparison.delta.percent.swdm.total.carbon)})`,
  );
  console.log(
    `Energy Delta: ${comparison.delta.absolute.swdm.total.energyKwh.toFixed(6)} kWh (${formatPercent(comparison.delta.percent.swdm.total.energy)})`,
  );
  printSwdmDelta(comparison.delta);
  console.log(
    `CPU Time Delta: ${formatDurationMs(comparison.delta.absolute.cpu.timeMs)} (${formatPercent(comparison.delta.percent.cpu.time)})`,
  );
  console.log(
    `CPU Carbon Delta: ${comparison.delta.absolute.cpu.carbonGrams.toFixed(3)}g (${formatPercent(comparison.delta.percent.cpu.carbon)})`,
  );
  console.log(
    `CPU Energy Delta: ${comparison.delta.absolute.cpu.energyKwh.toFixed(6)} kWh (${formatPercent(comparison.delta.percent.cpu.energy)})`,
  );
  console.log(
    `Network Delta: ${(comparison.delta.absolute.networkBytes / (1024 * 1024)).toFixed(3)} MB (${formatPercent(comparison.delta.percent.networkBytes)})`,
  );
  printModelInputs(report.modelInputs);

  console.log('\nTop Contributors (New User):');
  if (comparison.firstVisit.topResources.length === 0) {
    console.log('1. No network resources captured');
  } else {
    comparison.firstVisit.topResources.forEach((resource, index) => {
      const printableName = shortenUrl(resource.url);
      console.log(
        `${index + 1}. ${printableName} - ${formatAssetSize(resource.networkBytes)} - ${resource.carbonGrams.toFixed(3)}g`,
      );
    });
  }

  console.log('\nSuggestions:');
  if (report.suggestions.length === 0) {
    console.log('- No optimization suggestions detected for current thresholds.');
  } else {
    for (const suggestion of report.suggestions) {
      console.log(`- ${suggestion.message}`);
    }
  }
}

function printModelInputs(modelInputs: ImpactTraceReport['modelInputs']): void {
  if (!modelInputs) {
    return;
  }

  const lines: string[] = [];

  if (modelInputs.greenHostingFactor !== undefined) {
    const source = modelInputs.greenHostingFactorSource ?? 'default';
    lines.push(
      `Green Hosting Factor: ${modelInputs.greenHostingFactor.toFixed(3)} (${source})`,
    );
  }

  if (modelInputs.returnVisitorRatio !== undefined && modelInputs.newVisitorRatio !== undefined) {
    const source = modelInputs.returnVisitorRatioSource ?? 'default';
    lines.push(
      `Visitor Mix: new ${modelInputs.newVisitorRatio.toFixed(3)}, returning ${modelInputs.returnVisitorRatio.toFixed(3)} (${source})`,
    );
  }

  if (modelInputs.dataCacheRatio !== undefined) {
    const source = modelInputs.dataCacheRatioSource ?? 'explicit';
    lines.push(`Data Cache Ratio: ${modelInputs.dataCacheRatio.toFixed(3)} (${source})`);
  }

  if (modelInputs.repeatAveraging) {
    const repeatAveraging = modelInputs.repeatAveraging;
    lines.push(
      `Repeat Averaging: repeat ${repeatAveraging.repeat}, warmup ${repeatAveraging.warmup}, mode ${repeatAveraging.averageMode}, trim ${repeatAveraging.trimPercent.toFixed(3)}, samples ${repeatAveraging.sampleCount}`,
    );
  }

  if (lines.length === 0) {
    return;
  }

  console.log('Model Inputs:');
  for (const line of lines) {
    console.log(`- ${line}`);
  }
  console.log('');
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatAssetSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${bytes} B`;
}

function formatDurationMs(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(3)} s`;
}

async function runMultiUrlMode(args: CliArgs, repeatOptions: RepeatExecutionOptions): Promise<ImpactTraceReport> {
  const breakdown: UrlBreakdown[] = [];

  for (const url of args.urls) {
    const report = await runWithRepeatAveraging(
      repeatOptions,
      async () =>
        runJourneyWithPlugins({
          url,
          plugins: [new BrowserPlugin()],
          compareCache: args.compareCache,
          clearCacheBeforeFirstRun: args.clearCacheBeforeFirstRun,
          cpuMeasurementSeconds: args.cpuMeasurementSeconds,
          disableCpuMeasurement: args.disableCpuMeasurement,
          gridIntensity: args.gridIntensity,
          greenHostingFactor: args.greenHostingFactor,
          returnVisitorRatio: args.returnVisitorRatio,
          dataCacheRatio: args.dataCacheRatio,
        }),
    );

    breakdown.push({
      url,
      swdm: report.swdm,
      cpu: report.cpu,
      sources: report.sources,
      networkBytes: report.networkBytes,
      topResources: report.topResources,
      suggestions: report.suggestions,
      modelInputs: report.modelInputs,
      comparison: report.comparison,
    });
  }

  return aggregateBreakdown(breakdown, args.compareCache);
}

async function runWithRepeatAveraging(
  repeatOptions: RepeatExecutionOptions,
  runOnce: () => Promise<ImpactTraceReport>,
): Promise<ImpactTraceReport> {
  for (let i = 0; i < repeatOptions.warmup; i += 1) {
    await runOnce();
  }

  const samples: ImpactTraceReport[] = [];
  for (let i = 0; i < repeatOptions.repeat; i += 1) {
    samples.push(await runOnce());
  }

  const repeatMeta = {
    repeat: repeatOptions.repeat,
    warmup: repeatOptions.warmup,
    averageMode: repeatOptions.average,
    trimPercent: repeatOptions.average === 'trimmed-mean' ? repeatOptions.trimPercent : 0,
    sampleCount: samples.length,
  };

  if (samples.length === 1) {
    return {
      ...samples[0],
      modelInputs: {
        ...(samples[0].modelInputs ?? {}),
        repeatAveraging: repeatMeta,
      },
    };
  }

  return aggregateReportsForRepeats(
    samples,
    {
      mode: repeatOptions.average,
      trimPercent: repeatOptions.trimPercent,
    },
    repeatMeta,
  );
}

function resolveRepeatExecutionOptions(args: CliArgs): RepeatExecutionOptions {
  const repeat = args.repeat ?? 1;
  const warmup = args.warmup ?? 0;
  const average = args.average ?? 'mean';
  const trimPercent = normalizeTrimPercent(args.trimPercent ?? 0.2);

  return {
    repeat,
    warmup,
    average,
    trimPercent,
  };
}

function parseAverageMode(value: string): AverageMode | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'mean' || normalized === 'median' || normalized === 'trimmed-mean') {
    return normalized;
  }

  return undefined;
}

function parseGridIntensityArg(value: string): GridIntensitySegment | undefined {
  const trimmed = value.trim();
  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }

  if (trimmed.toLowerCase().startsWith('country:')) {
    const countryCandidate = trimmed.slice('country:'.length);
    const normalizedCountry = normalizeCountryCode(countryCandidate);
    if (normalizedCountry) {
      return { country: normalizedCountry };
    }
    return undefined;
  }

  const normalizedCountry = normalizeCountryCode(trimmed);
  if (normalizedCountry) {
    return { country: normalizedCountry };
  }

  return undefined;
}

function normalizeCountryCode(value: string): string | undefined {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function aggregateBreakdown(breakdown: UrlBreakdown[], isComparisonMode: boolean): ImpactTraceReport {
  if (breakdown.length === 0) {
    return {
      swdm: emptySwdmReportBreakdown(),
      cpu: {
        timeMs: 0,
        energyKwh: 0,
        carbonGrams: 0,
        sourceId: 'browser-cpu-profiler',
      },
      sources: {
        'browser-cpu-profiler': {
          kind: 'cpu-profiler',
        },
        'co2-transfer': {
          kind: 'transfer-model',
        },
      },
      networkBytes: 0,
      topResources: [],
      suggestions: [],
      urlBreakdown: [],
    };
  }

  const aggregateNetworkBytes = breakdown.reduce((sum, item) => sum + item.networkBytes, 0);
  const aggregateSwdm = sumSwdmBreakdowns(breakdown.map((item) => item.swdm));
  const aggregateCpu = {
    timeMs: breakdown.reduce((sum, item) => sum + item.cpu.timeMs, 0),
    energyKwh: breakdown.reduce((sum, item) => sum + item.cpu.energyKwh, 0),
    carbonGrams: breakdown.reduce((sum, item) => sum + item.cpu.carbonGrams, 0),
    sourceId: breakdown[0].cpu.sourceId,
  };
  const aggregateTopResources = mergeTopResources(breakdown.flatMap((item) => item.topResources), 5);
  const aggregateSuggestions = dedupeSuggestions(breakdown.flatMap((item) => item.suggestions));
  const aggregateModelInputs = breakdown.find((item) => item.modelInputs)?.modelInputs;
  const aggregateSources = breakdown.find((item) => item.sources)?.sources ?? {};

  if (!isComparisonMode) {
    return {
      swdm: aggregateSwdm,
      cpu: aggregateCpu,
      sources: aggregateSources,
      networkBytes: aggregateNetworkBytes,
      topResources: aggregateTopResources,
      suggestions: aggregateSuggestions,
      modelInputs: aggregateModelInputs,
      urlBreakdown: breakdown,
    };
  }

  const firstVisit = sumVisitReports(breakdown, 'firstVisit');
  const returningVisit = sumVisitReports(breakdown, 'returningVisit');

  const firstResources = mergeTopResources(
    breakdown.flatMap((item) => item.comparison?.firstVisit.topResources ?? []),
    5,
  );
  const returningResources = mergeTopResources(
    breakdown.flatMap((item) => item.comparison?.returningVisit.topResources ?? []),
    5,
  );
  const representativeReturnRatio = aggregateModelInputs?.returnVisitorRatio ?? 0.75;
  const representativeNewRatio = aggregateModelInputs?.newVisitorRatio ?? (1 - representativeReturnRatio);
  const representativeVisit = {
    weights: {
      newVisitorRatio: representativeNewRatio,
      returnVisitorRatio: representativeReturnRatio,
    },
    swdm: weightedSwdmBreakdown(
      firstVisit.swdm,
      returningVisit.swdm,
      representativeNewRatio,
      representativeReturnRatio,
    ),
    cpu: {
      timeMs: firstVisit.cpu.timeMs * representativeNewRatio + returningVisit.cpu.timeMs * representativeReturnRatio,
      energyKwh:
        firstVisit.cpu.energyKwh * representativeNewRatio +
        returningVisit.cpu.energyKwh * representativeReturnRatio,
      carbonGrams:
        firstVisit.cpu.carbonGrams * representativeNewRatio +
        returningVisit.cpu.carbonGrams * representativeReturnRatio,
    },
    networkBytes:
      firstVisit.networkBytes * representativeNewRatio +
      returningVisit.networkBytes * representativeReturnRatio,
  };

  return {
    swdm: firstVisit.swdm,
    cpu: firstVisit.cpu,
    sources: aggregateSources,
    networkBytes: firstVisit.networkBytes,
    topResources: firstResources,
    suggestions: aggregateSuggestions,
    modelInputs: aggregateModelInputs,
    urlBreakdown: breakdown,
    comparison: {
      firstVisit: {
        swdm: firstVisit.swdm,
        cpu: firstVisit.cpu,
        networkBytes: firstVisit.networkBytes,
        topResources: firstResources,
      },
      returningVisit: {
        swdm: returningVisit.swdm,
        cpu: returningVisit.cpu,
        networkBytes: returningVisit.networkBytes,
        topResources: returningResources,
      },
      representativeVisit,
      delta: {
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
            time: toPercent(firstVisit.cpu.timeMs, returningVisit.cpu.timeMs),
            energy: toPercent(firstVisit.cpu.energyKwh, returningVisit.cpu.energyKwh),
            carbon: toPercent(firstVisit.cpu.carbonGrams, returningVisit.cpu.carbonGrams),
          },
          networkBytes: toPercent(firstVisit.networkBytes, returningVisit.networkBytes),
        },
      },
    },
  };
}

function mergeTopResources(resources: ResourceImpact[], limit: number): ResourceImpact[] {
  const grouped = new Map<string, ResourceImpact>();

  for (const resource of resources) {
    const key = `${resource.url}::${resource.resourceType ?? 'unknown'}`;
    const current = grouped.get(key);

    if (!current) {
      grouped.set(key, { ...resource });
      continue;
    }

    current.networkBytes += resource.networkBytes;
    current.energyKwh += resource.energyKwh;
    current.carbonGrams += resource.carbonGrams;
    current.cached = current.cached ?? resource.cached;
  }

  return [...grouped.values()].sort((a, b) => b.carbonGrams - a.carbonGrams).slice(0, limit);
}

function dedupeSuggestions(suggestions: ImpactTraceReport['suggestions']): ImpactTraceReport['suggestions'] {
  const seen = new Set<string>();
  const result: ImpactTraceReport['suggestions'] = [];

  for (const suggestion of suggestions) {
    const key = `${suggestion.rule}:${suggestion.resourceUrl ?? ''}:${suggestion.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(suggestion);
  }

  return result;
}

function toPercent(baseValue: number, nextValue: number): number | null {
  if (baseValue === 0) {
    return null;
  }
  return ((nextValue - baseValue) / baseValue) * 100;
}

function printUrlBreakdown(breakdown: UrlBreakdown[], hasComparison: boolean): void {
  console.log('Per-URL Breakdown:');
  breakdown.forEach((entry, index) => {
    const mb = entry.networkBytes / (1024 * 1024);
    console.log(`${index + 1}. ${entry.url}`);
    if (hasComparison && entry.comparison) {
      const firstMb = entry.comparison.firstVisit.networkBytes / (1024 * 1024);
      const returningMb = entry.comparison.returningVisit.networkBytes / (1024 * 1024);
      console.log(`   New: ${entry.comparison.firstVisit.swdm.total.carbonGrams.toFixed(3)}g, ${firstMb.toFixed(3)} MB`);
      console.log(`   New CPU: ${formatDurationMs(entry.comparison.firstVisit.cpu.timeMs)}, ${entry.comparison.firstVisit.cpu.carbonGrams.toFixed(3)}g`);
      console.log(`   Returning: ${entry.comparison.returningVisit.swdm.total.carbonGrams.toFixed(3)}g, ${returningMb.toFixed(3)} MB`);
      if (entry.comparison.representativeVisit) {
        console.log(
          `   Representative: ${entry.comparison.representativeVisit.swdm.total.carbonGrams.toFixed(3)}g, ${(entry.comparison.representativeVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB`,
        );
      }
      printCompactSwdmLine('   New SWDM', entry.comparison.firstVisit.swdm);
      printCompactSwdmLine('   Returning SWDM', entry.comparison.returningVisit.swdm);
      console.log(
        `   Returning CPU: ${formatDurationMs(entry.comparison.returningVisit.cpu.timeMs)}, ${entry.comparison.returningVisit.cpu.carbonGrams.toFixed(3)}g`,
      );
    } else {
      console.log(`   Carbon: ${entry.swdm.total.carbonGrams.toFixed(3)}g`);
      console.log(`   Energy: ${entry.swdm.total.energyKwh.toFixed(6)} kWh`);
      printCompactSwdmLine('   SWDM', entry.swdm);
      console.log(`   CPU: ${formatDurationMs(entry.cpu.timeMs)}, ${entry.cpu.carbonGrams.toFixed(3)}g`);
      console.log(`   Network: ${mb.toFixed(3)} MB`);
    }
  });
}

function emptySwdmReportBreakdown(): SwdmReportBreakdown {
  return {
    total: {
      carbonGrams: 0,
      energyKwh: 0,
    },
    operational: {
      total: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      dataCenters: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      networks: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      userDevices: {
        carbonGrams: 0,
        energyKwh: 0,
      },
    },
    embodied: {
      total: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      dataCenters: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      networks: {
        carbonGrams: 0,
        energyKwh: 0,
      },
      userDevices: {
        carbonGrams: 0,
        energyKwh: 0,
      },
    },
  };
}

function sumSwdmBreakdowns(items: SwdmReportBreakdown[]): SwdmReportBreakdown {
  return items.reduce((acc, current) => ({
    total: {
      carbonGrams: acc.total.carbonGrams + current.total.carbonGrams,
      energyKwh: acc.total.energyKwh + current.total.energyKwh,
    },
    operational: {
      total: {
        carbonGrams: acc.operational.total.carbonGrams + current.operational.total.carbonGrams,
        energyKwh: acc.operational.total.energyKwh + current.operational.total.energyKwh,
      },
      dataCenters: {
        carbonGrams: acc.operational.dataCenters.carbonGrams + current.operational.dataCenters.carbonGrams,
        energyKwh: acc.operational.dataCenters.energyKwh + current.operational.dataCenters.energyKwh,
        sourceId: acc.operational.dataCenters.sourceId ?? current.operational.dataCenters.sourceId,
      },
      networks: {
        carbonGrams: acc.operational.networks.carbonGrams + current.operational.networks.carbonGrams,
        energyKwh: acc.operational.networks.energyKwh + current.operational.networks.energyKwh,
        sourceId: acc.operational.networks.sourceId ?? current.operational.networks.sourceId,
      },
      userDevices: {
        carbonGrams: acc.operational.userDevices.carbonGrams + current.operational.userDevices.carbonGrams,
        energyKwh: acc.operational.userDevices.energyKwh + current.operational.userDevices.energyKwh,
        sourceId: acc.operational.userDevices.sourceId ?? current.operational.userDevices.sourceId,
      },
    },
    embodied: {
      total: {
        carbonGrams: acc.embodied.total.carbonGrams + current.embodied.total.carbonGrams,
        energyKwh: acc.embodied.total.energyKwh + current.embodied.total.energyKwh,
      },
      dataCenters: {
        carbonGrams: acc.embodied.dataCenters.carbonGrams + current.embodied.dataCenters.carbonGrams,
        energyKwh: acc.embodied.dataCenters.energyKwh + current.embodied.dataCenters.energyKwh,
        sourceId: acc.embodied.dataCenters.sourceId ?? current.embodied.dataCenters.sourceId,
      },
      networks: {
        carbonGrams: acc.embodied.networks.carbonGrams + current.embodied.networks.carbonGrams,
        energyKwh: acc.embodied.networks.energyKwh + current.embodied.networks.energyKwh,
        sourceId: acc.embodied.networks.sourceId ?? current.embodied.networks.sourceId,
      },
      userDevices: {
        carbonGrams: acc.embodied.userDevices.carbonGrams + current.embodied.userDevices.carbonGrams,
        energyKwh: acc.embodied.userDevices.energyKwh + current.embodied.userDevices.energyKwh,
        sourceId: acc.embodied.userDevices.sourceId ?? current.embodied.userDevices.sourceId,
      },
    },
  }), emptySwdmReportBreakdown());
}

function sumVisitReports(
  breakdown: UrlBreakdown[],
  key: 'firstVisit' | 'returningVisit',
): NonNullable<ComparisonReport['firstVisit']> {
  const visitItems = breakdown
    .map((item) => item.comparison?.[key])
    .filter((item): item is ComparisonReport['firstVisit'] => Boolean(item));

  return {
    swdm: sumSwdmBreakdowns(visitItems.map((item) => item.swdm)),
    cpu: {
      timeMs: visitItems.reduce((sum, item) => sum + item.cpu.timeMs, 0),
      energyKwh: visitItems.reduce((sum, item) => sum + item.cpu.energyKwh, 0),
      carbonGrams: visitItems.reduce((sum, item) => sum + item.cpu.carbonGrams, 0),
      sourceId: visitItems[0]?.cpu.sourceId,
    },
    networkBytes: visitItems.reduce((sum, item) => sum + item.networkBytes, 0),
    topResources: mergeTopResources(visitItems.flatMap((item) => item.topResources), 5),
  };
}

function weightedSwdmBreakdown(
  first: SwdmReportBreakdown,
  returning: SwdmReportBreakdown,
  firstWeight: number,
  returningWeight: number,
): SwdmReportBreakdown {
  return {
    total: {
      carbonGrams: first.total.carbonGrams * firstWeight + returning.total.carbonGrams * returningWeight,
      energyKwh: first.total.energyKwh * firstWeight + returning.total.energyKwh * returningWeight,
    },
    operational: {
      total: {
        carbonGrams:
          first.operational.total.carbonGrams * firstWeight +
          returning.operational.total.carbonGrams * returningWeight,
        energyKwh:
          first.operational.total.energyKwh * firstWeight +
          returning.operational.total.energyKwh * returningWeight,
      },
      dataCenters: {
        carbonGrams:
          first.operational.dataCenters.carbonGrams * firstWeight +
          returning.operational.dataCenters.carbonGrams * returningWeight,
        energyKwh:
          first.operational.dataCenters.energyKwh * firstWeight +
          returning.operational.dataCenters.energyKwh * returningWeight,
      },
      networks: {
        carbonGrams:
          first.operational.networks.carbonGrams * firstWeight +
          returning.operational.networks.carbonGrams * returningWeight,
        energyKwh:
          first.operational.networks.energyKwh * firstWeight +
          returning.operational.networks.energyKwh * returningWeight,
      },
      userDevices: {
        carbonGrams:
          first.operational.userDevices.carbonGrams * firstWeight +
          returning.operational.userDevices.carbonGrams * returningWeight,
        energyKwh:
          first.operational.userDevices.energyKwh * firstWeight +
          returning.operational.userDevices.energyKwh * returningWeight,
      },
    },
    embodied: {
      total: {
        carbonGrams:
          first.embodied.total.carbonGrams * firstWeight +
          returning.embodied.total.carbonGrams * returningWeight,
        energyKwh:
          first.embodied.total.energyKwh * firstWeight +
          returning.embodied.total.energyKwh * returningWeight,
      },
      dataCenters: {
        carbonGrams:
          first.embodied.dataCenters.carbonGrams * firstWeight +
          returning.embodied.dataCenters.carbonGrams * returningWeight,
        energyKwh:
          first.embodied.dataCenters.energyKwh * firstWeight +
          returning.embodied.dataCenters.energyKwh * returningWeight,
      },
      networks: {
        carbonGrams:
          first.embodied.networks.carbonGrams * firstWeight +
          returning.embodied.networks.carbonGrams * returningWeight,
        energyKwh:
          first.embodied.networks.energyKwh * firstWeight +
          returning.embodied.networks.energyKwh * returningWeight,
      },
      userDevices: {
        carbonGrams:
          first.embodied.userDevices.carbonGrams * firstWeight +
          returning.embodied.userDevices.carbonGrams * returningWeight,
        energyKwh:
          first.embodied.userDevices.energyKwh * firstWeight +
          returning.embodied.userDevices.energyKwh * returningWeight,
      },
    },
  };
}

function subtractSwdmBreakdown(minuend: SwdmReportBreakdown, subtrahend: SwdmReportBreakdown): SwdmReportBreakdown {
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

function buildSwdmPercentBreakdown(first: SwdmReportBreakdown, next: SwdmReportBreakdown): SwdmPercentBreakdown {
  return {
    total: {
      carbon: toPercent(first.total.carbonGrams, next.total.carbonGrams),
      energy: toPercent(first.total.energyKwh, next.total.energyKwh),
    },
    operational: {
      total: {
        carbon: toPercent(first.operational.total.carbonGrams, next.operational.total.carbonGrams),
        energy: toPercent(first.operational.total.energyKwh, next.operational.total.energyKwh),
      },
      dataCenters: {
        carbon: toPercent(first.operational.dataCenters.carbonGrams, next.operational.dataCenters.carbonGrams),
        energy: toPercent(first.operational.dataCenters.energyKwh, next.operational.dataCenters.energyKwh),
      },
      networks: {
        carbon: toPercent(first.operational.networks.carbonGrams, next.operational.networks.carbonGrams),
        energy: toPercent(first.operational.networks.energyKwh, next.operational.networks.energyKwh),
      },
      userDevices: {
        carbon: toPercent(first.operational.userDevices.carbonGrams, next.operational.userDevices.carbonGrams),
        energy: toPercent(first.operational.userDevices.energyKwh, next.operational.userDevices.energyKwh),
      },
    },
    embodied: {
      total: {
        carbon: toPercent(first.embodied.total.carbonGrams, next.embodied.total.carbonGrams),
        energy: toPercent(first.embodied.total.energyKwh, next.embodied.total.energyKwh),
      },
      dataCenters: {
        carbon: toPercent(first.embodied.dataCenters.carbonGrams, next.embodied.dataCenters.carbonGrams),
        energy: toPercent(first.embodied.dataCenters.energyKwh, next.embodied.dataCenters.energyKwh),
      },
      networks: {
        carbon: toPercent(first.embodied.networks.carbonGrams, next.embodied.networks.carbonGrams),
        energy: toPercent(first.embodied.networks.energyKwh, next.embodied.networks.energyKwh),
      },
      userDevices: {
        carbon: toPercent(first.embodied.userDevices.carbonGrams, next.embodied.userDevices.carbonGrams),
        energy: toPercent(first.embodied.userDevices.energyKwh, next.embodied.userDevices.energyKwh),
      },
    },
  };
}

function printSwdmSegmentsMatrix(segments: SwdmReportBreakdown): void {
  const rows: Array<{ label: string; operational: number; embodied: number }> = [
    {
      label: 'Data Centers',
      operational: segments.operational.dataCenters.carbonGrams,
      embodied: segments.embodied.dataCenters.carbonGrams,
    },
    {
      label: 'Networks',
      operational: segments.operational.networks.carbonGrams,
      embodied: segments.embodied.networks.carbonGrams,
    },
    {
      label: 'User Devices',
      operational: segments.operational.userDevices.carbonGrams,
      embodied: segments.embodied.userDevices.carbonGrams,
    },
  ];

  console.log('SWDM Segments (g CO2):');
  for (const row of rows) {
    console.log(`  ${row.label}: operational ${row.operational.toFixed(3)}, embodied ${row.embodied.toFixed(3)}`);
  }
}

function printCpuDetails(cpu: ImpactTraceReport['cpu']): void {
  console.log('CPU Details:');
  console.log(`  Time: ${formatDurationMs(cpu.timeMs)}`);
  console.log(`  Carbon: ${cpu.carbonGrams.toFixed(3)}g CO2`);
  console.log(`  Energy: ${cpu.energyKwh.toFixed(6)} kWh`);
}

function printSwdmDelta(delta: ComparisonReport['delta']): void {
  console.log(
    `Data Centers Delta: OP ${delta.absolute.swdm.operational.dataCenters.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.operational.dataCenters.carbon)}), EM ${delta.absolute.swdm.embodied.dataCenters.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.embodied.dataCenters.carbon)})`,
  );
  console.log(
    `Networks Delta: OP ${delta.absolute.swdm.operational.networks.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.operational.networks.carbon)}), EM ${delta.absolute.swdm.embodied.networks.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.embodied.networks.carbon)})`,
  );
  console.log(
    `User Devices Delta: OP ${delta.absolute.swdm.operational.userDevices.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.operational.userDevices.carbon)}), EM ${delta.absolute.swdm.embodied.userDevices.carbonGrams.toFixed(3)}g (${formatPercent(delta.percent.swdm.embodied.userDevices.carbon)})`,
  );
}

function printCompactSwdmLine(prefix: string, segments: SwdmReportBreakdown): void {
  console.log(
    `${prefix}: DC(op ${segments.operational.dataCenters.carbonGrams.toFixed(3)}, em ${segments.embodied.dataCenters.carbonGrams.toFixed(3)}) | N(op ${segments.operational.networks.carbonGrams.toFixed(3)}, em ${segments.embodied.networks.carbonGrams.toFixed(3)}) | UD(op ${segments.operational.userDevices.carbonGrams.toFixed(3)}, em ${segments.embodied.userDevices.carbonGrams.toFixed(3)})`,
  );
}

function shortenUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathName = parsed.pathname.length > 45 ? `${parsed.pathname.slice(0, 45)}...` : parsed.pathname;
    return `${parsed.hostname}${pathName}`;
  } catch {
    return value;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error('ImpactTrace failed:', message);
  process.exitCode = 1;
});
