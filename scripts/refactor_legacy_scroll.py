from pathlib import Path
import re

PATH = Path("custom_components/week_planner/frontend/week-planner-core.js")
text = PATH.read_text(encoding="utf-8")


def remove_method(source: str, name: str) -> str:
    start_match = re.search(rf"(?m)^  (?:async )?{re.escape(name)}\([^\n]*\) \{{\n", source)
    if not start_match:
        print(f"method already absent: {name}")
        return source
    next_match = re.search(r"(?m)^  (?:async )?[A-Za-z_$][\w$]*\([^\n]*\) \{\n", source[start_match.end():])
    if not next_match:
        raise RuntimeError(f"next method boundary not found after {name}")
    end = start_match.end() + next_match.start()
    return source[:start_match.start()] + source[end:]

for method in ("_scrollTargetForMode", "_shouldAutoRepositionAfterRender", "_resumeAutoScroll", "_positionScroll"):
    text = remove_method(text, method)

text = text.replace('''    // Rendering is never allowed to decide where the user should be.
    // Preserve the current timeline position before replacing DOM.
    const previousScroll = this.shadowRoot.getElementById("scroll");
    if (previousScroll && this._scrollPositioned) {
      const mode = this._effectiveScrollMode();
      if (this._scrollState === "manual" || mode === "fixed") {
        this._savedScrollTop = previousScroll.scrollTop;
        this._savedScrollLeft = previousScroll.scrollLeft || 0;
      }
    }

''', "", 1)

text = text.replace('''      timelineScroll.addEventListener("scroll", () => {
        if (this._scrollPositioned && Date.now() > this._programmaticScrollUntil) {
          this._savedScrollTop = timelineScroll.scrollTop;
          this._savedScrollLeft = timelineScroll.scrollLeft;
          this._scrollState = "manual";
          this._scrollRequestId++;
        }
        headerScroll.scrollLeft = timelineScroll.scrollLeft;
      }, { passive:true });
''', '''      timelineScroll.addEventListener("scroll", () => {
        headerScroll.scrollLeft = timelineScroll.scrollLeft;
      }, { passive:true });
''', 1)

settle_start = text.find("    const renderGeneration = ++this._renderGeneration;\n")
if settle_start >= 0:
    marker = "    settleAfterRender();\n"
    settle_end = text.find(marker, settle_start)
    if settle_end < 0:
        raise RuntimeError("legacy settleAfterRender end marker missing")
    text = text[:settle_start] + text[settle_end + len(marker):]

# Dashboard-card viewport sizing used to consult the legacy controller. Initial
# and focus positioning are now service lifecycle responsibilities.
text = text.replace('''    // Only an unpositioned planner may request automatic positioning here.
    // Normal resizes and data refreshes preserve the existing scrollTop.
    if (this._scrollState === "auto" && !this._scrollPositioned) {
      this._positionScroll("viewport-ready", true);
    }
''', "", 1)

legacy_fields = (
    "_initialScrolled", "_scrollPositioned", "_scrollRequestId",
    "_savedScrollTop", "_savedScrollLeft", "_scrollState",
    "_programmaticScrollUntil", "_renderGeneration",
)
lines = []
for line in text.splitlines(keepends=True):
    if any(f"this.{field}" in line for field in legacy_fields):
        continue
    lines.append(line)
text = "".join(lines)

for field in legacy_fields:
    if f"this.{field}" in text:
        raise RuntimeError(f"legacy scroll state still referenced: {field}")
for required in ("this._positionScroll(", "this._resumeAutoScroll("):
    if required not in text:
        raise RuntimeError(f"expected service hook call missing: {required}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
