# 🏄 Surf Zeeland

Seintje op je telefoon als de surfcondities goed zijn in **Domburg** en **Meirnesse (Schouwen-Duiveland)**.

- **App:** https://martijnonthemove.github.io/surf-zeeland/
- **Meldingen (ntfy-topic):** `surf-zeeland-33d496e466`

## Hoe het werkt
1. **Data** komt van [Open-Meteo](https://open-meteo.com): zwel (hoogte, periode, richting) uit de golfmodellen van ECMWF (WAM) en DWD, wind uit **KNMI HARMONIE** (`knmi_seamless`, ~2,5 dag vooruit) met **ECMWF IFS** als terugval voor verdere dagen.
2. **`checker.py`** draait elke 3 uur als GitHub Action (`.github/workflows/check.yml`). Een uur is alleen *goed* als **alles** klopt: zwelhoogte binnen bereik, periode hoog genoeg, zwelrichting in het venster van de spot én wind offshore/aflandig of zwak. Minimaal 2 goede uren achter elkaar = surfvenster.
3. Per venster gaat er een melding **24, 12 en 6 uur vooraf** via [ntfy.sh](https://ntfy.sh). Wat al verstuurd is staat in `state/sent.json`, zodat je niets dubbel krijgt.
4. De **app** (map `docs/`) is een webapp op GitHub Pages die de voorspelling per spot toont met een score (groen 4/4, geel 3/4).

## Waar staat wat
| Bestand | Wat |
|---|---|
| `docs/spots.json` | **Alle grenzen per spot** + ntfy-topic (gebruikt door app én checker) |
| `checker.py` | Voorspellingscheck + meldingen |
| `.github/workflows/check.yml` | Planning (cron, elke 3 uur) |
| `docs/index.html` | De app |

## Grenzen aanpassen
Open `docs/spots.json` op GitHub, klik op het potloodje, wijzig en klik *Commit changes*. Velden:
- `swell_height_min/max` (m), `swell_period_min` (s)
- `swell_dir_from/to`: richting waar de zwel **vandaan** komt, in graden, met de klok mee (250 → 20 = WZW via N tot NNO)
- `offshore_dir_from/to`: windrichtingen die goed zijn; `max_wind_kmh` daarvoor
- `light_wind_kmh`: onder deze windsnelheid is elke richting goed
- `lead_times_hours`, `min_window_hours`

Handmatig draaien: tab **Actions → Surf check → Run workflow**.

## Meldingen krijgen (iPhone)
1. Installeer **ntfy** uit de App Store (gratis).
2. Tik op **+**, vul topic `surf-zeeland-33d496e466` in (server ntfy.sh), *Subscribe*.
3. App op beginscherm: open de app-link in Safari → Deel → *Zet op beginscherm*.

## Vrienden laten meedoen
Stuur ze de app-link; daarin staat het topic en een abonneerknop. Iedereen met het topic krijgt de meldingen. Het topic is "geheim" maar niet beveiligd: deel het alleen met wie je wilt. Wil je een nieuw topic, verander `ntfy_topic` in `spots.json`.
