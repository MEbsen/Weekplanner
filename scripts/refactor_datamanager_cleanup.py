from pathlib import Path
import re

PATH = Path("custom_components/week_planner/frontend/week-planner-core.js")
text = PATH.read_text(encoding="utf-8")

fields = {
    "_events": "events",
    "_hourlyWeather": "hourlyWeather",
    "_dailyWeather": "dailyWeather",
    "_sunTimes": "sunTimes",
    "_daylightExtrema": "daylightExtrema",
    "_moonTransitions": "moonTransitions",
    "_historyData": "historyData",
}

# Constructor state is now owned exclusively by WeekPlannerDataManager.
for legacy, _manager in fields.items():
    text, count = re.subn(rf"(?m)^\s*this\.{re.escape(legacy)} = (?:\{{\}}|\[\]);\n", "", text, count=1)
    print(f"removed constructor {legacy}: {count}")

# Rendering/projection code reads the authoritative DataManager directly.
# This removes the temporary prototype compatibility accessors introduced in dev.18.
for legacy, manager in fields.items():
    text = text.replace(f"this.{legacy}", f"this._dataManager().{manager}")

# The old helper compared the legacy calendar field. DataManager already owns
# change detection during fetchCalendars(), so keeping it would reintroduce the
# compatibility abstraction.
method = re.search(r"(?m)^  _calendarDataChanged\([^\n]*\) \{\n", text)
if method:
    nxt = re.search(r"(?m)^  (?:async )?[A-Za-z_$][\w$]*\([^\n]*\) \{\n", text[method.end():])
    if not nxt:
        raise RuntimeError("next method boundary not found after _calendarDataChanged")
    end = method.end() + nxt.start()
    text = text[:method.start()] + text[end:]
    print("removed _calendarDataChanged")

for legacy in fields:
    if f"this.{legacy}" in text:
        raise RuntimeError(f"legacy DataManager field remains: {legacy}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
