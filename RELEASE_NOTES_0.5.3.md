# Week Planner 0.5.3

This release is a major internal stabilization and architecture update for Week Planner.

## Highlights

- Refactored data retrieval and state into a shared DataManager used by both the panel and Lovelace card.
- Panel and card now use the same provider and integration configuration path; card configuration is limited to presentation-specific settings.
- Improved daily weather handling, including normalization and fallback from hourly forecast data when required.
- Extracted and stabilized shared scroll behavior for panel and card, including temporary manual-scroll override and return to configured scroll mode.
- Added Source Health infrastructure for monitoring data-source freshness and runtime health.
- Restored and hardened frontend/static-resource registration after the refactor.
- Fixed calendar refresh/change detection and preserved calendar/entity data across the DataManager cutover.
- Fixed weather, sun/moon, energy-price and history/entity data paths after the architecture split.
- Removed legacy/parallel card provider configuration that could cause panel and card to behave differently.

## Architecture

Week Planner now has a clearer separation of responsibilities:

- **DataManager**: retrieves data, keeps last-known-good state and detects changes.
- **Week Planner frontend**: projects and renders calendar, weather, sun/moon, energy and history data.
- **Panel / Card**: two presentation surfaces over the same integration configuration and data pipeline.

This provides a cleaner foundation for future Week Planner development and reduces duplicated panel/card behavior.
