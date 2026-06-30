# Contributing to ImpactTrace

Thanks for your interest in contributing to ImpactTrace.

## Ways to Contribute

- Report bugs and edge cases
- Suggest new measurement/modeling features
- Improve documentation and examples
- Submit fixes and enhancements

## Development Setup

1. Fork and clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

4. Run locally:

```bash
npx impact-trace run --url https://example.com
```

## Pull Request Guidelines

- Keep changes focused and small when possible.
- Update documentation for behavior or CLI changes.
- Preserve backwards compatibility where reasonable.
- Add or update tests if you introduce test coverage later.
- Ensure the project builds before opening a PR:

```bash
npm run build
```

## Commit Message Suggestions

Use clear, imperative messages, for example:

- feat: add cache comparison for URL mode
- fix: prevent double-counting browser transfer size
- docs: add CLI options reference

## Reporting Issues

When opening an issue, please include:

- What command you ran
- Expected behavior
- Actual behavior
- Environment details (OS, Node.js version)
- Relevant logs/output

## Questions

Open a discussion or issue if you are unsure about design direction before implementing large changes.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
