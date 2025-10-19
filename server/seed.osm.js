// server/seed.osm.js
// Build a real dealers dataset from OpenStreetMap via Overpass API (free).
// Writes seed/dealers.json which server/index.js auto-loads.
//
// Usage:
//   node server/seed.osm.js
//   PER_STATE=0 node server/seed.osm.js         # 0 = no per-state cap (keep all)
//   PER_STATE=60 node server/seed.osm.js        # cap to 60 per state
//
// Notes:
// - Filters out disused/abandoned lifecycle tags, keeps only "shop=car" or "amenity=car_dealership".
// - Brand detection from name/brand/operator tags.
// - Tries hard to fill missing city using address fallbacks and (polite) Nominatim reverse geocoding.
// - Please add attribution in your UI: "© OpenStreetMap contributors".

const fs = require("fs");
const path = require("path");

// Node 18+ has global fetch; engines already set to >=18 in package.json.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- config
// PER_STATE: 0 = keep all found; otherwise cap per state
const PER_STATE = Number(process.env.PER_STATE ?? 50);
const OUT_DIR = path.join(__dirname, "..", "seed");
const OUT_FILE = path.join(OUT_DIR, "dealers.json");

// Reverse geocode (for missing city) — be polite.
const CONTACT_EMAIL =
  process.env.OSM_CONTACT ||
  process.env.NOMINATIM_EMAIL ||
  "please-set-OSM_CONTACT@example.com";
const MAX_REVERSE = Number(process.env.MAX_REVERSE ?? 400); // total reverse lookups across run
const REVERSE_RATE_MS = Number(process.env.REVERSE_RATE_MS ?? 1100); // >= 1 req/sec as per Nominatim policy

// US state codes
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
];

const BRANDS = [
  "Toyota","Honda","Ford","Chevrolet","Nissan","Hyundai","Kia","Volkswagen",
  "Subaru","Mazda","Lexus","BMW","Mercedes-Benz","Audi","Volvo","Acura",
  "Infiniti","GMC","Ram","Jeep","Dodge","Chrysler","Cadillac","Buick",
  "Porsche","Jaguar","Land Rover","Mini","Mitsubishi","Tesla"
];

// --- helpers
function normalize(s) {
  return String(s || "").trim();
}
function detectBrands(tags) {
  const hay = `${tags.name || ""} ${tags.brand || ""} ${tags.operator || ""}`.toLowerCase();
  const out = [];
  BRANDS.forEach(b => {
    if (hay.includes(b.toLowerCase())) out.push(b);
  });
  return Array.from(new Set(out));
}
function isLifecycleClosed(tags) {
  if (!tags) return true;
  if (tags.disused === "yes") return true;
  if (tags.abandoned === "yes") return true;
  const keys = Object.keys(tags);
  if (keys.some(k => /^disused:/.test(k) || /^abandoned:/.test(k) || /^was:/.test(k))) return true;
  const ok = tags.shop === "car" || tags.amenity === "car_dealership";
  return !ok;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = normalize(v);
    if (s) return s;
  }
  return "";
}

function mapOsmElement(el, stateCode) {
  const t = el.tags || {};
  // best-effort city from various addr:* keys
  let city = firstNonEmpty(
    t["addr:city"],
    t["addr:town"],
    t["addr:village"],
    t["addr:hamlet"],
    t["addr:suburb"],
    t["addr:place"],
    t["is_in:city"]
  );

  const name = normalize(t.name);
  const postcode = normalize(t["addr:postcode"]);
  const phone = normalize(t["contact:phone"] || t["phone"]);
  const brands = detectBrands(t);

  // coordinates for optional reverse geocode (ways/relations: center; nodes: lat/lon)
  const lat = el.center?.lat ?? el.lat;
  const lon = el.center?.lon ?? el.lon;

  const isNew = /new|authorized|dealer|dealership/i.test(name) || brands.length > 0;
  const isUsed = true;

  return {
    id: `OSM_${el.type}_${el.id}`,
    name,
    city,
    state: stateCode || normalize(t["addr:state"]),
    zip: postcode,
    brands,
    phone,
    isNew,
    isUsed,
    // keep lat/lon temporarily for reverse geocode enrichment (server ignores unknown fields)
    lat,
    lon
  };
}

function dedupeDealers(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    if (!d.name || !d.state) continue; // must have basics
    const key = `${d.name}|${d.state}|${d.zip || d.city || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function fetchOverpassForState(state) {
  // Use ISO3166-2 state area (e.g., US-CA) to bound results.
  const query = `
[out:json][timeout:60];
area["ISO3166-2"="US-${state}"]->.a;
(
  node["shop"="car"](area.a);
  way["shop"="car"](area.a);
  relation["shop"="car"](area.a);
  node["amenity"="car_dealership"](area.a);
  way["amenity"="car_dealership"](area.a);
  relation["amenity"="car_dealership"](area.a);
);
out tags center;
  `.trim();

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `dealers-plus/1.0 (${CONTACT_EMAIL})`
    },
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Overpass ${state} error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  const mapped = elements
    .filter(el => el && el.tags && !isLifecycleClosed(el.tags))
    .map(el => mapOsmElement(el, state))
    .filter(d => d.name && d.state);

  const deduped = dedupeDealers(mapped);

  // cap per state if PER_STATE > 0
  return PER_STATE > 0 ? deduped.slice(0, PER_STATE) : deduped;
}

// reverse geocode a single lat/lon to a city name (Nominatim)
async function reverseCity(lat, lon) {
  if (lat == null || lon == null) return "";
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lon),
    zoom: "10",
    "accept-language": "en"
  });
  const res = await fetch(
    `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
    {
      headers: { "User-Agent": `dealers-plus/1.0 (${CONTACT_EMAIL})` }
    }
  );
  if (!res.ok) return "";
  const j = await res.json().catch(() => ({}));
  const a = j.address || {};
  // prefer a proper city-like key, fallback to county as last resort
  return (
    a.city ||
    a.town ||
    a.village ||
    a.hamlet ||
    a.municipality ||
    a.suburb ||
    a.county ||
    ""
  );
}

// fill missing city via reverse geocoding (polite limits)
async function enrichMissingCities(dealers) {
  let used = 0;
  for (const d of dealers) {
    if (d.city) continue;
    if (used >= MAX_REVERSE) break;
    const city = await reverseCity(d.lat, d.lon);
    if (city) d.city = city;
    used++;
    await sleep(REVERSE_RATE_MS);
  }
}

(async () => {
  const all = [];
  for (const state of STATES) {
    try {
      const list = await fetchOverpassForState(state);

      // best-effort: fill missing city names so user searches like "Colorado Springs" will match
      const needCity = list.filter(d => !d.city && d.lat != null && d.lon != null);
      if (needCity.length) {
        console.log(`US-${state}: resolving cities for ${needCity.length} items...`);
        await enrichMissingCities(needCity);
      }

      // strip lat/lon before persisting (optional; server ignores them anyway)
      list.forEach(d => {
        delete d.lat;
        delete d.lon;
      });

      all.push(...list);
      console.log(`US-${state}: +${list.length} dealers (total ${all.length})`);
      // be polite to Overpass
      await sleep(1000);
    } catch (e) {
      console.error(`US-${state} failed:`, e.message);
      // small backoff then continue
      await sleep(2000);
    }
  }

  const finalList = dedupeDealers(all);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(finalList, null, 2), "utf8");
  console.log(`\nWrote ${finalList.length} dealerships to ${path.relative(process.cwd(), OUT_FILE)} (free OSM data).`);
  console.log('Attribution: Data © OpenStreetMap contributors (ODbL).');

  if (CONTACT_EMAIL.includes("please-set-OSM_CONTACT")) {
    console.log(
      "Tip: set OSM_CONTACT or NOMINATIM_EMAIL env var to your email to comply with usage policies."
    );
  }
})();
