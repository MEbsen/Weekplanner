from pathlib import Path

PATH = Path("custom_components/week_planner/frontend/week-planner-core.js")
text = PATH.read_text(encoding="utf-8")


def remove_method(source: str, name: str) -> str:
    marker = f"  {name}("
    start = source.find(marker)
    if start < 0:
        async_marker = f"  async {name}("
        start = source.find(async_marker)
    if start < 0:
        print(f"method already absent: {name}")
        return source
    brace = source.find("{", start)
    if brace < 0:
        raise RuntimeError(f"opening brace not found for {name}")
    depth = 0
    quote = None
    escape = False
    i = brace
    while i < len(source):
        ch = source[i]
        if quote:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                quote = None
            i += 1
            continue
        if ch in ("'", '"', '`'):
            quote = ch
            i += 1
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                while end < len(source) and source[end] in " \t\r\n":
                    end += 1
                print(f"removed method: {name}")
                return source[:start] + source[end:]
        i += 1
    raise RuntimeError(f"closing brace not found for {name}")


for method in (
    "_scrollTargetForMode",
    "_shouldAutoRepositionAfterRender",
    "_resumeAutoScroll",
    "_positionScroll",
):
    text = remove_method(text, method)

# This block belonged to the legacy controller. The service keeps its own
# viewport state and restores it after the DOM has been rebuilt.
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
if legacy_render_block in text:
    text = text.replace(legacy_render_block, "", 1)
    print("removed legacy pre-render viewport preservation")
else:
    print("legacy pre-render viewport preservation already absent")

legacy_fields = (
    "_initialScrolled",
    "_scrollPositioned",
    "_scrollRequestId",
    "_savedScrollTop",
    "_savedScrollLeft",
    "_scrollState",
    "_programmaticScrollUntil",
)

# Remove remaining simple writes to state owned by ScrollController.
lines = []
for line in text.splitlines(keepends=True):
    stripped = line.strip()
    if any(f"this.{field}" in stripped for field in legacy_fields):
        is_write = (
            ("=" in stripped and not any(op in stripped for op in ("===", "!==", "==", "!=", ">=", "<=")))
            or stripped.endswith("++;")
            or stripped.endswith("--;")
        )
        if is_write:
            print(f"removed legacy state write: {stripped}")
            continue
    lines.append(line)
text = "".join(lines)

for field in legacy_fields:
    if f"this.{field}" in text:
        raise RuntimeError(f"legacy scroll state still referenced: {field}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
