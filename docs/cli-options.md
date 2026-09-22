# CLI Options

Command:

```bash
impact-trace run <journey-script> [options]
impact-trace run --url <url> [--url <url> ...] [options]
```

## Required Inputs

Provide exactly one of:

- Journey script positional argument: `<journey-script>`
- URL mode: one or more `--url <url>` flags

Notes:

- Journey and URL mode cannot be combined in the same command.
- URLs must be `http` or `https`.

## Options

- `--url <url>`
  - Adds a target URL.
  - May be repeated multiple times.
- `--wait-until <load|domcontentloaded|networkidle>`
  - URL mode only.
  - Controls Playwright navigation readiness for `page.goto(...)`.
  - Default: `networkidle`.
- `--output <file>`
  - Output JSON file path.
  - Default: `impact-trace-report.json`.
- `--compare-cache`
  - Runs each target twice:
    - first pass: new-user baseline (cache-cleared by default)
    - second pass: returning-user pass
  - Emits comparison section with deltas.
- `--no-clear-cache`
  - Disables cache clear before first pass in comparison mode.
- `--cpu-seconds <seconds>`
  - Sets the minimum CPU measurement window per run.
  - Default: `3` seconds.
  - Alias: `--cpu-measurement-seconds <seconds>`.
  - Useful for capturing ongoing browser activity such as animations after initial navigation.
- `--no-cpu`
  - Disables CPU measurement entirely.
  - Report totals become network/asset-transfer only for energy/carbon.
- `--cpu-curve-profile <if-default|linear>`
  - Selects the utilization-to-power curve profile used for CPU/device operational estimation.
  - `if-default`: IF/Teads-style curve (`x=[0,10,50,100]`, `y=[0.12,0.32,0.75,1.02]`).
  - `linear`: proportional curve (`x=[0,100]`, `y=[0,1]`).
- `--cpu-to-device-factor <number>`
  - Explicit CPU->Device factor override.
  - Must be a positive number.
  - Takes precedence over profile-weight blending.
- `--cpu-device-profile-factors <desktop:n,laptop:n,tablet:n,mobile:n>`
  - Sets profile factors used for blended CPU->Device scaling.
  - All profile values must be positive.
- `--cpu-device-weights <desktop:n,laptop:n,tablet:n,mobile:n>`
  - Sets device usage weights for the blended factor.
  - Each value must be in range `0..1`.
  - Total must sum to `1`.
- `--grid-intensity-device <value>`
  - Overrides device-segment grid intensity used by co2.js.
  - `<value>` can be a positive number, ISO3 country code (for example `TWN`), or `country:<ISO3>`.
- `--grid-intensity-network <value>`
  - Overrides network-segment grid intensity used by co2.js.
  - Same accepted formats as device.
- `--grid-intensity-networks <value>`
  - Alias for `--grid-intensity-network`.
- `--grid-intensity-datacenter <value>`
  - Overrides data-center segment grid intensity used by co2.js.
  - Same accepted formats as device.
- `--grid-intensity-data-center <value>`
  - Alias for `--grid-intensity-datacenter`.
- `--green-hosting-factor <value>`
  - Portion of hosting powered by renewable/zero-carbon energy.
  - Must be in range `0..1`.
  - Applied to data-center operational carbon only.
- `--return-visitor-ratio <value>`
  - Portion of returning visitors.
  - Must be in range `0..1`.
  - Default: `0.75`.
  - New visitor ratio is derived automatically as `1 - returnVisitorRatio`.
- `--data-cache-ratio <value>`
  - Portion of data loaded from cache for returning visitors.
  - Must be in range `0..1`.
  - Optional in compare mode: when omitted, ImpactTrace derives a value from first/returning transfer bytes.
- `--verbose`
  - Prints verbose model internals after the default developer-first report.
- `--format <console|json|github-pr>`
  - Controls the rendered terminal output.
  - `console` (default): prints the developer-first report.
  - `json`: skips terminal report output.
  - `github-pr`: prints markdown optimized for pull request comments.
  - Can be set by config/env defaults when not provided (`reporting.output.defaultFormat` / `IMPACT_TRACE_REPORT_FORMAT`).
- `--baseline <file>`
  - Path to a previous report JSON.
  - Enables trend deltas in CI summary.
- `--budget-carbon <grams>`
  - Carbon budget for representative visit.
- `--budget-transfer-mb <mb>`
  - Transfer budget in MB.
- `--budget-cpu-seconds <seconds>`
  - CPU budget in seconds.
- `--budget-third-party-mb <mb>`
  - Third-party transfer budget in MB.
- `--score-thresholds <A,B,C,D,E>`
  - Overrides Impact Score thresholds in grams.
- `--findings-limit <n|all>`
  - Overrides how many Key Findings are returned/rendered.
  - Accepts a positive integer, or `0`/`all`/`unlimited`/`none` to return every finding.
  - Can be set by config/env defaults when not provided (`reporting.output.findingsLimit` / `IMPACT_TRACE_FINDINGS_LIMIT`).

Reporting output defaults can also be set in config/env:

- `reporting.output.findingsLimit` / `IMPACT_TRACE_FINDINGS_LIMIT`
  - Accepts a positive integer, or `0`/`all`/`unlimited`/`none` for no limit. Defaults to `5`.
- `reporting.output.githubCommentMaxLines` / `IMPACT_TRACE_GITHUB_COMMENT_MAX_LINES`

## Examples

Single URL:

```bash
impact-trace run --url https://example.com
```

Single URL with explicit navigation readiness:

```bash
impact-trace run --url https://example.com --wait-until load
```

Single URL with comparison mode:

```bash
impact-trace run --url https://example.com --compare-cache
```

Multiple URLs with comparison mode:

```bash
impact-trace run --url https://example.com --url https://www.transformuk.com --compare-cache
```

Journey script mode:

```bash
impact-trace run src/examples/basicJourney.ts --compare-cache
```

Custom output path:

```bash
impact-trace run --url https://example.com --output reports/impacttrace.json
```

Custom CPU sampling window:

```bash
impact-trace run --url https://example.com --cpu-seconds 5
```

Disable CPU measurement:

```bash
impact-trace run --url https://example.com --no-cpu
```

Use linear CPU curve profile:

```bash
impact-trace run --url https://example.com --cpu-curve-profile linear
```

Use weighted CPU device profiles:

```bash
impact-trace run --url https://example.com \
  --cpu-device-profile-factors desktop:2.4,laptop:1.8,tablet:1.5,mobile:1.3 \
  --cpu-device-weights desktop:0.35,laptop:0.35,tablet:0.1,mobile:0.2
```

Override with a single explicit factor:

```bash
impact-trace run --url https://example.com --cpu-to-device-factor 2.1
```

Segment grid-intensity overrides:

```bash
impact-trace run --url https://example.com \
  --grid-intensity-device 565.629 \
  --grid-intensity-datacenter TWN \
  --grid-intensity-network country:DEU
```

Representative compare run with explicit audience/cache factors:

```bash
impact-trace run --url https://example.com --compare-cache \
  --return-visitor-ratio 0.6 \
  --data-cache-ratio 0.9 \
  --cpu-to-device-factor 1.9 \
  --green-hosting-factor 0.5
```

Developer-first report with budgets, baseline trend, and PR output:

```bash
impact-trace run --url https://example.com \
  --format github-pr \
  --baseline impact-trace-report.previous.json \
  --budget-carbon 2 \
  --budget-transfer-mb 10 \
  --budget-cpu-seconds 1 \
  --budget-third-party-mb 1
```
```

## Journey Script Contract

Journey scripts must export a default async function that receives a Playwright page.

```ts
import type { Page } from 'playwright';

export default async function run(page: Page): Promise<void> {
  await page.goto('https://example.com');
}
```

## JSON Metadata

Output now uses an envelope with `formatVersion`, `generatedAt`, `raw`, `defaultView`, `ci`, and `githubComment`.

Use `--verbose` to include `verboseView`.

See `docs/report-schema.json` for the JSON schema.

Reports include resolved grid-intensity values (after CLI/env/config/default precedence is applied) under:

- `modelInputs.resolvedGridIntensity.device`
- `modelInputs.resolvedGridIntensity.network`
- `modelInputs.resolvedGridIntensity.dataCenter`

Reports also include the source used for user-device operational values under:

- `modelInputs.userDeviceOperationalSource`

This helps audit exactly which intensity values were used during CI runs.

Reports include configurable factor metadata under:

- `modelInputs.greenHostingFactor`
- `modelInputs.greenHostingFactorSource`
- `modelInputs.returnVisitorRatio`
- `modelInputs.returnVisitorRatioSource`
- `modelInputs.newVisitorRatio`
- `modelInputs.dataCacheRatio`
- `modelInputs.dataCacheRatioSource`
- `modelInputs.cpuCurveProfile`
- `modelInputs.cpuCurveSource`
- `modelInputs.cpuUtilizationPercent`
- `modelInputs.cpuPowerFactor`
- `modelInputs.cpuMeasurementWindowMs`
- `modelInputs.cpuToDeviceEnergyFactor`
- `modelInputs.cpuToDeviceEnergyFactorBlended`
- `modelInputs.cpuToDeviceFactorSource`
- `modelInputs.cpuToDeviceProfileFactors`
- `modelInputs.cpuToDeviceUsageWeights`

Reports include SWDM segment/category totals under `swdmSegments` for top-level totals, per-URL breakdown, and compare-cache first/returning/delta sections.

In compare-cache mode, reports also include `comparison.representativeVisit` (audience-weighted totals).

For compatibility, transfer split totals remain available under `transferSegments`.
