# ImpactTrace

ImpactTrace is a carbon estimation CLI for web application journeys in CI pipelines.

It executes browser journeys with Playwright, captures resource/network data, estimates energy usage and carbon impact, and provides developer-friendly optimization suggestions.

## Why ImpactTrace

- Track carbon impact for critical user paths
- Compare first-time vs returning-visitor behavior with cache comparison mode
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
- Total network transfer (MB)
- Top contributors (asset path, size, estimated CO2)
- Actionable suggestions

In multi-URL mode, ImpactTrace also prints per-URL breakdowns and aggregate totals.

## Configuration and CLI Options

See full options reference in [docs/cli-options.md](docs/cli-options.md).

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
