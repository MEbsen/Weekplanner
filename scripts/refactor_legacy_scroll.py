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
    template_expr_depth = 0
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
                while end < len(source) and source[end] in " \t":
                    end += 1
                if end < len(source) and source[end] == "\r":
                    end += 1
                if end < len(source) and source[end] == "\n":
                    end += 1
                if end < len(source) and source[end] == "\n":
                    end += 1
                print(f"removed method: {name}")
                return source[:start] + source[end:]
        i += 1
    raise RuntimeError(f"closing brace not found for {name}")


# Methods whose implementation is now owned by services/scroll-controller.js
# and services/scroll-integration.js.
for method in (
    "_scrollTargetForMode",
    "_shouldAutoRepositionAfterRender",
    "_resumeAutoScroll",
    "_positionScroll",
):
    text = remove_method(text, method)

# Legacy controller state.  Calls such as this._positionScroll(...) deliberately
# remain in core: scroll-integration installs the service-backed implementation
# on the prototype before a WeekPlanner instance is used.
legacy_fragments = (
    "    this._initialScrolled = false;\n",
    "    this._scrollPositioned = false;\n",
    "    this._scrollRequestId = 0;\n",
    "    this._savedScrollTop = null;\n",
    "    this._savedScrollLeft = 0;\n",
    "    this._scrollState = \"auto\";\n",
    "    this._programmaticScrollUntil = 0;\n",
    "    this._scrollState = \"auto\";\n    this._scrollPositioned = false;\n    this._savedScrollTop = null;\n    this._scrollRequestId++;\n",
    "    this._scrollState = \"auto\";\n    this._scrollPositioned = false;\n    this._scrollRequestId++;\n    this._savedScrollTop = null;\n",
    "    this._initialScrolled = false;\n    this._scrollState = \"auto\";\n    this._scrollPositioned = false;\n    this._scrollRequestId++;\n    this._savedScrollTop = null;\n    this._savedScrollLeft = 0;\n",
)
for fragment in sorted(legacy_fragments, key=len, reverse=True):
    text = text.replace(fragment, "")

# Any remaining direct writes to legacy-only fields are dead state and should
# not survive this strangler cleanup.  Remove only simple assignment/update
# statements; reads cause the verification below to fail instead of guessing.
legacy_fields = (
    "_initialScrolled",
    "_scrollPositioned",
    "_scrollRequestId",
    "_savedScrollTop",
    "_savedScrollLeft",
    "_scrollState",
    "_programmaticScrollUntil",
)
lines = []
for line in text.splitlines(keepends=True):
    stripped = line.strip()
    if any(f"this.{field}" in stripped for field in legacy_fields):
        is_simple_write = (
            "=" in stripped
            and not any(op in stripped for op in ("===", "!==", "==", "!=", ">=", "<="))
        ) or stripped.endswith("++;") or stripped.endswith("--;" )
        if is_simple_write:
            print(f"removed legacy state write: {stripped}")
            continue
    lines.append(line)
text = "".join(lines)

# Guardrail: after removing the service-owned methods, core must not make
# decisions based on legacy scroll state. Dynamic calls to the service-backed
# methods are allowed.
for field in legacy_fields:
    if f"this.{field}" in text:
        raise RuntimeError(f"legacy scroll state still referenced: {field}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
