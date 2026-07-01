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

- Total carbon (g CO2)
- Total energy (kWh)
- CPU time (s)
- CPU carbon and energy totals
- Total network transfer (MB)
- Transfer split by segment (device, network, data centre) for carbon and energy
- Top contributors (asset path, size, estimated CO2)
- Actionable suggestions

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

To disable CPU measurement entirely and use network transfer/asset size only:

```bash
npx impact-trace run --url https://example.com --no-cpu
```

Network transfer carbon is estimated via `@tgwf/co2` `perByteTrace()` segmented output and defaults to operational-only emissions. Embodied emissions and consumer-device transfer emissions are excluded from the network component.

JSON output includes:

- Resolved grid-intensity metadata at `modelInputs.resolvedGridIntensity`
- User-device operational source metadata at `modelInputs.userDeviceOperationalSource`
- SWDM segment/category totals at `swdmSegments` (dataCenters/networks/userDevices, each with operational and embodied carbon + energy)
- In compare mode, SWDM totals are present in `comparison.firstVisit.swdmSegments`, `comparison.returningVisit.swdmSegments`, and `comparison.delta.swdmSegments`
- Backward-compatible transfer totals remain at `transferSegments`
- Green hosting / visitor/cache model inputs at `modelInputs.*` (including source metadata)
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
  "greenHostingFactor": 0.3,
  "returnVisitorRatio": 0.75,
  "dataCacheRatio": 0.8,
  "gridIntensity": {
    "device": 565.629,
    "dataCenter": { "country": "TWN" },
    "network": 442
  }
}
```

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
