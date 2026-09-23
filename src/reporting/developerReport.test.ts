import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGithubComment, buildReportingOutput } from './developerReport.js';
import type { ImpactTraceReport, ResourceImpact, SwdmReportBreakdown } from '../types/index.js';

function makeSwdm(totalCarbon: number): SwdmReportBreakdown {
  const operationalCarbon = totalCarbon * 0.7;
  const embodiedCarbon = totalCarbon * 0.3;

  return {
    total: {
      carbonGrams: totalCarbon,
      energyKwh: totalCarbon / 300,
    },
    operational: {
      total: {
        carbonGrams: operationalCarbon,
        energyKwh: operationalCarbon / 300,
      },
      dataCenters: {
        carbonGrams: operationalCarbon * 0.3,
        energyKwh: (operationalCarbon * 0.3) / 300,
      },
      networks: {
        carbonGrams: operationalCarbon * 0.4,
        energyKwh: (operationalCarbon * 0.4) / 300,
      },
      userDevices: {
        carbonGrams: operationalCarbon * 0.3,
        energyKwh: (operationalCarbon * 0.3) / 300,
      },
    },
    embodied: {
      total: {
        carbonGrams: embodiedCarbon,
        energyKwh: embodiedCarbon / 300,
      },
      dataCenters: {
        carbonGrams: embodiedCarbon * 0.3,
        energyKwh: (embodiedCarbon * 0.3) / 300,
      },
      networks: {
        carbonGrams: embodiedCarbon * 0.4,
        energyKwh: (embodiedCarbon * 0.4) / 300,
      },
      userDevices: {
        carbonGrams: embodiedCarbon * 0.3,
        energyKwh: (embodiedCarbon * 0.3) / 300,
      },
    },
  };
}

function makeResource(url: string, resourceType: string, networkBytes: number, carbonGrams: number): ResourceImpact {
  return {
    url,
    resourceType,
    networkBytes,
    carbonGrams,
    energyKwh: carbonGrams / 300,
  };
}

function makeReport(totalCarbon = 1.82): ImpactTraceReport {
  return {
    swdm: makeSwdm(totalCarbon),
    cpu: {
      timeMs: 500,
      carbonGrams: 0.12,
      energyKwh: 0.12 / 300,
      sourceId: 'browser-cpu-profiler',
    },
    sources: {
      'browser-cpu-profiler': { kind: 'cpu-profiler' },
      'co2-transfer': { kind: 'transfer-model' },
    },
    networkBytes: 15.9 * 1024 * 1024,
    topResources: [
      makeResource('https://example.com/hero-video.mp4', 'media', 21.2 * 1024 * 1024, 1.53),
      makeResource('https://example.com/hero.png', 'image', 2.4 * 1024 * 1024, 0.21),
      makeResource('https://cdn.thirdparty.com/sdk.js', 'script', 1.2 * 1024 * 1024, 0.08),
    ],
    suggestions: [],
    comparison: {
      firstVisit: {
        swdm: makeSwdm(2.71),
        cpu: {
          timeMs: 600,
          carbonGrams: 0.15,
          energyKwh: 0.15 / 300,
        },
        networkBytes: 20 * 1024 * 1024,
        topResources: [],
      },
      returningVisit: {
        swdm: makeSwdm(1.52),
        cpu: {
          timeMs: 420,
          carbonGrams: 0.1,
          energyKwh: 0.1 / 300,
        },
        networkBytes: 11 * 1024 * 1024,
        topResources: [],
      },
      representativeVisit: {
        weights: {
          newVisitorRatio: 0.25,
          returnVisitorRatio: 0.75,
        },
        swdm: makeSwdm(totalCarbon),
        cpu: {
          timeMs: 465,
          carbonGrams: 0.11,
          energyKwh: 0.11 / 300,
        },
        networkBytes: 15.9 * 1024 * 1024,
      },
      delta: {
        absolute: {
          swdm: makeSwdm(-1.19),
          cpu: {
            timeMs: -180,
            carbonGrams: -0.05,
            energyKwh: -0.05 / 300,
          },
          networkBytes: -9 * 1024 * 1024,
        },
        percent: {
          swdm: {
            total: { carbon: -43.9, energy: -43.9 },
            operational: {
              total: { carbon: -43.9, energy: -43.9 },
              dataCenters: { carbon: -43.9, energy: -43.9 },
              networks: { carbon: -43.9, energy: -43.9 },
              userDevices: { carbon: -43.9, energy: -43.9 },
            },
            embodied: {
              total: { carbon: -43.9, energy: -43.9 },
              dataCenters: { carbon: -43.9, energy: -43.9 },
              networks: { carbon: -43.9, energy: -43.9 },
              userDevices: { carbon: -43.9, energy: -43.9 },
            },
          },
          cpu: {
            time: -30,
            energy: -33,
            carbon: -33,
          },
          networkBytes: -45,
        },
      },
    },
  };
}

test('buildReportingOutput creates a developer-first report with score, findings, and budgets', () => {
  const report = makeReport();

  const output = buildReportingOutput(report, {
    budgets: {
      carbonGrams: 2,
      transferBytes: 10 * 1024 * 1024,
      cpuSeconds: 1,
      thirdPartyBytes: 1 * 1024 * 1024,
    },
    verbose: true,
  });

  assert.equal(output.formatVersion, '2.0');
  assert.equal(output.defaultView.score.grade, 'C');
  assert.ok(output.defaultView.findings.length > 0);
  assert.ok(output.defaultView.savings.totalEstimatedSavingGrams > 0);
  assert.ok(output.defaultView.cache);

  const transferBudget = output.defaultView.budgets.find((budget) => budget.metric === 'transfer');
  assert.equal(transferBudget?.status, 'fail');
  assert.ok(output.verboseView);
});

test('buildReportingOutput computes trend deltas when baseline is provided', () => {
  const current = makeReport(1.82);
  const baseline = makeReport(1.51);

  const output = buildReportingOutput(current, { baseline });

  assert.ok(output.ci.carbonDeltaGrams !== undefined);
  assert.ok(output.ci.transferDeltaBytes !== undefined);
});

test('buildGithubComment renders a compact markdown summary', () => {
  const output = buildReportingOutput(makeReport(), {
    budgets: {
      carbonGrams: 2,
      transferBytes: 10 * 1024 * 1024,
    },
  });

  const markdown = buildGithubComment(output.defaultView);
  assert.match(markdown, /ImpactTrace Summary/);
  assert.match(markdown, /Top Contributors/);
  assert.match(markdown, /Top Actions/);
});

test('buildGithubComment renders baseline deltas instead of budget variance', () => {
  const output = buildReportingOutput(makeReport(1.82), {
    baseline: makeReport(1.51),
    budgets: {
      carbonGrams: 2,
    },
  });

  assert.match(output.githubComment, /\| carbon \| 1\.82 g \| 2\.00 g \| \+0\.31 g \(\+20\.5%\) \| PASS \|/);
  assert.match(output.githubComment, /\| cpu \| 0\.47 s \| n\/a \| \+0\.00 s \(\+0\.0%\) \| NOT-CONFIGURED \|/);
  assert.match(output.githubComment, /\| thirdParty \| 0\.00 MB \| n\/a \| \+0\.00 MB \| NOT-CONFIGURED \|/);
  assert.doesNotMatch(output.githubComment, /-0\.18 g/);
});

test('buildReportingOutput respects findings limit setting', () => {
  const output = buildReportingOutput(makeReport(), {
    settings: {
      findingsLimit: 2,
    },
  });

  assert.equal(output.defaultView.findings.length, 2);
});

test('buildReportingOutput applies GitHub comment max lines setting', () => {
  const output = buildReportingOutput(makeReport(), {
    settings: {
      githubCommentMaxLines: 5,
    },
  });

  const lineCount = output.githubComment.split('\n').length;
  assert.equal(lineCount, 6);
  assert.ok(output.githubComment.endsWith('...'));
});
