"""Surf Zeeland checker: haalt voorspellingen op en stuurt ntfy-meldingen."""
import json, urllib.request, urllib.parse, datetime as dt, os
from zoneinfo import ZoneInfo

AMS = ZoneInfo("Europe/Amsterdam")
CFG = json.load(open("docs/spots.json"))
STATE_FILE = "state/sent.json"

def get(url, params):
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=30) as r:
        return json.load(r)

def in_arc(d, a, b):
    if d is None: return False
    return a <= d <= b if a <= b else (d >= a or d <= b)

def forecast(spot):
    w = get("https://marine-api.open-meteo.com/v1/marine", {
        "latitude": spot["wave_point"]["lat"], "longitude": spot["wave_point"]["lon"],
        "hourly": "swell_wave_height,swell_wave_direction,swell_wave_period,wave_height",
        "forecast_days": 4, "timezone": "UTC"})["hourly"]
    v = "wind_speed_10m,wind_direction_10m,wind_gusts_10m"
    m = get("https://api.open-meteo.com/v1/forecast", {
        "latitude": spot["wind_point"]["lat"], "longitude": spot["wind_point"]["lon"],
        "hourly": v, "models": "knmi_seamless,ecmwf_ifs025", "forecast_days": 4, "timezone": "UTC"})["hourly"]
    def wind(k, i):  # KNMI HARMONIE eerst, anders ECMWF
        a = m.get(f"{k}_knmi_seamless", [None]*999)[i]
        return a if a is not None else m.get(f"{k}_ecmwf_ifs025", [None]*999)[i]
    widx = {t: i for i, t in enumerate(m["time"])}
    rows = []
    for i, t in enumerate(w["time"]):
        j = widx.get(t)
        if j is None: continue
        rows.append(dict(t=dt.datetime.fromisoformat(t).replace(tzinfo=dt.timezone.utc),
            h=w["swell_wave_height"][i], d=w["swell_wave_direction"][i], p=w["swell_wave_period"][i],
            ws=wind("wind_speed_10m", j), wd=wind("wind_direction_10m", j), wg=wind("wind_gusts_10m", j)))
    return rows

def good(s, r):
    if None in (r["h"], r["p"], r["d"], r["ws"], r["wd"]): return False
    wind_ok = r["ws"] <= s["light_wind_kmh"] or (
        in_arc(r["wd"], s["offshore_dir_from"], s["offshore_dir_to"]) and r["ws"] <= s["max_wind_kmh"])
    return (s["swell_height_min"] <= r["h"] <= s["swell_height_max"] and r["p"] >= s["swell_period_min"]
            and in_arc(r["d"], s["swell_dir_from"], s["swell_dir_to"]) and wind_ok)

def windows(s, rows):
    out, cur = [], []
    for r in rows:
        if good(s, r): cur.append(r)
        elif cur: out.append(cur); cur = []
    if cur: out.append(cur)
    return [c for c in out if len(c) >= CFG["min_window_hours"]]

KOMPAS = ["N","NNO","NO","ONO","O","OZO","ZO","ZZO","Z","ZZW","ZW","WZW","W","WNW","NW","NNW"]
def k(d): return KOMPAS[int((d % 360) / 22.5 + 0.5) % 16]
def avg(c, key): return sum(r[key] for r in c) / len(c)

def main():
    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    now = dt.datetime.now(dt.timezone.utc)
    for s in CFG["spots"]:
        for c in windows(s, forecast(s)):
            start, end = c[0]["t"], c[-1]["t"] + dt.timedelta(hours=1)
            hrs = (start - now).total_seconds() / 3600
            if hrs < 0: continue
            # kleinste lead-time die al bereikt is (cron draait elke 3 uur)
            due = [L for L in CFG["lead_times_hours"] if hrs <= L]
            if not due: continue
            lead = min(due)
            key = f'{s["id"]}|{start.isoformat()}|{lead}'
            if key in state: continue
            a, b = start.astimezone(AMS), end.astimezone(AMS)
            msg = (f'{a:%a %d-%m %H:%M}–{b:%H:%M} (NL-tijd), over ~{round(hrs)} uur\n'
                   f'Zwel {avg(c,"h"):.1f} m, {avg(c,"p"):.0f} s uit {k(avg(c,"d"))} ({avg(c,"d"):.0f}°)\n'
                   f'Wind {avg(c,"ws"):.0f} km/u uit {k(avg(c,"wd"))}, vlagen {max(r["wg"] or 0 for r in c):.0f}')
            req = urllib.request.Request(f'https://ntfy.sh/{CFG["ntfy_topic"]}', data=msg.encode(),
                headers={"Title": f'Surf alert {s["name"]} ({lead}u vooraf)'.encode("utf-8").decode("latin-1"),
                         "Tags": "ocean,surfer", "Click": os.environ.get("PAGES_URL", "")})
            urllib.request.urlopen(req, timeout=30)
            state[key] = now.isoformat()
            print("Verstuurd:", key)
    cutoff = (now - dt.timedelta(days=3)).isoformat()
    state = {kk: v for kk, v in state.items() if v > cutoff}
    os.makedirs("state", exist_ok=True)
    json.dump(state, open(STATE_FILE, "w"), indent=1)

if __name__ == "__main__":
    main()
