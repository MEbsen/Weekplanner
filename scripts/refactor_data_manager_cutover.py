from pathlib import Path
import re

PATH = Path("custom_components/week_planner/frontend/week-planner-core.js")
text = PATH.read_text(encoding="utf-8")


def replace_method(source: str, name: str, replacement: str) -> str:
    start = re.search(rf"(?m)^  (?:async )?{re.escape(name)}\([^\n]*\) \{{\n", source)
    if not start:
        raise RuntimeError(f"method not found: {name}")
    nxt = re.search(r"(?m)^  (?:async )?[A-Za-z_$][\w$]*\([^\n]*\) \{\n", source[start.end():])
    if not nxt:
        raise RuntimeError(f"next method boundary not found after {name}")
    end = start.end() + nxt.start()
    return source[:start.start()] + replacement.rstrip() + "\n\n" + source[end:]


refresh = '''  async _refreshCalendarEvents(showError = true) {
    if (!this._hass || !this._config) return;

    const previousHealth = this._stableJson(this._healthSnapshot());
    const result = await this._refreshCalendarEventsManaged();
    const healthChanged = previousHealth !== this._stableJson(this._healthSnapshot());

    if (result?.ok) {
      if (showError && this._error?.startsWith("Kalenderdata")) this._error = "";
      if (result.changed || healthChanged) this._render(false);
      return;
    }

    if (showError) {
      this._error = `Kalenderdata kunne ikke hentes: ${result?.error?.message || result?.error || "Ukendt fejl"}`;
      this._render(false);
    } else if (healthChanged) {
      this._render(false);
    }
  }'''

load = '''  async _loadData(showLoading = true) {
    if (!this._hass || !this._config) return;

    if (showLoading) {
      this._loading = true;
      this._render();
    }

    const previousWarnings = this._warnings || [];
    const previousError = this._error || "";
    const previousHealth = this._stableJson(this._healthSnapshot());

    try {
      const result = await this._loadDataManaged();
      this._warnings = result?.warnings || [];
      this._error = result?.error || "";
      this._loading = false;

      const statusChanged =
        previousError !== this._error ||
        this._stableJson(previousWarnings) !== this._stableJson(this._warnings) ||
        previousHealth !== this._stableJson(this._healthSnapshot());

      if (showLoading || result?.changed || statusChanged) {
        this._render();
      }
    } catch (err) {
      console.error("Week Planner DataManager load failed", err);
      this._error = `Data kunne ikke hentes: ${err?.message || err}`;
      this._loading = false;
      this._render();
    }
  }'''

text = replace_method(text, "_refreshCalendarEvents", refresh)
text = replace_method(text, "_loadData", load)

# Forecast/history retrieval is now owned by DataManager. Projection/rendering
# helpers remain in core until their own strangler slice.
for legacy_method in ("_loadHistoryData", "_callForecast"):
    start = re.search(rf"(?m)^  (?:async )?{re.escape(legacy_method)}\([^\n]*\) \{{\n", text)
    if start:
        nxt = re.search(r"(?m)^  (?:async )?[A-Za-z_$][\w$]*\([^\n]*\) \{\n", text[start.end():])
        if not nxt:
            raise RuntimeError(f"next method boundary not found after {legacy_method}")
        end = start.end() + nxt.start()
        text = text[:start.start()] + text[end:]
        print(f"removed legacy method: {legacy_method}")

for required in (
    "this._loadDataManaged(",
    "this._refreshCalendarEventsManaged(",
):
    if required not in text:
        raise RuntimeError(f"DataManager hook missing: {required}")

for forbidden in (
    "this._callForecast(",
    "this._loadHistoryData(",
):
    if forbidden in text:
        raise RuntimeError(f"legacy data hook remains: {forbidden}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
