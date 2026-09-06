# Week Planner for Home Assistant

An experimental seven-day calendar panel for Home Assistant with hourly weather integrated directly into each day's timeline.

## Version 0.4.2

Current prototype features:

- Seven-day week view
- One-hour visual grid
- 30-minute snap guide lines
- Current day highlighted
- Moving current-time line
- Automatic scroll around the current time
- Hourly weather icons + temperature
- Click weather for details
- Calendar events from one or more Home Assistant calendar entities
- Click events for details
- Completed events are faded
- Past portion of the current day is subtly faded
- Previous / next week navigation

### Not implemented yet

- Editing/creating/deleting events
- Drag/drop
- Resize
- Overlapping-event column layout
- All-day event row
- Weather history
- HACS default-store publication

## Manual installation (0.4.2)

1. Open your Home Assistant configuration directory.
2. Copy the folder:

   `custom_components/week_planner`

   into:

   `/config/custom_components/week_planner`

3. Restart Home Assistant.
4. Go to **Settings → Devices & services → Add integration**.
5. Search for **Week Planner**.
6. Select:
   - one `weather.*` entity
   - one or more `calendar.*` entities
7. Finish setup.
8. A **Week Planner** item should appear in the Home Assistant sidebar.

If the panel does not appear immediately, hard-refresh the browser because Home Assistant aggressively caches frontend resources.

## HACS goal

The repository is already structured as a HACS custom-integration repository:

- `custom_components/week_planner/`
- `hacs.json`
- versioned `manifest.json`
- README
- GitHub workflow placeholder

For development, you can add the GitHub repository as a **Custom repository** in HACS using category **Integration**. Once the project is mature, it can be submitted to HACS' default repository list.

## Data sources

Week Planner does not connect directly to Google Calendar or weather providers.

Instead, it consumes Home Assistant entities:

- `calendar.*`
- `weather.*`

That means Google Calendar, CalDAV, Local Calendar, Met.no and other providers can be used as long as they already expose entities in Home Assistant.

## Development status

This is an early prototype. Back up your Home Assistant configuration before testing custom integrations.

## 0.1.1 fix

- Fixed panel registration for modern Home Assistant versions.
- Removed use of the deprecated/removed `hass.components` API.
- Uses `homeassistant.components.frontend.async_register_built_in_panel(hass, ...)`.
## 0.1.2 fixes

- Calendar and weather response actions now use Home Assistant's WebSocket `call_service`
  command with `return_response: true`.
- Added a Home Assistant Options Flow.
- Weather source and calendars can now be changed using **Configure** on the
  Week Planner integration.
- Added a **Configure** button to the planner toolbar which opens the
  integration page.
## 0.1.3 changes

- **Configure** now opens directly inside Week Planner.
- Add/remove calendar entities without leaving the planner.
- Change the weather entity in the same dialog.
- Configuration is saved back to the existing Home Assistant config entry.
- Updated Options Flow implementation for current Home Assistant releases.
- Added `single_config_entry` to the manifest.
## 0.2.0

### Fixed

- Timed events may cross midnight. An event such as `18:00 → 00:00` now fills
  the calendar from 18:00 to the bottom of that day instead of collapsing to
  the minimum event height.
- Timed events intersecting more than one day are rendered as clipped segments
  on each relevant day.
- Event details use robust date/time rendering, including events ending at midnight.
- The details dialog is guarded against reopening errors.

### Added

- Per-calendar colors configurable with a color picker in Week Planner settings.
- Overlapping events are laid out side-by-side within the same day.
- Daily weather icon in each day header.
- Weather display mode: **Hourly**, **Daily**, or **Both**.
- Daily weather icons are clickable for forecast details.
- Hourly and daily forecast failures are isolated so one unsupported forecast
  type does not prevent calendar data or the other weather type from loading.

### Notes

All-day events are still intentionally excluded from the timed grid. A dedicated
all-day row is planned separately.
## 0.3.0

- Added a sticky ribbon below the day headers.
- Native all-day events automatically use the ribbon.
- Each calendar can be configured as:
  - **Auto**: native all-day events in ribbon, timed events in grid
  - **Ribbon**: all events from the calendar in ribbon
  - **Timeline**: force events into the timed grid
- Added optional ISO week number in the header.
- Added configurable initial scroll hour (default 06:00).
- Day headers and ribbon stay sticky while the time grid scrolls.
- Added sunrise/sunset markers in the shared time column for today.
  Times are calculated using Home Assistant's own Astral sun helper and HA location.
- Today's day column can be 50% wider than the other days.
- All options are available from the in-panel Configure dialog.

The ribbon calendar mode is intended for sources such as waste collection calendars
that publish reminder-like entries as ordinary timed events (for example 07:00–15:00).


## 0.3.1

- Fixed planner viewport behavior.
- Day headers and the ribbon are now outside the vertical timeline scroller and
  therefore remain visible at all times.
- Only the 00:00–24:00 time grid scrolls vertically.
- The configured "first visible hour" only controls the initial scroll position;
  hours before it remain fully available by scrolling upward.
- Horizontal scrolling is synchronized between the fixed header/ribbon and the
  timeline grid.


## 0.3.3

- Rolled back the aggressive panel sizing changes from 0.3.2 that could prevent
  the custom panel from rendering.
- Kept the header/ribbon and timeline as separate layout regions.
- Kept the full 00:00–24:00 timeline scrollable with configurable initial scroll.
- Fixed ISO local date formatting for sunrise/sunset calculations.
- Simplified sun marker rendering.


## 0.3.4

- The panel now explicitly sizes itself to the remaining browser viewport based
  on its actual top position inside Home Assistant.
- Header/day information and ribbon are physically outside the vertical
  timeline scroll container.
- Timeline has explicit horizontal and vertical scrolling.
- Horizontal timeline scroll is synchronized to the fixed day/ribbon header.
- Restored the missing frontend call to `week_planner/sun_times`.
- Sunrise/sunset data now uses proper ISO local date strings.
- The complete 00:00–24:00 grid remains available; the configured start hour
  only determines the initial timeline scroll position.


## 0.3.5

- Initial timeline auto-scroll is now performed only once per panel load.
- The user's vertical and horizontal timeline scroll position is preserved
  across weather/calendar refreshes and week navigation.
- Sunrise and sunset markers moved from the shared time column into each
  individual day column.
- Sunrise and sunset are shown as full-width horizontal marker lines with
  icon, label and exact local time.
- Sunrise and sunset use distinct colors from the current-time line.


## 0.3.6

- Sunrise/sunset labels moved to the right side of each day column.
- Solar lines still span the full day column.
- This avoids overlap with hourly weather icons on the left side.


## 0.3.7

- Added configurable calendar period:
  - **Calendar week**: Monday through Sunday
  - **Today + 6 days**: rolling seven-day view with today in the first column
- Rolling mode follows the current day whenever the panel is loaded or "Today"
  is selected.
- Week number header shows both ISO week numbers when the seven-day range
  crosses a week boundary, for example `Uge 32/33`.


## 0.3.8

- Added daylight duration per visible day, calculated from sunrise to sunset.
- Added daily daylight change compared with the previous day.
- Example header display: `14:52 −3 min` or `07:30 +12 min`.
- Week Planner requests sunrise/sunset for the day before the visible range so
  the first visible day also gets a correct delta.
- Daylight information is displayed next to the daily weather summary in the
  day header.


## 0.3.9

- Daylight change now uses the year's calculated minimum/maximum daylight length
  as its reference rather than the previous day.
- While days are increasing, the header shows how much daylight has been gained
  since the year's shortest calculated day.
- While days are decreasing, the header shows how much daylight has been lost
  since the year's longest calculated day.
- Example: `7:30 +1:12` means 7 h 30 min daylight and 1 h 12 min more than the
  shortest day of that year.
- Example: `14:10 −2:47` means 14 h 10 min daylight and 2 h 47 min less than the
  longest day of that year.
- Yearly extrema are calculated with Home Assistant's own sun calculations for
  the configured HA location and cached per year.
- Daylight duration in the header is tied to the same **Show sunrise/sunset**
  option. Disable solar markers and both the solar lines and header daylight
  information disappear.


## 0.3.10

- Sunset marker line changed to a warm red/orange tone for faster visual distinction.
- Added a sun icon before daylight duration in each day header.
- Example: `☀️ 14:10 −2:47`.


## 0.3.11

- Added a hover tooltip to daylight duration in the day header.
- Tooltip explains the values in plain language, for example:
  `Dagens længde er 14:10. Dagen er aftaget med 2:47 timer siden årets længste dag.`
- Daylight summary uses a help cursor to indicate that explanatory hover text is available.


## 0.3.14

- Moon marker is now shown only when the planner's eight-phase moon category changes.
- Added `ephem==4.2.1` as a Home Assistant custom-integration requirement.
- Ephem 4.2.1 provides Python 3.14 wheels and high precision lunar calculations.
- Week Planner numerically finds the transition between its eight 45-degree
  phase categories to approximately one minute.
- A grey line is placed at the actual calculated transition time.
- Example: `🌗 Sidste kvarter 03:42`.
- Hover text explains the new phase and whether the moon is waxing or waning.
- No moon marker is shown on days without a phase-category transition.

Note: the eight icons are UI phase categories. The Moon changes continuously;
only new moon, first quarter, full moon and last quarter are conventional exact
astronomical named phase events.


## 0.3.15

- Added a visual week-boundary indicator in **Today + 6 days** / rolling mode.
- The first day of the next calendar week gets a thicker accent-colored left border.
- The separator spans the day header, ribbon and full time grid.
- A small `NY UGE` label is shown in the day header at the boundary.
- Calendar-week mode is unchanged because the visible range already starts at the week boundary.
- Week Planner currently treats Monday as the week start; this helper is isolated so it can later follow a configurable/user-local week-start setting.


## 0.3.16

- Home Assistant is now the authoritative clock for Week Planner.
- The backend returns Home Assistant's current local time together with the
  configured HA timezone.
- The frontend calculates a server/client clock offset and advances time locally
  between synchronizations.
- `I DAG`, the current-time line, past-event fading, past-weather fading and the
  rolling `Today + 6 days` start date now use Home Assistant time instead of the
  browser/device clock.
- Server time is re-synchronized every five minutes alongside normal data refresh.


## 0.3.17

- Added **None / Ingen** as a fourth weather display mode.
- When weather display is set to None, neither hourly weather nor daily weather
  is fetched or rendered.
- Added real-time calendar subscriptions using Home Assistant's
  `calendar/event/subscribe` WebSocket API for each selected calendar.
- Subscription ranges follow the currently visible seven-day interval and are
  recreated when the displayed week/range or calendar selection changes.
- Added a calendar-only 60-second fallback refresh. Weather, astronomy data and
  server-time synchronization keep their slower normal refresh cadence.
- New/changed events should therefore appear as soon as Home Assistant pushes a
  calendar update, with a one-minute Week Planner fallback when push is not
  available.


## 0.3.18

- Added optional per-calendar **Event icon/avatar** configuration.
- Each selected calendar can choose a Home Assistant entity as its visual identity.
- Week Planner uses `entity_picture` first; if no picture exists it falls back to
  the selected entity's `icon`.
- `person.*` entities are listed first in the selector, followed by other entities
  that expose an entity picture or icon.
- Select **Intet event-ikon/avatar** to remove the identity from a calendar again.
- The avatar/icon is rendered on both timed events and ribbon/all-day/reminder events.
- Avatar configuration is stored per calendar alongside color and display mode.


## 0.3.19

- Event identity can now be configured per calendar as:
  - **None**
  - **Home Assistant entity/avatar**
  - **MDI icon**
- MDI selection uses Home Assistant's native `ha-icon-picker`, giving access to
  the full MDI icon catalog known by the installed Home Assistant frontend,
  including icon-name/alias search.
- Selected MDI icons are stored directly as values such as `mdi:trash-can`.
- Existing entity-picture/avatar support is unchanged.
- Selecting **None** removes the event icon/avatar from the calendar.
- A manual `mdi:` text input is retained as a fallback if the native picker
  component is not registered in a particular frontend context.


## 0.3.20

- Configuration dialog widened from ~520 px to up to 980 px.
- Each calendar is displayed as a separate settings card with clearer columns
  for enabled state, calendar name, placement, event identity/avatar and color.
- Added responsive stacking for narrower screens.
- The configuration dialog now remains open during calendar push updates,
  weather refreshes, server-time synchronization and other background data
  refreshes.
- Background data continues to update while configuration is open; the main
  planner view is rendered once the settings dialog is closed.
- Escape, Cancel and the close button correctly release the settings-dialog lock.


## 0.3.21

- Hardened configuration persistence.
- Planner settings are mirrored into both config-entry `data` and `options`.
- The backend verifies every submitted setting immediately after
  `hass.config_entries.async_update_entry`.
- `week_planner/update_config` now returns the authoritative configuration read
  back from Home Assistant.
- The frontend no longer treats local form values as saved state.
- After save, the frontend performs a second `week_planner/config` read and only
  reports **Gemt og verificeret** when Home Assistant returns the persisted
  values.
- This specifically covers per-calendar icons/avatars, moon-phase visibility,
  colors, display modes and the remaining planner settings.


## 0.3.22

- The configuration dialog now shows the running Week Planner version directly
  in the title, for example `Konfigurer Week Planner (v0.3.22)`.
- The version comes from the backend configuration response, so it reflects the
  integration version actually loaded by Home Assistant.


## 0.3.23

- Added optional **Historikmarkører** as a completely separate data source.
- Empty history-source list means Week Planner performs no History API request.
- History entities are chosen with Home Assistant's native `ha-entity-picker`.
- Each configured history entity has its own marker color and can be removed again.
- Week Planner reads only Home Assistant Recorder/history for the currently visible
  seven-day interval; it does not store or duplicate historical state data.
- State changes render as colored horizontal lines with a clickable
  `Friendly name · state` label at the exact `last_changed` time.
- Clicking a marker shows entity ID, timestamp, current state, previous state and
  attributes returned by Home Assistant.
- Baseline state returned from before the visible period is not drawn as an event.


## 0.3.24

- Fixed History entity-picker persistence by tracking Home Assistant's
  `value-changed` event explicitly.
- Automation entities are supported as History marker sources.
- Automation executions are detected from Recorder records where the
  `last_triggered` attribute changes, rather than from the automation entity's
  normal `on`/`off` state.
- Automation markers use the actual `last_triggered` timestamp and render as
  `<automation name> · triggered`.
- Clicking an automation marker displays its `last_triggered`, recorder
  timestamps and recorded attributes.
- Normal sensor/binary_sensor/etc. history markers continue to use Recorder
  state history and `last_updated` timestamps.


## 0.3.25

- Fixed the root cause of empty History-source configuration:
  `history_sources` was persisted by the backend but omitted from the
  `week_planner/config` response, causing the verified frontend config to reset
  the list to empty.
- Rewrote `config_flow.py` cleanly after accumulated patch artifacts and ensured
  in-panel-only settings such as history sources, calendar colors, display modes
  and avatars are preserved by the standard Options Flow.
- Hardened Home Assistant entity-picker tracking with `value-changed`, `change`
  and `input` listeners and a direct picker-value fallback at save time.
- Settings save now refuses to silently discard a visible History row whose
  entity cannot be resolved.
- Fixed initial timeline auto-scroll after a full page refresh:
  - loading renders no longer consume the initial-scroll lifecycle
  - no scroll position is captured before the configured initial position is applied
  - full page initialization resets remembered scroll state
  - configured start hour is applied only after the real timeline has rendered
- User-adjusted scroll position is still preserved after the initial auto-scroll.


## 0.3.26

- Added optional **Elpris** data source.
- Electricity-price display can be enabled/disabled independently of weather.
- Price source is selected with Home Assistant's native entity picker and can be
  switched to another compatible `sensor.*`.
- Energi Data Service is supported through its documented:
  - `raw_today`
  - `raw_tomorrow`
  - `forecast` (Carnot)
  object arrays using `hour` + `price`.
- Generic compatibility also accepts timestamp-like keys
  (`hour`, `time`, `datetime`, `start`, `timestamp`, `date`) with value-like keys
  (`price`, `value`, `rate`, `cost`), plus simple numeric `today` / `tomorrow`
  hourly arrays.
- Configuration shows a compatibility message for the selected sensor.
- Hourly prices render in the left metadata lane alongside/below hourly weather,
  with a lightning icon and compact price.
- Electricity prices remain visible when weather is disabled.
- Clicking an hourly price opens details with source entity, time, price and unit.
- Week Planner reads the selected Home Assistant sensor only; it has no direct
  dependency on Energi Data Service, Carnot, Nord Pool or API credentials.


## 0.3.27

- Hardened configuration persistence after adding electricity-price settings.
- Rebuilt the backend frontend-settings serializer explicitly so every persistent
  setting is returned, including:
  - history sources
  - electricity price entity
  - electricity price visibility
  - calendar icons/avatars
  - moon visibility
  - all existing planner options
- Save verification now explicitly compares the persisted History-source list and
  electricity-price settings before showing `Gemt og verificeret`.
- If Home Assistant returns different values, the settings dialog now reports a
  persistence error instead of silently accepting and later rolling back the UI.


## 0.4.0 — Dashboard card

Week Planner can now run in two frontend modes from the same integration:

1. **Panel / sidebar app** — the existing full-screen Week Planner.
2. **Lovelace dashboard card** — `custom:week-planner-card`.

Both modes reuse the same Week Planner backend, data loading and main planner
rendering engine. Calendar selection, colors, event icons/avatars, weather,
electricity prices, sun/moon settings and History sources remain shared in the
normal Week Planner configuration.

### Add the frontend resource

Until Week Planner is distributed as a dedicated HACS frontend resource, add the
bundled JavaScript once under **Settings → Dashboards → Resources**:

```text
/week_planner_static/week-planner.js?v=0.5.0
```

Resource type: **JavaScript Module**.

The sidebar panel already loads this file for itself, but Lovelace needs the
resource registered independently so the dashboard knows
`custom:week-planner-card` even before the Week Planner panel has been opened.

After adding/updating the resource, hard-refresh the browser.

### Add the card

The card registers itself in Home Assistant's custom-card catalog and provides a
graphical card editor through `getConfigElement()` and a default configuration
through `getStubConfig()`.

Minimal YAML:

```yaml
type: custom:week-planner-card
height: 700
show_toolbar: true
```

Card-specific options in 0.4.0:

- `height`: internal planner height in pixels, 320–1600, default 700.
- `show_toolbar`: show/hide Week Planner's own toolbar.

The card deliberately inherits the integration's shared Week Planner settings
instead of creating a second copy of every calendar/data-source option.


## 0.4.1 — Follow current time

- Added a configurable **Timeline focus** mode.
- **Fixed start time** keeps the existing configured first-visible-hour behavior.
- **Follow current time** is available in the full panel and positions the
  Home Assistant NOW line roughly one hour below the top of the timeline.
- The panel refocuses at every full clock hour, using Home Assistant's
  authoritative server time.
- Manual scrolling remains possible between hourly refocuses.
- The Lovelace dashboard card intentionally keeps fixed-start behavior in 0.4.1.


## 0.4.2

- Fixed settings-save error: `newScrollMode is not defined`.
- Treats the full Week Planner panel as the master configuration.
- Dashboard cards can adopt/reproduce that panel while keeping card-only
  presentation options: height, toolbar, hide weather, hide sun/daylight,
  hide electricity prices.
- Added temporary panel-header toggles for configured weather, sun/daylight and
  electricity-price layers.
- Header toggles are session-only and never modify the stored configuration.


## 0.4.3

- Fixed panel weather quick-toggle: render now respects the transient weather
  visibility state instead of reading the persistent weather mode directly.
- Re-enabling weather re-fetches hourly/daily data if the hidden state had
  cleared the cached forecast.
- Fixed Lovelace card editor configuration:
  - preserves the full Home Assistant card config
  - always preserves/emits `type: custom:week-planner-card`
  - preserves unknown/future card fields instead of discarding them
  - stub config is now self-contained
- Card `setConfig()` now normalizes missing values instead of failing on a
  partially-created editor config.
- Turning off **Adoptér/gengiv main panelet** now shows a clear placeholder;
  independent card data-source configuration is not silently faked.


## 0.4.4 — Empty configuration

- Week Planner now supports a true zero-source configuration.
- Panel can be installed/opened with no calendars, no weather, no electricity
  prices, no History sources and no sun/moon display configured.
- Weather entity and calendar list are optional in the Home Assistant config flow
  and in Week Planner's update-config WebSocket API.
- A blank installation defaults weather and sun display to off.
- The Week Planner shell still renders day headers, navigation and the complete
  time grid so configuration can be built incrementally.
- A dashboard card with **Adoptér/gengiv main panelet** disabled now renders a
  real empty planner rather than a placeholder/error message.
- The empty independent card does not inherit the main panel's calendars or data
  layers.


## 0.4.5 — Lovelace card registration fix

- Fixed dashboard-card creation after 0.4.3/0.4.4.
- `WeekPlannerCard.getStubConfig()` no longer includes the `type` field.
  Home Assistant owns/adds `type: custom:week-planner-card` when creating the
  card from the picker.
- Card editor now preserves the complete incoming Lovelace configuration instead
  of synthesizing a `type` value.
- Existing cards keep their Home Assistant-supplied `type` unchanged.
- Empty independent-card behavior from 0.4.4 is retained.


## 0.4.6

- Fixed Follow-current-time persistence by returning `scroll_mode` in the
  authoritative backend configuration response.
- Removed the remaining requirement for at least one selected calendar.
- Independent cards now overlay their own Lovelace configuration during data
  loading, calendar subscriptions and rendering, preventing main-panel data from
  leaking into a non-adopting card.
- Added an independent card configuration section for calendars, weather,
  sun/moon, electricity prices, week number, view mode and initial scroll hour.
- All independent-card data sources are optional; a card can remain completely
  empty and be configured later.


## 0.4.7

- Reworked **Follow current time** scrolling:
  - waits for two browser animation frames before measuring the timeline
  - retries shortly afterward if Home Assistant has not completed layout
  - does not mark initial scroll complete when the timeline is not yet scrollable
  - tracks the last focused clock hour
  - checks the hour on every minute tick as a fallback to the exact-hour timer
  - forces an immediate follow check when the option is enabled
- Card picker registration now uses `preview: false`, avoiding construction of
  the full planner while Home Assistant is merely browsing card types.
- Added `window.weekPlannerFrontendVersion = "0.4.7"` and the frontend version to
  the card-picker description for easier cache/version diagnosis.
- Manual dashboard resource URL should be versioned as:
  `/week_planner_static/week-planner.js?v=0.5.0`
  because the panel itself already cache-busts the JS URL but a manually-added
  Lovelace resource without a query string may stay cached across test builds.


## 0.4.8 — Unified per-instance auto-scroll

- Panel and dashboard cards now use the same auto-scroll engine.
- Each instance has its own scroll configuration.
- Three modes:
  - **No automatic scroll**
  - **Scroll to configured time**
  - **Follow current time**
- Fixed-time and Follow-NOW modes place the target time as close to the top of
  the timeline viewport as possible, constrained only by the end of the 24-hour
  grid.
- Follow-NOW works for both panel and card and continues to refocus on hour
  changes.
- Cards retain their own `scroll_mode` and `default_scroll_hour` even when they
  adopt the main panel's data configuration.


## 0.4.9 — Lovelace editor contract fix

- `getConfigElement()` now waits for `week-planner-card-editor` to be registered
  before returning it to Home Assistant.
- The editor now has a safe `connectedCallback()` and always exposes `setConfig()`.
- Refreshed `window.customCards` registration without duplicate entries.
- Frontend marker is now `0.4.9`.


## 0.4.10 — Card period and calendar styling

- Dashboard cards always use a rolling period beginning today.
- Each card has its own `days_to_show` setting (1–14 days).
- The shared planner engine now uses an instance day-count method so calendar,
  history, sun and event queries match the number of days actually rendered.
- Previous/Today/Next navigation is hidden on cards because the card is always
  anchored to today.
- Independent card calendar configuration now includes per-calendar:
  - color
  - no icon / MDI icon / Home Assistant entity-avatar
- Calendar colors and icons are stored in the Lovelace card configuration and do
  not modify the master Week Planner panel.
- Adopted cards continue to inherit panel calendar colors/icons; independent
  cards can define their own.


## 0.4.11 — Card registration and automatic resource versioning

- Restored a conservative Home Assistant custom-card registration flow.
- `getConfigElement()` is synchronous again.
- Fixed a 0.4.10 constructor regression where `scroll_mode` referenced
  `this._cardConfig` while `_cardConfig` was still being created.
- Week Planner now reports the current frontend resource URL from the backend:
  `/week_planner_static/week-planner.js?v=<installed version>`.
- When the Week Planner panel loads, it tries to create/update the Lovelace
  JavaScript-module resource automatically through Home Assistant's Lovelace
  resource WebSocket API.
- This means users should no longer need to manually change `?v=...` for every
  Week Planner release. If Home Assistant does not allow resource mutation in
  the current dashboard/storage mode, the operation is skipped safely and the
  manual resource remains the fallback.
- The existing resource path is reused; only its version query is updated.


## 0.4.12 — Card day count

- Added visible **Antal dage** setting to the dashboard-card editor.
- Each card can show 1–14 days.
- Cards always start on today.
- Calendar, history, sun and other date-window queries now use the card's
  configured day count instead of a hard-coded seven-day interval.


## 0.4.13 — Per-calendar styling in dashboard cards

- Independent dashboard cards now support per-calendar:
  - color
  - no event icon
  - MDI event icon
  - Home Assistant entity/avatar
- Calendar styling is stored in the Lovelace card configuration and does not
  alter the main Week Planner panel.
- Calendar styling controls appear after calendars are selected.


## 0.4.14 — Card navigation window

- Panel navigation continues to move one full week backward/forward.
- Dashboard-card navigation moves by the card's configured visible day count.
  Example: a 4-day card moves 4 days backward/forward per arrow click.
- The Today button resets the card start date to today.
- Card navigation therefore replaces the complete visible date window instead
  of creating a partially-overlapping range.


## 0.5.0 — Native Home Assistant dashboard

Week Planner's full-screen experience is now hosted by a real Lovelace dashboard
instead of a custom frontend panel.

### Architecture

- **Week Planner dashboard**
  - Native Home Assistant storage-mode Lovelace dashboard.
  - Appears in Home Assistant's dashboard management.
  - Registered at `/week-planner`.
  - Uses a single panel view with `custom:week-planner-dashboard-card`.
  - Uses the central Week Planner integration configuration.
  - Keeps the full panel feature set and 7-day navigation behavior.

- **Week Planner Card**
  - Remains `custom:week-planner-card`.
  - Can be added to any other Lovelace dashboard.
  - Keeps card-specific settings from 0.4.14, including day count,
    per-calendar colors/icons, independent/adopted configuration, scrolling,
    and navigation by the visible day count.

### Lovelace integration

The integration now depends on Home Assistant's Lovelace integration and uses
Home Assistant's dashboard/resource storage collection APIs. It does not write
directly to `.storage`.

On first setup, Week Planner:
1. registers the frontend JavaScript module as a Lovelace resource,
2. creates the native `week-planner` dashboard if it does not already exist,
3. saves a panel-view configuration containing the full-screen Week Planner host,
4. registers the Lovelace panel for the current runtime.

Existing native Week Planner dashboard metadata is preserved on ordinary reloads.
Removing the Week Planner integration removes its managed dashboard/resource.


## 0.5.1 — Follow NOW dashboard fix

- Fixed a regression where the native Week Planner dashboard could remain at the top of the timeline even when **Følg NU** was selected.
- Follow NOW now retries positioning while Lovelace finishes calculating the dashboard/card viewport.
- The native dashboard host triggers a new Follow NOW positioning pass once its final viewport height is known.
- Hourly follow behavior is unchanged: the current-time line is kept as high in the visible timeline as possible so more of the upcoming day remains visible.


## 0.5.2 — Stable Follow NOW scrolling

- Fixed the calendar jumping back to the top on every minute update.
- Minute updates now move only the current-time indicator instead of re-rendering the whole planner.
- Follow NOW repositions only on initial load and when the hour changes.
- Manual scrolling is therefore no longer overridden every minute.


## 0.5.3-dev.2 — Day-focus scroll controller

- Reworked Follow NOW as a deterministic AUTO/MANUAL state machine.
- AUTO places NOW as high as possible while never scrolling beyond the final viewport ending at 24:00.
- User scrolling switches to MANUAL and remains static until reload or panel focus.
- Data refreshes preserve the current scroll position and never trigger automatic repositioning.
- First load, panel focus, and hourly changes re-evaluate day focus only while in AUTO.
- The behavior is shared by the native dashboard and the Week Planner card.
