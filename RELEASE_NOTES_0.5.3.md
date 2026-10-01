# Week Planner 0.5.3

Week Planner 0.5.3 is a major internal stabilization and architecture release.

## Highlights

- Shared DataManager for panel and Lovelace card.
- Panel and card now use the same provider and integration configuration path.
- Card configuration is limited to presentation-specific settings.
- Improved daily weather handling and normalization.
- Shared/stabilized scroll service with temporary manual override behavior.
- Source Health infrastructure for data-source/runtime health.
- Hardened frontend/static-resource registration.
- Calendar refresh/change detection fixes after the DataManager cutover.
- Stabilized weather, sun/moon, energy-price and history/entity data paths.
- Removed legacy parallel card provider configuration that could make panel and card behave differently.

## Architecture

- **DataManager** retrieves data, keeps last-known-good state and detects changes.
- **Week Planner frontend** projects and renders calendar, weather, sun/moon, energy and history data.
- **Panel and Card** are two presentation surfaces over the same integration configuration and data pipeline.

This release establishes the cleaner foundation for future Week Planner development.
