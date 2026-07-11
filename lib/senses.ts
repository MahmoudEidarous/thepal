// The orb's senses — where you are and what the sky is doing.
// Everything here runs in the browser: IP geolocation (no permission
// popup, city-level, cached per session) and Open-Meteo (free, no key).

export type Place = {
  city: string;
  region: string | null;
  country: string;
  lat: number;
  lon: number;
};

export type SkyScene =
  | "clear"
  | "partly"
  | "clouds"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export type Weather = {
  place: string;
  now: {
    temp: number;
    feels: number;
    label: string;
    scene: SkyScene;
    isDay: boolean;
    wind: number;
    humidity: number;
  };
  // next 12 hours, for the sparkline and the rain window
  hours: Array<{ t: string; temp: number; precip: number }>;
  rainWindow: string | null; // "rain likely around 18:00 (78%)"
  today: { hi: number; lo: number };
  tomorrow: { hi: number; lo: number; label: string };
};

// WMO weather codes → spoken label + card scene
const WMO: Record<number, { label: string; scene: SkyScene }> = {
  0: { label: "clear sky", scene: "clear" },
  1: { label: "mostly clear", scene: "clear" },
  2: { label: "partly cloudy", scene: "partly" },
  3: { label: "overcast", scene: "clouds" },
  45: { label: "fog", scene: "fog" },
  48: { label: "freezing fog", scene: "fog" },
  51: { label: "light drizzle", scene: "drizzle" },
  53: { label: "drizzle", scene: "drizzle" },
  55: { label: "heavy drizzle", scene: "drizzle" },
  56: { label: "freezing drizzle", scene: "drizzle" },
  57: { label: "freezing drizzle", scene: "drizzle" },
  61: { label: "light rain", scene: "rain" },
  63: { label: "rain", scene: "rain" },
  65: { label: "heavy rain", scene: "rain" },
  66: { label: "freezing rain", scene: "rain" },
  67: { label: "freezing rain", scene: "rain" },
  71: { label: "light snow", scene: "snow" },
  73: { label: "snow", scene: "snow" },
  75: { label: "heavy snow", scene: "snow" },
  77: { label: "snow grains", scene: "snow" },
  80: { label: "rain showers", scene: "rain" },
  81: { label: "rain showers", scene: "rain" },
  82: { label: "violent showers", scene: "rain" },
  85: { label: "snow showers", scene: "snow" },
  86: { label: "snow showers", scene: "snow" },
  95: { label: "thunderstorm", scene: "thunder" },
  96: { label: "thunderstorm with hail", scene: "thunder" },
  99: { label: "thunderstorm with hail", scene: "thunder" },
};

export const wmo = (code: number) => WMO[code] ?? { label: "mixed sky", scene: "partly" };

async function getJson(url: string, ms = 3_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

// City-level, silent, cached for the session. Two free providers so a
// hiccup on one never blinds the orb.
export async function locate(): Promise<Place | null> {
  try {
    const hit = sessionStorage.getItem("recall-place");
    if (hit) return JSON.parse(hit) as Place;
  } catch {}
  let place: Place | null = null;
  try {
    const d = await getJson("https://ipapi.co/json/");
    if (d.city && d.latitude != null)
      place = {
        city: d.city,
        region: d.region ?? null,
        country: d.country_name ?? d.country ?? "",
        lat: d.latitude,
        lon: d.longitude,
      };
  } catch {}
  if (!place)
    try {
      const d = await getJson("https://ipwho.is/");
      if (d.success !== false && d.city)
        place = {
          city: d.city,
          region: d.region ?? null,
          country: d.country ?? "",
          lat: d.latitude,
          lon: d.longitude,
        };
    } catch {}
  if (place)
    try {
      sessionStorage.setItem("recall-place", JSON.stringify(place));
    } catch {}
  return place;
}

// Turn a spoken place name into coordinates (Open-Meteo geocoder, free).
export async function geocode(name: string): Promise<Place | null> {
  const d = await getJson(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en`,
  );
  const r = d.results?.[0];
  if (!r) return null;
  return {
    city: r.name,
    region: r.admin1 ?? null,
    country: r.country ?? "",
    lat: r.latitude,
    lon: r.longitude,
  };
}

export async function fetchWeather(at: Place): Promise<Weather> {
  const q = new URLSearchParams({
    latitude: String(at.lat),
    longitude: String(at.lon),
    current:
      "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
    hourly: "temperature_2m,precipitation_probability",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "auto",
    forecast_days: "2",
  });
  const d = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`, 5_000);

  const cur = d.current;
  const nowInfo = wmo(cur.weather_code);

  // hourly starts at local midnight — slice the next 12h from now
  const times: string[] = d.hourly.time;
  const nowIso = cur.time as string; // e.g. "2026-07-11T14:15"
  let idx = times.findIndex((t) => t >= nowIso.slice(0, 13) + ":00");
  if (idx < 0) idx = 0;
  const hours = times.slice(idx, idx + 12).map((t, i) => ({
    t: t.slice(11),
    temp: Math.round(d.hourly.temperature_2m[idx + i]),
    precip: d.hourly.precipitation_probability?.[idx + i] ?? 0,
  }));

  const wet = hours.find((h) => h.precip >= 45);
  const rainWindow = wet ? `rain likely around ${wet.t} (${wet.precip}%)` : null;

  return {
    place: at.city,
    now: {
      temp: Math.round(cur.temperature_2m),
      feels: Math.round(cur.apparent_temperature),
      label: nowInfo.label,
      scene: nowInfo.scene,
      isDay: cur.is_day === 1,
      wind: Math.round(cur.wind_speed_10m),
      humidity: cur.relative_humidity_2m,
    },
    hours,
    rainWindow,
    today: {
      hi: Math.round(d.daily.temperature_2m_max[0]),
      lo: Math.round(d.daily.temperature_2m_min[0]),
    },
    tomorrow: {
      hi: Math.round(d.daily.temperature_2m_max[1]),
      lo: Math.round(d.daily.temperature_2m_min[1]),
      label: wmo(d.daily.weather_code[1]).label,
    },
  };
}

// One spoken-friendly line the agent can carry in its pocket all session.
export function weatherOneLiner(w: Weather) {
  return (
    `${w.place}: ${w.now.temp}°C ${w.now.label} (feels ${w.now.feels}°), ` +
    `today ${w.today.hi}/${w.today.lo}°` +
    (w.rainWindow ? `, ${w.rainWindow}` : "") +
    `. Tomorrow ${w.tomorrow.label}, ${w.tomorrow.hi}/${w.tomorrow.lo}°.`
  );
}
