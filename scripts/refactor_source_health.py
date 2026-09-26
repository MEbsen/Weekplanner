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
    print(f"removed method: {name}")
    return source[:start_match.start()] + source[end:]


# Remove legacy state ownership wherever a panel/card constructor reset it.
text, source_resets = re.subn(r"(?m)^\s*this\._sourceHealth = \{\};\n", "", text)
text, runtime_resets = re.subn(
    r'''(?m)^\s*this\._runtimeHealth = \{\n\s*status: "unknown",\n\s*last_success: null,\n\s*last_attempt: null,\n\s*last_error: "",\n\s*\};\n''',
    "",
    text,
)
print(f"removed source state resets: {source_resets}")
print(f"removed runtime state resets: {runtime_resets}")

# These methods are supplied by source-health-integration.js after core loads.
for method in (
    "_healthNowIso",
    "_markSourceAttempt",
    "_markSourceSuccess",
    "_markSourceFailure",
    "_activeHealthItems",
    "_healthIconMarkup",
):
    text = remove_method(text, method)

# Runtime lifecycle keeps deciding *when* health changes, while the service
# owns the state and rules for those transitions.
text = text.replace(
    "    this._runtimeHealth.last_attempt = this._healthNowIso();\n",
    "    this._markRuntimeAttempt();\n",
)

runtime_success = '''      this._runtimeHealth = {
        status: "fresh",
        last_success: this._healthNowIso(),
        last_attempt: this._healthNowIso(),
        last_error: "",
      };
'''
text = text.replace(runtime_success, "      this._markRuntimeSuccess();\n")

runtime_failure = '''      this._runtimeHealth = {
        ...(this._runtimeHealth || {}),
        status: this._runtimeHealth?.last_success ? "stale" : "error",
        last_attempt: this._healthNowIso(),
        last_error: String(err?.message || err),
      };
'''
text = text.replace(runtime_failure, "      this._markRuntimeFailure(err);\n")

for legacy in ("this._sourceHealth", "this._runtimeHealth"):
    if legacy in text:
        raise RuntimeError(f"legacy health state still referenced: {legacy}")

# Verify the integration-owned API remains used by core.
for required in (
    "this._markSourceAttempt(",
    "this._markSourceSuccess(",
    "this._markSourceFailure(",
    "this._markRuntimeAttempt(",
    "this._markRuntimeSuccess(",
    "this._markRuntimeFailure(",
    "this._healthIconMarkup(",
):
    if required not in text:
        raise RuntimeError(f"expected SourceHealth hook missing: {required}")

PATH.write_text(text, encoding="utf-8")
print(f"wrote {PATH} ({len(text)} chars)")
