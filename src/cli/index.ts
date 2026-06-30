#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserPlugin } from '../plugins/browserPlugin.js';
import { runJourneyWithPlugins } from '../core/runner.js';
import { bytesToKwh, kwhToCarbonGrams } from '../models/carbonModel.js';
import type { ImpactTraceReport, ResourceImpact, UrlBreakdown } from '../types/index.js';

interface CliArgs {
  command?: string;
  journeyScript?: string;
  urls: string[];
  outputPath: string;
  compareCache: boolean;
  clearCacheBeforeFirstRun: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command !== 'run' || (!args.journeyScript && args.urls.length === 0)) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (args.journeyScript && args.urls.length > 0) {
    console.error('Please provide either a journey script or one/more --url flags, not both.');
    printUsage();
    process.exitCode = 1;
    return;
  }

  const report = args.urls.length > 0 ? await runMultiUrlMode(args) : await runJourneyWithPlugins({
      journeyScript: args.journeyScript,
      plugins: [new BrowserPlugin()],
      compareCache: args.compareCache,
      clearCacheBeforeFirstRun: args.clearCacheBeforeFirstRun,
    });

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
  };
}

function printUsage(): void {
  console.log('Usage: impact-trace run <journey-script> [--output <file>] [--compare-cache] [--no-clear-cache]');
  console.log('   or: impact-trace run --url <https://example.com> [--url <https://another.com> ...] [--output <file>] [--compare-cache] [--no-clear-cache]');
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
  console.log(`Total Carbon: ${report.totalCarbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${report.totalEnergyKwh.toFixed(6)} kWh`);
  console.log(`Network Transfer: ${networkMb.toFixed(3)} MB\n`);

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
  console.log(`Total Carbon: ${comparison.firstVisit.totalCarbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${comparison.firstVisit.totalEnergyKwh.toFixed(6)} kWh`);
  console.log(`Network Transfer: ${(comparison.firstVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB\n`);

  console.log('Returning User (Warm):');
  console.log(`Total Carbon: ${comparison.returningVisit.totalCarbonGrams.toFixed(3)}g CO2`);
  console.log(`Total Energy: ${comparison.returningVisit.totalEnergyKwh.toFixed(6)} kWh`);
  console.log(`Network Transfer: ${(comparison.returningVisit.networkBytes / (1024 * 1024)).toFixed(3)} MB\n`);

  console.log('Difference (Returning - New):');
  console.log(`Carbon Delta: ${comparison.delta.carbonGrams.toFixed(3)}g (${formatPercent(comparison.delta.carbonPercent)})`);
  console.log(`Energy Delta: ${comparison.delta.energyKwh.toFixed(6)} kWh (${formatPercent(comparison.delta.energyPercent)})`);
  console.log(
    `Network Delta: ${(comparison.delta.networkBytes / (1024 * 1024)).toFixed(3)} MB (${formatPercent(comparison.delta.networkPercent)})`,
  );

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

async function runMultiUrlMode(args: CliArgs): Promise<ImpactTraceReport> {
  const breakdown: UrlBreakdown[] = [];

  for (const url of args.urls) {
    const report = await runJourneyWithPlugins({
      url,
      plugins: [new BrowserPlugin()],
      compareCache: args.compareCache,
      clearCacheBeforeFirstRun: args.clearCacheBeforeFirstRun,
    });

    breakdown.push({
      url,
      totalCarbonGrams: report.totalCarbonGrams,
      totalEnergyKwh: report.totalEnergyKwh,
      networkBytes: report.networkBytes,
      topResources: report.topResources,
      suggestions: report.suggestions,
      comparison: report.comparison,
    });
  }

  return aggregateBreakdown(breakdown, args.compareCache);
}

function aggregateBreakdown(breakdown: UrlBreakdown[], isComparisonMode: boolean): ImpactTraceReport {
  if (breakdown.length === 0) {
    return {
      totalCarbonGrams: 0,
      totalEnergyKwh: 0,
      networkBytes: 0,
      topResources: [],
      suggestions: [],
      urlBreakdown: [],
    };
  }

  const aggregateNetworkBytes = breakdown.reduce((sum, item) => sum + item.networkBytes, 0);
  const aggregateEnergyKwh = breakdown.reduce((sum, item) => sum + item.totalEnergyKwh, 0);
  const aggregateCarbon = breakdown.reduce((sum, item) => sum + item.totalCarbonGrams, 0);
  const aggregateTopResources = mergeTopResources(breakdown.flatMap((item) => item.topResources), 5);
  const aggregateSuggestions = dedupeSuggestions(breakdown.flatMap((item) => item.suggestions));

  if (!isComparisonMode) {
    return {
      totalCarbonGrams: aggregateCarbon,
      totalEnergyKwh: aggregateEnergyKwh,
      networkBytes: aggregateNetworkBytes,
      topResources: aggregateTopResources,
      suggestions: aggregateSuggestions,
      urlBreakdown: breakdown,
    };
  }

  const firstVisitBytes = breakdown.reduce((sum, item) => sum + (item.comparison?.firstVisit.networkBytes ?? 0), 0);
  const firstVisitEnergy = breakdown.reduce((sum, item) => sum + (item.comparison?.firstVisit.totalEnergyKwh ?? 0), 0);
  const firstVisitCarbon = breakdown.reduce((sum, item) => sum + (item.comparison?.firstVisit.totalCarbonGrams ?? 0), 0);

  const returningBytes = breakdown.reduce((sum, item) => sum + (item.comparison?.returningVisit.networkBytes ?? 0), 0);
  const returningEnergy = breakdown.reduce((sum, item) => sum + (item.comparison?.returningVisit.totalEnergyKwh ?? 0), 0);
  const returningCarbon = breakdown.reduce((sum, item) => sum + (item.comparison?.returningVisit.totalCarbonGrams ?? 0), 0);

  const firstResources = mergeTopResources(
    breakdown.flatMap((item) => item.comparison?.firstVisit.topResources ?? []),
    5,
  );
  const returningResources = mergeTopResources(
    breakdown.flatMap((item) => item.comparison?.returningVisit.topResources ?? []),
    5,
  );

  return {
    totalCarbonGrams: firstVisitCarbon,
    totalEnergyKwh: firstVisitEnergy,
    networkBytes: firstVisitBytes,
    topResources: firstResources,
    suggestions: aggregateSuggestions,
    urlBreakdown: breakdown,
    comparison: {
      firstVisit: {
        totalCarbonGrams: firstVisitCarbon,
        totalEnergyKwh: firstVisitEnergy,
        networkBytes: firstVisitBytes,
        topResources: firstResources,
      },
      returningVisit: {
        totalCarbonGrams: returningCarbon,
        totalEnergyKwh: returningEnergy,
        networkBytes: returningBytes,
        topResources: returningResources,
      },
      delta: {
        carbonGrams: returningCarbon - firstVisitCarbon,
        energyKwh: returningEnergy - firstVisitEnergy,
        networkBytes: returningBytes - firstVisitBytes,
        carbonPercent: toPercent(firstVisitCarbon, returningCarbon),
        energyPercent: toPercent(firstVisitEnergy, returningEnergy),
        networkPercent: toPercent(firstVisitBytes, returningBytes),
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
    current.energyKwh = bytesToKwh(current.networkBytes);
    current.carbonGrams = kwhToCarbonGrams(current.energyKwh);
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
      console.log(`   New: ${entry.comparison.firstVisit.totalCarbonGrams.toFixed(3)}g, ${firstMb.toFixed(3)} MB`);
      console.log(`   Returning: ${entry.comparison.returningVisit.totalCarbonGrams.toFixed(3)}g, ${returningMb.toFixed(3)} MB`);
    } else {
      console.log(`   Carbon: ${entry.totalCarbonGrams.toFixed(3)}g`);
      console.log(`   Energy: ${entry.totalEnergyKwh.toFixed(6)} kWh`);
      console.log(`   Network: ${mb.toFixed(3)} MB`);
    }
  });
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
