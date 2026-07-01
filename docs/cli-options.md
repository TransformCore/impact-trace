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

## Examples

Single URL:

```bash
impact-trace run --url https://example.com
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
  --green-hosting-factor 0.5
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

Reports include SWDM segment/category totals under `swdmSegments` for top-level totals, per-URL breakdown, and compare-cache first/returning/delta sections.

In compare-cache mode, reports also include `comparison.representativeVisit` (audience-weighted totals).

For compatibility, transfer split totals remain available under `transferSegments`.
