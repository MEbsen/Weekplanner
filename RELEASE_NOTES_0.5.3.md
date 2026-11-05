# Week Planner 0.5.3

Stable release based on 0.5.3-dev.32, confirmed working in Home Assistant.

- Panel and cards share configuration, request cache, data loading and subscriptions per Home Assistant browser connection.
- Scroll mode and fixed scroll hour are configured once through Week Planner's shared configuration, including cards in fullscreen/panel views.
- Follow NOW handles slow initialization, hidden views and late layout changes without a short startup timeout.
- Manual wheel, touch, scrollbar and keyboard scrolling is respected; delayed browser scroll events do not incorrectly disable Follow NOW.
- Fixed first rendering when a panel connects with unchanged data already in the shared cache.
- Fixed source refreshes being skipped, old calendar responses overwriting newer data, misleading weather health, null temperature conversion and unnecessary rerenders.
- Fixed the card editor dropping its required card type when saving settings.
- Hardened configuration permissions, request validation and integration reload handling.

## Updating

Update Week Planner through HACS, restart Home Assistant and reload the browser.
Select Follow NOW under Week Planner's shared Configure dialog. Old card-local
scroll_mode/default_scroll_hour values are ignored; card height, day count,
toolbar and hide flags remain local. Existing dashboard card types are preserved.

## Validation

32 JavaScript regression/integration tests, 5 Python backend boundary tests,
Chromium layout/scroll/editor tests with 6x CPU throttling, HACS validation and
Hassfest. User confirmed dev.32 working in Home Assistant before promotion.
