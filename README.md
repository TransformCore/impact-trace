# ImpactTrace

ImpactTrace is a carbon estimation CLI for web application journeys in CI pipelines.

It executes browser journeys with Playwright, captures resource/network data, estimates energy usage and carbon impact, and provides developer-friendly optimization suggestions.

## Why ImpactTrace

- Track carbon impact for critical user paths
- Compare first-time vs returning-visitor behavior with cache comparison mode
- Include browser CPU execution impact in total energy and carbon estimates
- Identify high-impact assets with contributor ranking
- Produce machine-readable JSON for CI/CD reporting and dashboards

## Features

- Journey-script mode (custom Playwright flow)
- URL mode (single URL or multiple URLs)
- Plugin-oriented architecture for extensibility
- Carbon modeling separated from measurement collection
- Rule-based developer insights:
  - Large images (>200 KB)
  - Large JavaScript bundles (>300 KB)
  - Third-party resource detection
- Configurable CPU wattage model (env or repo config)
- Configurable CPU measurement window to capture ongoing activity like animations (default 3s)
- Optional CPU-off mode for network/asset-only reporting (`--no-cpu`)
- Configurable segment grid intensity overrides (device, network, data center)

## Install

### From source

```bash
npm install
npm run build
```

### Run directly in this repo

```bash
npx impact-trace run --url https://example.com
```

## Quick Start

### 1) Run against a single URL

```bash
npx impact-trace run --url https://example.com
```

URL mode waits for `networkidle` by default. To override:

```bash
npx impact-trace run --url https://example.com --wait-until load
```

### 2) Run against multiple URLs

```bash
npx impact-trace run --url https://example.com --url https://www.transformuk.com
```

### 3) Compare new vs returning user behavior

```bash
npx impact-trace run --url https://www.transformuk.com --compare-cache
```

### 4) Run a custom journey script

```bash
npx impact-trace run src/examples/basicJourney.ts --compare-cache
```

## Output

ImpactTrace outputs:

- Human-readable console report
- JSON report file (default: impact-trace-report.json)

Console report includes:

- Executive summary with Impact Score (A-F)
- Impact breakdown by category (video, images, JavaScript, fonts, third-party, other)
- Key findings prioritized by estimated reduction potential
- Potential savings summary
- Cache effectiveness summary (new vs returning visit)
- Budget pass/fail table
- CI summary suitable for pull request comments

Use `--verbose` to append model internals (SWDM matrix, assumptions, and model inputs).

In multi-URL mode, ImpactTrace also prints per-URL breakdowns and aggregate totals.

## CPU Wattage Configuration

ImpactTrace resolves CPU wattage with this precedence:

1. Environment variable `IMPACT_TRACE_CPU_WATTS`
2. Repo config file `impact-trace.config.json` (`cpuWatts`)
3. Built-in default (`20`)

ImpactTrace resolves CPU measurement window with this precedence:

1. CLI flag `--cpu-seconds`
2. Environment variable `IMPACT_TRACE_CPU_MEASUREMENT_SECONDS`
3. Repo config file `impact-trace.config.json` (`cpuMeasurementSeconds`)
4. Built-in default (`3`)

CPU is measured from journey start through at least the configured window, so short journeys still capture post-load activity such as animations.

ImpactTrace resolves CPU->Device factor with this precedence:

1. CLI `--cpu-to-device-factor`
2. Environment variable `IMPACT_TRACE_CPU_TO_DEVICE_ENERGY_FACTOR`
3. Repo config file `impact-trace.config.json` (`cpuToDeviceEnergyFactor`)
4. Blended profile factor from `cpuToDeviceEnergyProfileFactors` and `cpuToDeviceUsageWeights`

Default profile factors:

- `desktop=2.4`
- `laptop=1.8`
- `tablet=1.5`
- `mobile=1.3`

Default usage weights:

- `desktop=0.35`
- `laptop=0.35`
- `tablet=0.10`
- `mobile=0.20`

Default blended factor from these values is `1.88`.

You can override profile factors and weights with env vars:

- `IMPACT_TRACE_CPU_TO_DEVICE_PROFILE_FACTORS` (`desktop:2.4,laptop:1.8,tablet:1.5,mobile:1.3`)
- `IMPACT_TRACE_CPU_TO_DEVICE_USAGE_WEIGHTS` (`desktop:0.35,laptop:0.35,tablet:0.1,mobile:0.2`)

Or with CLI flags:

```bash
npx impact-trace run --url https://example.com \
  --cpu-device-profile-factors desktop:2.4,laptop:1.8,tablet:1.5,mobile:1.3 \
  --cpu-device-weights desktop:0.35,laptop:0.35,tablet:0.1,mobile:0.2
```

Weights must sum to `1`.

To disable CPU measurement entirely and use network transfer/asset size only:

```bash
npx impact-trace run --url https://example.com --no-cpu
```

Network transfer carbon is estimated via `@tgwf/co2` `perByteTrace()` segmented output and defaults to operational-only emissions. Embodied emissions and consumer-device transfer emissions are excluded from the network component.

JSON output includes:

- Envelope fields: `formatVersion`, `generatedAt`, `raw`, `defaultView`, `ci`, `githubComment`
- Optional `verboseView` when `--verbose` is enabled

- Resolved grid-intensity metadata at `modelInputs.resolvedGridIntensity`
- User-device operational source metadata at `modelInputs.userDeviceOperationalSource`
- SWDM segment/category totals at `swdmSegments` (dataCenters/networks/userDevices, each with operational and embodied carbon + energy)
- In compare mode, SWDM totals are present in `comparison.firstVisit.swdmSegments`, `comparison.returningVisit.swdmSegments`, and `comparison.delta.swdmSegments`
- Backward-compatible transfer totals remain at `transferSegments`
- Green hosting / visitor/cache model inputs at `modelInputs.*` (including source metadata)
- CPU device factor blend metadata at `modelInputs.cpuToDevice*`
- In compare mode, audience-weighted totals at `comparison.representativeVisit`

Visitor/cache and hosting factors can be configured with this precedence:

1. CLI flags (`--green-hosting-factor`, `--return-visitor-ratio`, `--data-cache-ratio`)
2. Environment variables (`IMPACT_TRACE_GREEN_HOSTING_FACTOR`, `IMPACT_TRACE_RETURN_VISITOR_RATIO`, `IMPACT_TRACE_DATA_CACHE_RATIO`)
3. Repo config file `impact-trace.config.json`
4. Defaults (`greenHostingFactor=0`, `returnVisitorRatio=0.75`)

`newVisitorRatio` is always derived as `1 - returnVisitorRatio`.

In `--compare-cache` mode, `dataCacheRatio` is derived from first/returning network bytes when not explicitly provided.

Grid intensity for co2.js segments can be overridden with this precedence:

1. CLI flags (`--grid-intensity-device`, `--grid-intensity-network`, `--grid-intensity-datacenter`)
2. Environment variables (`IMPACT_TRACE_GRID_INTENSITY_*`)
3. Repo config file `impact-trace.config.json` (`gridIntensity`)
4. co2.js defaults

Segment override values support:

- Positive numbers
- Country objects (`{ "country": "TWN" }`) in config
- ISO3 country strings (`TWN`) or `country:TWN` in CLI

Example:

```json
{
  "cpuWatts": 20,
  "cpuMeasurementSeconds": 3,
  "cpuToDeviceEnergyProfileFactors": {
    "desktop": 2.4,
    "laptop": 1.8,
    "tablet": 1.5,
    "mobile": 1.3
  },
  "cpuToDeviceUsageWeights": {
    "desktop": 0.35,
    "laptop": 0.35,
    "tablet": 0.1,
    "mobile": 0.2
  },
  "greenHostingFactor": 0.3,
  "returnVisitorRatio": 0.75,
  "dataCacheRatio": 0.8,
  "gridIntensity": {
    "device": 565.629,
    "dataCenter": { "country": "TWN" },
    "network": 442
  },
  "reporting": {
    "budgets": {
      "carbonGrams": 2,
      "transferMb": 10,
      "cpuSeconds": 1,
      "thirdPartyMb": 1
    },
    "scoreThresholds": {
      "A": 0.5,
      "B": 1,
      "C": 2,
      "D": 5,
      "E": 10
    },
    "output": {
      "defaultFormat": "console",
      "findingsLimit": 3,
      "githubCommentMaxLines": 40
    }
  }
}
```

Reporting output settings can also be configured via environment variables:

- `IMPACT_TRACE_REPORT_FORMAT` (`console|json|github-pr`)
- `IMPACT_TRACE_FINDINGS_LIMIT`
- `IMPACT_TRACE_GITHUB_COMMENT_MAX_LINES`

## Configuration and CLI Options

See full options reference in [docs/cli-options.md](docs/cli-options.md).

## Carbon Model Documentation

See model overview and equations in [docs/carbon-models.md](docs/carbon-models.md).

## Architecture

Core structure:

- src/cli: argument parsing and report formatting
- src/core: runner and plugin orchestration
- src/plugins: measurement plugins (Playwright browser plugin)
- src/models: carbon and insights modeling
- src/types: shared types and report schema

The architecture is intentionally extensible for future additions such as:

- Docker/container CPU instrumentation
- Backend correlation headers
- Region-specific carbon intensity
- CI carbon budgets and failure thresholds

## Development

```bash
npm run build
npm run dev run src/examples/basicJourney.ts --compare-cache
```

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening pull requests.

## Code of Conduct

This project follows the Contributor Covenant. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT. See [LICENSE](LICENSE).
