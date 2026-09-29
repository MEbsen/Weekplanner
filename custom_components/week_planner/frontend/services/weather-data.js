// Weather data normalization belongs to the data layer: it converts provider
// forecast payloads into the raw shape Week Planner's existing frontend expects.

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function normalizeDailyForecast(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.datetime)
    .map((item) => ({
      ...item,
      // HA providers are not completely uniform about daily low-temperature
      // naming. Keep the frontend contract stable.
      templow: item.templow ?? item.temperature_low ?? item.low_temperature ?? null,
      temperature: item.temperature ?? item.temperature_high ?? item.high_temperature ?? null,
    }));
}

export function dailyForecastFromHourly(items = []) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.datetime) continue;
    const key = localDateKey(item.datetime);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const result = [];
  for (const [key, day] of groups) {
    if (!day.length) continue;
    const temperatures = day.map((item) => Number(item.temperature)).filter(Number.isFinite);
    const representative = day.find((item) => {
      const hour = new Date(item.datetime).getHours();
      return hour >= 11 && hour <= 14;
    }) || day[Math.floor(day.length / 2)] || day[0];

    result.push({
      ...representative,
      datetime: `${key}T12:00:00`,
      temperature: temperatures.length ? Math.max(...temperatures) : representative.temperature ?? null,
      templow: temperatures.length ? Math.min(...temperatures) : representative.templow ?? null,
      _weekPlannerDerivedFromHourly: true,
    });
  }
  return result;
}

export function ensureDailyWeather(manager) {
  const normalized = normalizeDailyForecast(manager.dailyWeather);
  if (normalized.length) {
    manager.dailyWeather = normalized;
    return false;
  }

  const fallback = dailyForecastFromHourly(manager.hourlyWeather);
  if (!fallback.length) return false;
  const changed = manager.changed(manager.dailyWeather || [], fallback);
  manager.dailyWeather = fallback;
  return changed;
}
