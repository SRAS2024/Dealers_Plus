// server/seed.osm.js
// Build a real dealers dataset from OpenStreetMap via Overpass API.
// Writes seed/dealers.json which server/index.js loads at boot.
//
// Usage examples:
//   node server/seed.osm.js
//   PER_STATE=0 node server/seed.osm.js                // keep all per state
//   REVERSE_GEOCODE=1 node server/seed.osm.js          // fill missing city/zip politely via Nominatim
//   REVERSE_LIMIT=300 node server/seed.osm.js          // cap reverse geocode calls
//
// Notes:
// - Filters out disused or abandoned lifecycle tags.
// - Accepts "shop=car" and "amenity=car_dealership" only.
// - Brand detection from name, brand, and operator tags.
// - Includes coordinates for proximity and ZIP searches.
// - Add attribution in your UI: "© OpenStreetMap contributors".

const fs = require("fs");
const path = require("path");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- config
// PER_STATE=0 means no cap. If set to a positive number, results per state are limited.
const PER_STATE = Number(process.env.PER_STATE || 0);
const OUT_DIR = path.join(__dirname, "..", "seed");
const OUT_FILE = path.join(OUT_DIR, "dealers.json");

// Optional reverse geocoding to fill missing city or zip via Nominatim
const REVERSE_GEOCODE = /^(1|true|yes)$/i.test(String(process.env.REVERSE_GEOCODE || "0"));
const REVERSE_LIMIT = Math.max(0, Number(process.env.REVERSE_LIMIT || 400));
const REVERSE_SLEEP_MS = Math.max(600, Number(process.env.REVERSE_SLEEP_MS || 1200)); // be polite

// Throttling for Overpass
const OVERPASS_SLEEP_MS = Math.max(800, Number(process.env.OVERPASS_SLEEP_MS || 1200));

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

// ---------- helpers
function normalize(s) {
  return String(s || "").trim();
}
function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}
function toZip5(s) {
  const d = onlyDigits(s);
  return d ? d.slice(0, 5) : "";
}
function detectBrands(tags) {
  const hay = `${tags.name || ""} ${tags.brand || ""} ${tags.operator || ""}`.toLowerCase();
  const out = [];
  BRANDS.forEach(b => {
    if (hay.includes(b.toLowerCase())) out.push(b);
  });
  return Array.from(new Set(out));
}
function hasLifecycleBlock(tags) {
  if (!tags) return true;
  // exclude typical lifecycle states or non matching features
  if (tags.disused === "yes") return true;
  if (tags.abandoned === "yes") return true;
  const keys = Object.keys(tags);
  if (keys.some(k => /^disused:/.test(k) || /^abandoned:/.test(k) || /^was:/.test(k))) return true;

  const ok = (tags.shop === "car") || (tags.amenity === "car_dealership");
  return !ok;
}

function pickLocation(el) {
  // nodes have lat/lon; ways and relations come with center when requested by "out ... center"
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center && typeof el.center.lat === "number" && typeof el.center.lon === "number") {
    return { lat: el.center.lat, lon: el.center.lon };
  }
  return null;
}

function dedupeDealers(list) {
  const seen = new Set();
  const out = [];
  for (const d of list) {
    if (!d.name) continue;
    // name + city + state + zip is strict, fallback to name + city + state
    const keyA = `${d.name}|${d.city}|${d.state}|${d.zip}`.toLowerCase();
    const keyB = `${d.name}|${d.city}|${d.state}`.toLowerCase();
    const key = d.zip ? keyA : keyB;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

async function reverseGeocode(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "16");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "dealers-plus/1.0 (contact: support@dealersplus.example)"
    }
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || !j.address) return null;
  const addr = j.address;
  return {
    city: addr.city || addr.town || addr.village || addr.hamlet || "",
    state: addr.state || "",
    zip: toZip5(addr.postcode || "")
  };
}

function mapOsmElement(el, stateCode) {
  const t = el.tags || {};
  const loc = pickLocation(el);
  const name = normalize(t.name);
  const city = normalize(t["addr:city"]);
  const state = stateCode || normalize(t["addr:state"]);
  const postcode = toZip5(t["addr:postcode"]);
  const phone = normalize(t["contact:phone"] || t["phone"]);
  const brands = detectBrands(t);

  const isNew = /new|authorized|dealer|dealership/i.test(name) || brands.length > 0;
  const isUsed = true;

  return {
    id: `OSM_${el.type}_${el.id}`,
    name,
    city,
    state,
    zip: postcode,
    brands,
    phone,
    isNew,
    isUsed,
    location: loc // { lat, lon } or null
  };
}

async function fetchOverpassForState(state) {
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
      "User-Agent": "dealers-plus/1.0 (contact: support@dealersplus.example)"
    },
    body: new URLSearchParams({ data: query })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Overpass ${state} error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const elements = Array.isArray(data.elements) ? data.elements : [];

  // map and filter
  const mapped = elements
    .filter(el => el && el.tags && !hasLifecycleBlock(el.tags))
    .map(el => mapOsmElement(el, state))
    .filter(d => d.name && d.state); // keep basics

  // optional cap per state
  const list = PER_STATE > 0 ? mapped.slice(0, PER_STATE) : mapped;
  return list;
}

(async () => {
  const all = [];
  let reverseCalls = 0;

  for (const state of STATES) {
    try {
      const list = await fetchOverpassForState(state);
      all.push(...list);
      console.log(`US-${state}: +${list.length} dealers (running total ${all.length})`);
      await sleep(OVERPASS_SLEEP_MS);
    } catch (e) {
      console.error(`US-${state} failed: ${e.message}`);
      await sleep(OVERPASS_SLEEP_MS * 2);
    }
  }

  // Try to fill missing city or zip with reverse geocode, politely and with a cap
  if (REVERSE_GEOCODE) {
    const cache = new Map(); // key: lat.toFixed(5)+","+lon.toFixed(5)
    for (const d of all) {
      if (reverseCalls >= REVERSE_LIMIT) break;
      const needsCity = !d.city;
      const needsZip = !d.zip;
      const hasLoc = d.location && typeof d.location.lat === "number" && typeof d.location.lon === "number";
      if ((needsCity || needsZip) && hasLoc) {
        const key = `${d.location.lat.toFixed(5)},${d.location.lon.toFixed(5)}`;
        let info = cache.get(key);
        if (!info) {
          info = await reverseGeocode(d.location.lat, d.location.lon);
          cache.set(key, info);
          reverseCalls++;
          await sleep(REVERSE_SLEEP_MS);
        }
        if (info) {
          if (!d.city && info.city) d.city = info.city;
          if (!d.state && info.state) d.state = info.state;
          if (!d.zip && info.zip) d.zip = info.zip;
        }
      }
    }
    console.log(`Reverse geocode lookups used: ${reverseCalls}/${REVERSE_LIMIT}`);
  }

  const deduped = dedupeDealers(all);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(deduped, null, 2), "utf8");

  console.log(`\nWrote ${deduped.length} dealerships to ${path.relative(process.cwd(), OUT_FILE)}.`);
  console.log('Attribution: Data © OpenStreetMap contributors (ODbL).');
})();
