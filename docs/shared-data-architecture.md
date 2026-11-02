# Shared configuration and data
Implementation version: 0.5.3-dev.28 (development prerelease).

## Ownership
A WeakMap keyed by the authenticated Home Assistant connection owns one WeekPlannerStore per browser JavaScript realm. Panel, managed dashboard and Lovelace cards obtain that store through sharedStore(hass). A different connection gets a different store.

The store owns authoritative integration configuration, request deduplication, bounded transport cache, date-range data managers, calendar subscriptions and one network polling timer. There is no card-specific provider configuration.

Each view owns its date selection, day count, layout, height, local layer masks, dialogs and scroll controller. Hiding weather never clears shared weather data. Changing card height or colors does not invalidate source caches.

## Date ranges and cache
Views displaying the same start date and day count share the very same manager and raw data objects. Different ranges get isolated calendar/history/sun/moon snapshots so navigation cannot overwrite another view. Requests for range-independent forecasts are shared across ranges.

Transport cache keys include source/config generation and complete request arguments. Concurrent identical requests share a promise; successful calendar requests remain reusable for 55 seconds and other source requests for 290 seconds. Failures are retryable and requests time out after 30 seconds.

Source configuration changes invalidate managers and requests. Presentation-only configuration changes preserve source data. Inactive date ranges release subscriptions; at most 12 recent ranges are retained. Transport cache is pruned to 128 settled entries at range access, while in-flight work is retained.

Partial overlap (for example 7 days versus 14 days) currently uses separate range queries for calendar/history. It still shares forecasts. This avoids invalid date slicing or incorrectly merging calendar occurrences. A future per-day cache can optimize overlapping range requests without changing view ownership.

## Configuration propagation
Saving settings applies the returned persisted configuration to every attached view immediately. The shared store also polls configuration every minute and refreshes it on focus/recovery. An old config request cannot overwrite a newer saved configuration.

Separate tabs and devices have separate JavaScript heaps and connections; they converge through backend configuration polling. The singleton does not share browser memory across tabs or devices.

## Lifecycle and race handling
One store timer handles calendar polling each minute and full refresh every five minutes. Views retain their own lightweight NOW/scroll timer only. Last detach stops network polling and subscriptions, while cached data remains available for navigation back.

Same-range calendar polls and full loads coalesce. Date/config managers capture immutable request context. Superseded config/range results cannot replace the active view's manager. Push calendar events invalidate older poll responses; obsolete or late subscription setup is unsubscribed. Failed subscriptions are retried.

Health render signatures include source/status/error, not timestamps. Unchanged successful polls do not rebuild the DOM. Weather health aggregates hourly/daily outcomes; retained cache is not marked fresh after a failed fetch. Daily derivation requires fresh hourly input.

## Backend changes
Global configuration writes require Home Assistant administrator access. Nested rendering values and astronomy request sizes are validated. Moon computation runs in an executor; yearly sunlight calculation yields between dates and caches by year/location/timezone. Static-path and websocket registration flags belong to the Home Assistant instance and survive entry reloads.

## Validation
Run:
- node --test tests/*.test.mjs
- python -m unittest discover -s tests -p 'test_*.py'
- python -m compileall -q custom_components/week_planner

On restricted Windows hosts, use node --test --test-isolation=none tests/*.test.mjs to avoid restricted child-process creation.

Coverage includes shared cache/request/subscription ownership, 7/14-day views, config broadcast, source-cache preservation, out-of-order responses, disconnect cleanup, forecast failures/fallback, null temperatures and health render signatures. A minimal DOM harness exercises the actual frontend entrypoint and adapters. Python boundary tests run selected backend functions without importing Home Assistant; they do not replace Hassfest or HA integration tests.

Before release, test in real Home Assistant: panel/card simultaneously, source changes from either surface, rapid navigation, 7-to-14-day card changes, weather outage/recovery, layer toggles, scroll/focus/day rollover, integration reload, administrator/non-administrator access and HACS upgrade. No release or push has been performed as part of this implementation.
