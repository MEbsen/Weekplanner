from pathlib import Path
import re

p = Path('custom_components/week_planner/frontend/week-planner-core.js')
s = p.read_text()

# Keep only presentation/navigation settings on the Lovelace card. All data
# source settings come from the integration config shared with the panel.
card_start = s.index('class WeekPlannerCard extends WeekPlannerPanel')
editor_start = s.index('class WeekPlannerCardEditor extends HTMLElement', card_start)
card = s[card_start:editor_start]

# Remove data-source/default fields from constructor and stub config.
data_keys = [
    'adopt_panel','calendar_entities','calendar_avatars','calendar_colors',
    'weather_entity','weather_display','show_sun_markers','show_moon_markers',
    'energy_entity','show_energy_prices','show_week_number','enlarge_today','view_mode'
]
for key in data_keys:
    card = re.sub(rf'^\s+{key}:.*\n', '', card, flags=re.M)

# Remove data-source assignments in setConfig, including multiline calendar maps.
card = re.sub(r'^\s+adopt_panel: incoming\.adopt_panel !== false,\n', '', card, flags=re.M)
card = re.sub(r'^\s+calendar_entities:.*\n', '', card, flags=re.M)
card = re.sub(r'^\s+calendar_colors:.*?^\s+: \{\},\n', '', card, flags=re.M | re.S)
card = re.sub(r'^\s+calendar_avatars:.*?^\s+: \{\},\n', '', card, flags=re.M | re.S)
for key in ['weather_entity','weather_display','show_sun_markers','show_moon_markers','energy_entity','show_energy_prices','show_week_number','enlarge_today','view_mode']:
    card = re.sub(rf'^\s+{key}:.*\n', '', card, flags=re.M)

# Scroll signature must not depend on the removed adopt_panel switch.
card = re.sub(r'^\s+adopt_panel: this\._cardConfig\.adopt_panel,\n', '', card, flags=re.M)

# setConfig no longer triggers an alternate data lifecycle.
card = re.sub(
    r'    if \(this\._config\) \{\n      if \(this\._cardConfig\.adopt_panel === false\) \{.*?\n      \}\n    \}\n',
    '    if (this._config) {\n      this._render(false);\n    }\n',
    card,
    count=1,
    flags=re.S,
)

# Delete the complete temporary runtime overlay and its data-loading wrappers.
card = re.sub(
    r'\n  _cardRuntimeOverlay\(\) \{.*?\n  getCardSize\(\) \{',
    '\n  getCardSize() {',
    card,
    count=1,
    flags=re.S,
)

# Rendering may alter presentation visibility, but never the shared data config.
card = re.sub(
    r'    const oldConfig = this\._config;\n\n    if \(this\._cardConfig\?\.adopt_panel === false && this\._config\) \{.*?\n    \}\n\n',
    '',
    card,
    count=1,
    flags=re.S,
)
card = card.replace('    this._config = oldConfig;\n', '')
card = re.sub(
    r'\s+\$\{this\._cardConfig\?\.adopt_panel === false \? `.*?` : ""\}\n',
    '\n',
    card,
    count=1,
    flags=re.S,
)

if '_cardRuntimeOverlay' in card or '_withCardRuntimeConfig' in card or 'adopt_panel' in card:
    raise SystemExit('parallel card data config still present')

s = s[:card_start] + card + s[editor_start:]

# Editor defaults should not advertise a second data-source configuration.
editor_start = s.index('class WeekPlannerCardEditor extends HTMLElement')
editor = s[editor_start:]
for key in data_keys:
    editor = re.sub(rf'^\s+{key}:.*\n', '', editor, count=1, flags=re.M)
s = s[:editor_start] + editor

p.write_text(s)
