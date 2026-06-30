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

## Journey Script Contract

Journey scripts must export a default async function that receives a Playwright page.

```ts
import type { Page } from 'playwright';

export default async function run(page: Page): Promise<void> {
  await page.goto('https://example.com');
}
```
