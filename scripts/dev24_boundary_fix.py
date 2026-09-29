from pathlib import Path
p=Path('custom_components/week_planner/frontend/week-planner-core.js')
s=p.read_text()
s=s.replace('const hourlyMap = this._dataManager().hourlyWeatherMap();','const hourlyMap = this._hourlyWeatherMap();')
s=s.replace('const dailyMap = this._dataManager().dailyWeatherMap();','const dailyMap = this._dailyWeatherMap();')
s=s.replace('const moonTransitionLines = this._dataManager().moonTransitionsForDay(day).map((item) => {','const moonTransitionLines = this._moonTransitionsForDay(day).map((item) => {')
s=s.replace('const changed = this._calendarDataChanged(nextEvents);\n            this._dataManager().events = nextEvents;','const manager = this._dataManager();\n            const changed = manager.changed(manager.events || {}, nextEvents);\n            manager.events = nextEvents;')
for bad in ['_dataManager().hourlyWeatherMap(', '_dataManager().dailyWeatherMap(', '_dataManager().moonTransitionsForDay(', '_calendarDataChanged(']:
    if bad in s: raise SystemExit(f'remaining invalid boundary call: {bad}')
p.write_text(s)
