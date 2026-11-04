// Surf Zeeland Cloudflare Worker: cron-check + dashboard + instellingen (KV: SURF)
import SEED from "./spots.json";
const AMS = "Europe/Amsterdam";
const K = ["N","NNO","NO","ONO","O","OZO","ZO","ZZO","Z","ZZW","ZW","WZW","W","WNW","NW","NNW"];
const kompas = d => d == null ? "?" : K[Math.round((d % 360) / 22.5) % 16];
const inArc = (d, a, b) => d != null && (a <= b ? d >= a && d <= b : d >= a || d <= b);
const json = (o, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function getCfg(env) { return (await env.SURF.get("config", "json")) || SEED; }

async function forecast(s, days = 5) {
  const w = await (await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${s.wave_point.lat}&longitude=${s.wave_point.lon}&hourly=swell_wave_height,swell_wave_direction,swell_wave_period,wave_height&forecast_days=${days}&timezone=UTC`)).json();
  const m = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${s.wind_point.lat}&longitude=${s.wind_point.lon}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&models=knmi_seamless,ecmwf_ifs025&forecast_days=${days}&timezone=UTC`)).json();
  const H = m.hourly, idx = Object.fromEntries(H.time.map((t, i) => [t, i]));
  const f = (k, j) => H[k + "_knmi_seamless"]?.[j] ?? H[k + "_ecmwf_ifs025"]?.[j] ?? null;
  return w.hourly.time.flatMap((t, i) => { const j = idx[t]; if (j == null) return [];
    return [{ t: t + ":00Z", h: w.hourly.swell_wave_height[i], d: w.hourly.swell_wave_direction[i], p: w.hourly.swell_wave_period[i], wh: w.hourly.wave_height[i],
      ws: f("wind_speed_10m", j), wd: f("wind_direction_10m", j), wg: f("wind_gusts_10m", j) }]; });
}
function score(s, r) {
  if ([r.h, r.p, r.d, r.ws, r.wd].includes(null) || r.h === undefined) return { n: 0, c: {} };
  const c = { hoogte: r.h >= s.swell_height_min && r.h <= s.swell_height_max, periode: r.p >= s.swell_period_min,
    richting: inArc(r.d, s.swell_dir_from, s.swell_dir_to),
    wind: r.ws <= s.light_wind_kmh || (inArc(r.wd, s.offshore_dir_from, s.offshore_dir_to) && r.ws <= s.max_wind_kmh) };
  return { n: Object.values(c).filter(Boolean).length, c };
}
function windows(s, rows, minH) {
  const out = []; let cur = [];
  for (const r of rows) { if (score(s, r).n === 4) cur.push(r); else { if (cur.length) out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out.filter(c => c.length >= minH).map(c => {
    const a = k => c.reduce((x, r) => x + r[k], 0) / c.length;
    return { start: c[0].t, end: new Date(Date.parse(c.at(-1).t) + 36e5).toISOString(), h: a("h"), p: a("p"), d: a("d"), ws: a("ws"), wd: a("wd"), wg: Math.max(...c.map(r => r.wg || 0)) };
  });
}
const fmt = (iso, o) => new Date(iso).toLocaleString("nl-NL", { timeZone: AMS, ...o });

async function check(env, { dryRun = false } = {}) {
  const cfg = await getCfg(env), now = Date.now();
  const sent = (await env.SURF.get("sent", "json")) || {};
  const log = (await env.SURF.get("alerts", "json")) || [];
  const result = [];
  for (const s of cfg.spots.filter(s => s.enabled !== false)) {
    const rows = await forecast(s, 4);
    for (const w of windows(s, rows, cfg.min_window_hours || 2)) {
      const hrs = (Date.parse(w.start) - now) / 36e5; if (hrs < 0) continue;
      const due = cfg.lead_times_hours.filter(L => hrs <= L); if (!due.length) continue;
      const lead = Math.min(...due), key = `${s.id}|${w.start}|${lead}`;
      if (sent[key]) continue;
      const title = `Surf alert ${s.name} (${lead}u vooraf)`;
      const msg = `${fmt(w.start, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}–${fmt(w.end, { hour: "2-digit", minute: "2-digit" })} (NL-tijd), over ~${Math.round(hrs)} uur\n` +
        `Swell ${w.h.toFixed(1)} m, ${w.p.toFixed(0)} s uit ${kompas(w.d)} (${Math.round(w.d)}°)\nWind ${Math.round(w.ws)} km/u uit ${kompas(w.wd)}, vlagen ${Math.round(w.wg)}`;
      result.push({ key, title, msg });
      if (dryRun) continue;
      await fetch(`https://ntfy.sh/${cfg.ntfy_topic}`, { method: "POST", body: msg, headers: { Title: title, Tags: "ocean,surfer", Click: env.PUBLIC_URL || "" } });
      sent[key] = new Date(now).toISOString(); log.unshift({ at: sent[key], spot: s.name, lead, title, msg });
    }
  }
  if (!dryRun) {
    const cut = new Date(now - 3 * 864e5).toISOString();
    for (const k in sent) if (sent[k] < cut) delete sent[k];
    await env.SURF.put("sent", JSON.stringify(sent));
    await env.SURF.put("alerts", JSON.stringify(log.slice(0, 30)));
    await env.SURF.put("lastcheck", JSON.stringify({ at: new Date(now).toISOString(), sent: result.length }));
  }
  return result;
}

async function data(env) {
  const cfg = await getCfg(env), now = Date.now();
  const spots = await Promise.all(cfg.spots.map(async s => {
    const rows = (await forecast(s, 5)).filter(r => Date.parse(r.t) >= now - 36e5);
    const scored = rows.map(r => ({ ...r, score: score(s, r).n }));
    return { id: s.id, name: s.name, now: { ...rows[0], ...score(s, rows[0] || {}) }, hours: scored, windows: windows(s, rows, cfg.min_window_hours || 2) };
  }));
  return { generated: new Date(now).toISOString(), lastcheck: await env.SURF.get("lastcheck", "json"), alerts: (await env.SURF.get("alerts", "json")) || [], config: cfg, spots };
}

function validate(c) {
  if (!c || !Array.isArray(c.spots) || !c.ntfy_topic || !/^[\w-]{6,64}$/.test(c.ntfy_topic)) return "ongeldige config of ntfy-topic";
  if (!Array.isArray(c.lead_times_hours) || c.lead_times_hours.some(x => typeof x !== "number")) return "ongeldige lead times";
  for (const s of c.spots) for (const k of ["swell_height_min","swell_height_max","swell_period_min","swell_dir_from","swell_dir_to","offshore_dir_from","offshore_dir_to","max_wind_kmh","light_wind_kmh"])
    if (typeof s[k] !== "number" || isNaN(s[k])) return `${s.id}: ${k} moet een getal zijn`;
  return null;
}

export default {
  async scheduled(ev, env, ctx) { ctx.waitUntil(check(env)); },
  async fetch(req, env) {
    const u = new URL(req.url), p = u.pathname;
    if (p === "/api/data") return json(await data(env));
    if (p === "/api/config" && req.method === "GET") return json(await getCfg(env));
    if (p === "/api/check") return json({ dryRun: true, wouldSend: await check(env, { dryRun: true }) });
    if (p === "/api/config" && req.method === "PUT") {
      if (!env.ADMIN_PIN || req.headers.get("x-admin-pin") !== env.ADMIN_PIN) return json({ error: "Onjuiste PIN" }, 401);
      let c; try { c = await req.json(); } catch { return json({ error: "Geen geldige JSON" }, 400); }
      const e = validate(c); if (e) return json({ error: e }, 400);
      await env.SURF.put("config", JSON.stringify(c)); return json({ ok: true });
    }
    if (p === "/manifest.json") return new Response(JSON.stringify({ name: "Surf Zeeland", short_name: "Surf Zeeland", start_url: "/", display: "standalone", background_color: "#0b2233", theme_color: "#0b3d5c", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] }), { headers: { "content-type": "application/manifest+json" } });
    if (p === "/icon.svg") return new Response(ICON, { headers: { "content-type": "image/svg+xml", "cache-control": "max-age=86400" } });
    if (p === "/sw.js") return new Response(SW, { headers: { "content-type": "text/javascript" } });
    if (p === "/") return new Response(HTML, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
    return new Response("Niet gevonden", { status: 404 });
  },
};

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0b3d5c"/><path d="M60 330c60-80 140-80 200 0s140 80 200 0M60 410c60-80 140-80 200 0s140 80 200 0" stroke="#7fd3ff" stroke-width="28" fill="none" stroke-linecap="round"/><circle cx="380" cy="150" r="56" fill="#ffd166"/></svg>`;
const SW = `const C="surf-v2";self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(["/","/icon.svg","/manifest.json"])))});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});`;

const HTML = `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Surf Zeeland">
<meta name="theme-color" content="#0b3d5c"><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" href="/icon.svg"><link rel="icon" href="/icon.svg">
<title>Surf Zeeland</title><style>
*{box-sizing:border-box}body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#eef3f6;color:#123}
header{background:#0b3d5c;color:#fff;padding:calc(env(safe-area-inset-top) + 10px) 16px 10px;position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between}
h1{margin:0;font-size:20px}header button{background:#ffffff22;color:#fff;border:0;border-radius:8px;padding:8px 10px;font-size:15px}
main{padding:12px;max-width:700px;margin:auto}.card{background:#fff;border-radius:14px;padding:14px;margin-bottom:14px;box-shadow:0 1px 3px #0002}
h2{margin:0 0 8px;font-size:18px}h3{font-size:15px;margin:12px 0 6px}small,.muted{color:#5a6b78;font-size:13px}
.now{display:grid;grid-template-columns:1fr 1fr;gap:8px}.big{font-size:22px;font-weight:700}.arrow{display:inline-block;font-size:20px}
.badge{display:inline-block;padding:3px 8px;border-radius:20px;font-size:13px;font-weight:600}.s4{background:#2fbf71;color:#fff}.s3{background:#ffd34d}.s2{background:#ffe9a8}.s1,.s0{background:#e4e8eb;color:#667}
.strip{display:flex;overflow-x:auto;gap:3px;padding-bottom:6px;-webkit-overflow-scrolling:touch}.col{min-width:34px;text-align:center;font-size:11px}
.col .b{height:34px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:700}.day{font-size:12px;font-weight:600;margin-top:6px}
.win{border-left:4px solid #2fbf71;padding:6px 10px;margin:6px 0;background:#f0fbf4;border-radius:6px;font-size:14px}
.alert{font-size:13px;border-bottom:1px solid #eee;padding:6px 0;white-space:pre-line}
.btn{display:block;background:#0b7a5c;color:#fff;text-align:center;padding:12px;border-radius:10px;text-decoration:none;font-weight:600;border:0;width:100%;font-size:16px;margin-top:8px}
dialog{border:0;border-radius:14px;padding:0;width:min(96vw,640px);max-height:90vh}dialog::backdrop{background:#0008}
.dlg{padding:16px;overflow:auto;max-height:85vh}label{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:14px;margin:6px 0}
input{font-size:16px;padding:6px;border:1px solid #ccd;border-radius:6px;width:110px}input[type=checkbox]{width:auto}code{background:#eee;padding:2px 4px;border-radius:4px;word-break:break-all}
</style></head><body>
<header><h1>🏄 Surf Zeeland</h1><button onclick="openSet()">⚙︎ Instellingen</button></header>
<main><div id="app">Laden…</div>
<div class="card"><h2>🔔 Meldingen</h2><p>Installeer de gratis app <b>ntfy</b> (App Store) en abonneer je op topic <code id="topic"></code>.</p><a class="btn" id="sub" href="#">Abonneer in ntfy</a>
<small>Seintje 24, 12 en 6 uur voor een goed surfvenster. Data: Open-Meteo (golfmodellen ECMWF/DWD, wind KNMI HARMONIE met ECMWF als terugval).</small></div></main>
<dialog id="dlg"><div class="dlg"><h2>Instellingen</h2><div id="form"></div>
<label>Admin-PIN <input id="pin" type="password" inputmode="numeric" autocomplete="off"></label>
<button class="btn" onclick="save()">Opslaan</button><button class="btn" style="background:#888" onclick="dlg.close()">Sluiten</button><p id="msg" class="muted"></p></div></dialog>
<script>
const K=["N","NNO","NO","ONO","O","OZO","ZO","ZZO","Z","ZZW","ZW","WZW","W","WNW","NW","NNW"],k=d=>d==null?"?":K[Math.round((d%360)/22.5)%16];
const arr=d=>'<span class="arrow" style="transform:rotate('+((d+180)%360)+'deg)">↑</span>';
const T=(iso,o)=>new Date(iso).toLocaleString("nl-NL",{timeZone:"Europe/Amsterdam",...o});
const f1=x=>x==null?"–":x.toFixed(1),f0=x=>x==null?"–":Math.round(x);
let D;
async function load(){D=await (await fetch("/api/data",{cache:"no-store"})).json();const c=D.config;
 topic.textContent=c.ntfy_topic;sub.href="ntfy://ntfy.sh/"+c.ntfy_topic;
 let h="";for(const s of D.spots){const n=s.now;
  h+='<div class="card"><h2>'+s.name+' <span class="badge s'+n.n+'">'+n.n+'/4</span></h2><div class="now">'+
  '<div><small>Swell nu</small><div class="big">'+f1(n.h)+' m · '+f0(n.p)+' s</div>'+arr(n.d)+' uit '+k(n.d)+' ('+f0(n.d)+'°)</div>'+
  '<div><small>Wind nu</small><div class="big">'+f0(n.ws)+' km/u</div>'+arr(n.wd)+' uit '+k(n.wd)+', vlagen '+f0(n.wg)+'</div></div>'+
  '<small>'+Object.entries(n.c||{}).map(([a,b])=>(b?"✅ ":"❌ ")+a).join(" · ")+'</small>';
  h+='<h3>Volgende goede vensters</h3>'+(s.windows.length?s.windows.map(w=>'<div class="win"><b>'+T(w.start,{weekday:"short",day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+'–'+T(w.end,{hour:"2-digit",minute:"2-digit"})+'</b><br>Swell '+f1(w.h)+' m, '+f0(w.p)+' s uit '+k(w.d)+' · wind '+f0(w.ws)+' km/u uit '+k(w.wd)+'</div>').join(""):'<small>Geen goed venster in de komende dagen.</small>');
  h+='<h3>Score per uur</h3><div class="strip">';let day="";
  for(const r of s.hours){const d=T(r.t,{weekday:"short",day:"numeric"});const hr=T(r.t,{hour:"2-digit"});
   h+='<div class="col">'+(d!==day?'<div class="day">'+d+'</div>':'<div class="day">&nbsp;</div>')+'<div class="b s'+r.score+'">'+r.score+'</div>'+hr+'<br>'+f1(r.h)+'m<br>'+k(r.wd)+'</div>';day=d}
  h+='</div></div>'}
 h+='<div class="card"><h2>Status</h2><small>Laatste check: '+(D.lastcheck?T(D.lastcheck.at,{weekday:"short",hour:"2-digit",minute:"2-digit"})+' ('+D.lastcheck.sent+' meldingen)':'nog niet')+'</small><h3>Recente meldingen</h3>'+
  (D.alerts.length?D.alerts.slice(0,10).map(a=>'<div class="alert"><b>'+a.title+'</b> · '+T(a.at,{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})+'\\n'+a.msg+'</div>').join(""):'<small>Nog geen meldingen verstuurd.</small>')+'</div>';
 app.innerHTML=h}
const F=[["swell_height_min","Min. swellhoogte (m)"],["swell_height_max","Max. swellhoogte (m)"],["swell_period_min","Min. periode (s)"],["swell_dir_from","Swellrichting van (°)"],["swell_dir_to","Swellrichting tot (°)"],["offshore_dir_from","Offshore wind van (°)"],["offshore_dir_to","Offshore wind tot (°)"],["max_wind_kmh","Max. offshore wind (km/u)"],["light_wind_kmh","Zwakke wind, elke richting (km/u)"]];
function openSet(){const c=D.config;let h='<label>ntfy-topic <input id="c_topic" style="width:200px" value="'+c.ntfy_topic+'"></label><label>Meldingen (uren vooraf) <input id="c_leads" value="'+c.lead_times_hours.join(",")+'"></label><label>Min. uren per venster <input id="c_min" type="number" value="'+(c.min_window_hours||2)+'"></label>';
 c.spots.forEach((s,i)=>{h+='<h3>'+s.name+'</h3><label>Actief <input type="checkbox" id="e_'+i+'" '+(s.enabled!==false?"checked":"")+'></label>'+F.map(([f,l])=>'<label>'+l+' <input type="number" step="any" inputmode="decimal" id="s_'+i+'_'+f+'" value="'+s[f]+'"></label>').join("")});
 form.innerHTML=h+'<small>Richtingen in graden waar swell/wind vandaan komt, met de klok mee (N=0, O=90, Z=180, W=270). "Van 250 tot 20" loopt via het noorden.</small>';msg.textContent="";dlg.showModal()}
async function save(){const c=structuredClone(D.config);c.ntfy_topic=c_topic.value.trim();c.lead_times_hours=c_leads.value.split(",").map(Number).filter(x=>x>0);c.min_window_hours=+c_min.value;
 c.spots.forEach((s,i)=>{s.enabled=document.getElementById("e_"+i).checked;F.forEach(([f])=>s[f]=parseFloat(document.getElementById("s_"+i+"_"+f).value))});
 const r=await fetch("/api/config",{method:"PUT",headers:{"content-type":"application/json","x-admin-pin":pin.value},body:JSON.stringify(c)});const j=await r.json();
 if(r.ok){msg.textContent="Opgeslagen ✅";await load();setTimeout(()=>dlg.close(),800)}else msg.textContent="Fout: "+j.error}
load().catch(e=>app.textContent="Fout bij laden: "+e);setInterval(load,15*60e3);
if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");
</script></body></html>`;
