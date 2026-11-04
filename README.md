# 🏄 Surf Zeeland

Seintje op je telefoon als de surfcondities goed zijn in **Domburg** en **Renesse (Schouwen-Duiveland)**.

- **Dashboard (app):** https://surf-zeeland.martijnvdhelm.workers.dev/
- **Meldingen (ntfy-topic):** `surf-zeeland-33d496e466`

## Architectuur
Alles draait op een **Cloudflare Worker** (`surf-zeeland`) in je Cloudflare-account:
1. **Elk uur (cron, minuut 7)** haalt de Worker voorspellingen op via [Open-Meteo](https://open-meteo.com): swell (hoogte, periode, richting) uit de golfmodellen van ECMWF (WAM) en DWD, wind uit **KNMI HARMONIE** (`knmi_seamless`) met **ECMWF IFS** als terugval.
2. Een uur is *goed* als **alles** klopt: swellhoogte binnen bereik, periode lang genoeg, swellrichting in het venster van de spot én wind offshore of zwak. Minimaal 2 goede uren achter elkaar = surfvenster.
3. Per venster gaat er één melding **24, 12 en 6 uur vooraf** via [ntfy.sh](https://ntfy.sh).
4. **Cloudflare KV** (namespace `surf-zeeland`) bewaart de instellingen (`config`), welke meldingen al verstuurd zijn (`sent`), recente meldingen (`alerts`) en de laatste check (`lastcheck`).
5. Het **dashboard** (zelfde Worker) toont de huidige swell en wind per spot, een score per uur, de volgende goede vensters, de laatste check en recente meldingen. Het is een webapp: in Safari → Deel → *Zet op beginscherm*.

## Waar staat wat
| Waar | Wat |
|---|---|
| `worker/worker.js` | Worker-code: check, meldingen, dashboard en API |
| `worker/spots.json` | Startinstellingen (alleen gebruikt zolang er nog niets in KV staat) |
| Cloudflare → Workers & Pages → `surf-zeeland` | De draaiende Worker, cron, logs en het geheim `ADMIN_PIN` |
| Cloudflare → KV → `surf-zeeland` | Actuele instellingen en status |
| `docs/` | GitHub Pages: stuurt door naar het dashboard |
| `checker.py`, `.github/workflows/check.yml` | Oude GitHub-versie; planning uitgezet, alleen nog handmatig te starten |

## Instellingen aanpassen
Open het dashboard → **⚙︎ Instellingen**. Je kunt per spot aanpassen: min./max. swellhoogte, min. periode, swellrichting (van/tot), offshore windrichting (van/tot), max. offshore wind, zwakke-windgrens en of de spot actief is. Verder het ntfy-topic, de meldtijden (uren vooraf) en het minimale aantal uren per venster. Opslaan vraagt de **admin-PIN**.

Richtingen zijn in graden waar swell of wind **vandaan** komt, met de klok mee (N=0, O=90, Z=180, W=270). "Van 250 tot 20" loopt via het noorden.

PIN vergeten of wijzigen: Cloudflare → Workers → `surf-zeeland` → Settings → Variables and Secrets → `ADMIN_PIN`.

## Handige adressen
- `/api/data`: alle data van het dashboard (JSON)
- `/api/config`: huidige instellingen
- `/api/check`: proefcheck, laat zien welke meldingen er nu verstuurd zouden worden (verstuurt niets)

## Code bijwerken
Pas `worker/worker.js` aan en deploy met `npx wrangler deploy` in de map `worker/` (eerst `npx wrangler login`).

## Meldingen krijgen (iPhone)
1. Installeer **ntfy** uit de App Store (gratis).
2. Tik op **+**, vul topic `surf-zeeland-33d496e466` in (server ntfy.sh) en tik op *Subscribe*.

## Vrienden laten meedoen
Stuur ze de link naar het dashboard; daar staan het topic en een abonneerknop. Iedereen met het topic krijgt de meldingen. Het topic is geheim maar niet beveiligd: deel het alleen met wie je wilt. Instellingen wijzigen kan alleen met de PIN.
