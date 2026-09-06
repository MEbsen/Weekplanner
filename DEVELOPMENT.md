# Week Planner development workflow

Week Planner uses a stable/release workflow.

## Branches

- `main`: stable code only
- `dev`: active development and test builds

Normal development happens on `dev`.

## Development flow

1. Make changes on `dev`.
2. Test the dev build in Home Assistant.
3. Open a pull request from `dev` to `main`.
4. HACS validation and Hassfest must pass.
5. Merge only after functional testing is complete.
6. Bump the version from e.g. `0.5.3-dev` to `0.5.3`.
7. Create a GitHub release/tag `v0.5.3`.
8. HACS users update from the stable release.

## Versioning

- Development builds: `0.5.3-dev`
- Stable patch: `0.5.3`
- New backwards-compatible features: `0.6.0`
- Breaking changes: next major version

## Testing focus

Before release, test at minimum:

- native Week Planner dashboard
- custom Week Planner card
- existing configuration migration
- calendar events
- weather
- sun/moon
- energy prices
- history overlays
- scroll modes
- navigation
- HACS update path
