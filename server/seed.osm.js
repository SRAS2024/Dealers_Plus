// server/seed.osm.js
// Build a real dealers dataset from OpenStreetMap via Overpass API (free).
// Writes seed/dealers.json which server/index.js auto-loads.
//
// Usage:
//   node server/seed.osm.js
//   PER_STATE=60 node server/seed.osm.js
//
// Notes:
// - Filters out disused/abandoned lifecycle tags, keeps only "shop=car" or "amenity=car_dealership".
// - Brand detection from name/brand/operator tags.
// - Please add attribution in your UI: "© OpenStreetMap contributors".

const fs = require("fs");
const path = require("path");

// Node 18+ has global fetch; engines already set to >=18 in package.json.

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- config
const PER_STATE = Number(process.env.PER_STATE || 50); // how many per state (cap; remove to keep all)
const OUT_DIR = path.join(__dirname, "..", "seed");
const OUT_FILE = path.join(OUT_DIR, "dealers.json");

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
  // exclude typical lifecycle states
  if (!tags) return false;
  if (tags.disused === "yes") return true;
  if (tags.abandoned === "yes") return true;
  const keys = Object.keys(tags);
  // e.g. disused:shop=car, abandoned:shop=car
  if (keys.some(k => /^disused:/.test(k) || /^abandoned:/.test(k) || /^was:/.test(k))) return true;
  // keep only explicit shop=car OR amenity=car_dealership
  const ok = (tags.shop === "car") || (tags.amenity === "car_dealership");
  return !ok;
}

function mapOsmElement(el, stateCode) {
  const t = el.tags || {};
  const name = normalize(t.name);
  const city = normalize(t["addr:city"]);
  const postcode = normalize(t["addr:postcode"]);
  const phone = normalize(t["contact:phone"] || t["phone"]);
  const brands = detectBrands(t);

  // heuristics
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
    isUsed
  };
}

function dedupeDealers(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    const key = `${d.name}|${d.city}|${d.state}`.toLowerCase();
    if (!d.name) continue; // must have a name
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function fetchOverpassForState(state) {
  // Use ISO3166-2 state area (e.g., US-CA) to bound results.
  // Grab nodes/ways/relations with shop=car OR amenity=car_dealership, output tags + center.
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
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "dealers-plus/1.0 (contact: youremail@example.com)" },
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Overpass ${state} error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  // map + filter
  const mapped = elements
    .filter(el => el && el.tags && !isLifecycleClosed(el.tags))
    .map(el => mapOsmElement(el, state))
    .filter(d => d.name && d.state); // keep basics

  const deduped = dedupeDealers(mapped);

  // cap per state if PER_STATE provided
  return PER_STATE ? deduped.slice(0, PER_STATE) : deduped;
}

(async () => {
  const all = [];
  for (const state of STATES) {
    try {
      const list = await fetchOverpassForState(state);
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
})();
