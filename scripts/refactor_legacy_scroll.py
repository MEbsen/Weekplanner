from pathlib import Path
import re

PATH = Path("custom_components/week_planner/frontend/week-planner-core.js")
text = PATH.read_text(encoding="utf-8")


def remove_method(source: str, name: str) -> str:
    # WeekPlanner core methods are consistently indented two spaces. Removing
    # from the named method header to the next class method avoids trying to
    # parse JavaScript/template-literal braces in a migration script.
    start_match = re.search(rf"(?m)^  (?:async )?{re.escape(name)}\([^\n]*\) \{{\n", source)
    if not start_match:
        print(f"method already absent: {name}")
        return source
    next_match = re.search(r"(?m)^  (?:async )?[A-Za-z_$][\w$]*\([^\n]*\) \{\n", source[start_match.end():])
    if not next_match:
        raise RuntimeError(f"next method boundary not found after {name}")
    end = start_match.end() + next_match.start()
    print(f"removed method: {name}")
    return source[:start_match.start()] + source[end:]


for method in (
    "_scrollTargetForMode",
    "_shouldAutoRepositionAfterRender",
    "_resumeAutoScroll",
    "_positionScroll",
):
    text = remove_method(text, method)

legacy_render_block = '''    // Rendering is never allowed to decide where the user should be.
    // Preserve the current timeline position before replacing DOM.
    const previousScroll = this.shadowRoot.getElementById("scroll");
    if (previousScroll && this._scrollPositioned) {
      const mode = this._effectiveScrollMode();
      if (this._scrollState === "manual" || mode === "fixed") {
        this._savedScrollTop = previousScroll.scrollTop;
        this._savedScrollLeft = previousScroll.scrollLeft || 0;
      }
    }

'''
text = text.replace(legacy_render_block, "", 1)

legacy_fields = (
    "_initialScrolled",
    "_scrollPositioned",
    "_scrollRequestId",
    "_savedScrollTop",
    "_savedScrollLeft",
    "_scrollState",
    "_programmaticScrollUntil",
)

# Remaining occurrences outside removed methods are lifecycle resets belonging
# to the old controller. They are simple single-line assignments/increments.
lines = []
for line in text.splitlines(keepends=True):
    if any(f"this.{field}" in line for field in legacy_fields):
        print(f"removed legacy state line: {line.strip()}")
        continue
    lines.append(line)
text = "".join(lines)

for field in legacy_fields:
    if f"this.{field}" in text:
        raise RuntimeError(f"legacy scroll state still referenced: {field}")

# The public/service hooks must remain: core lifecycle calls these dynamically,
# and scroll-integration supplies their service-backed implementations.
for required in ("this._positionScroll(", "this._resumeAutoScroll("):
    if required not in text:
        raise RuntimeError(f"expected service hook call missing: {required}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
