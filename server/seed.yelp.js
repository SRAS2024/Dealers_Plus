server/seed.yelp.js
// Build a real dealers dataset using Yelp Fusion (category: cardealers).
// Writes seed/dealers.json which server/index.js auto-loads.
//
// Usage:
//   YELP_API_KEY=... node server/seed.yelp.js
//   YELP_API_KEY=... PER_STATE=30 PER_CITY_LIMIT=50 node server/seed.yelp.js
//
// Notes:
// - Respects Yelp's "is_closed" flag so only open dealerships are kept.
// - Data usage is subject to Yelp Fusion TOS; include proper attribution in your UI.

const fs = require("fs");
const path = require("path");

// ---------- config / args
const args = Object.fromEntries(
  process.argv.slice(2).map(s => {
    const [k, v] = s.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);

const YELP_API_KEY = process.env.YELP_API_KEY || args.key;
if (!YELP_API_KEY) {
  console.error("Missing YELP_API_KEY. Get one from https://www.yelp.com/developers/v3/manage_app");
  process.exit(1);
}

const PER_STATE = Number(process.env.PER_STATE || args.perState || 30);      // target dealers per state
const PER_CITY_LIMIT = Number(process.env.PER_CITY_LIMIT || args.perCity || 50); // max 50 per Yelp request
const OUT_DIR = path.join(__dirname, "..", "seed");
const OUT_FILE = path.join(OUT_DIR, "dealers.json");

// ---------- state -> a few major cities (enough coverage; de-duped across cities)
const STATES = [
  ["AL", ["Birmingham", "Montgomery", "Mobile"]],
  ["AK", ["Anchorage", "Fairbanks", "Juneau"]],
  ["AZ", ["Phoenix", "Tucson", "Mesa"]],
  ["AR", ["Little Rock", "Fayetteville", "Fort Smith"]],
  ["CA", ["Los Angeles", "San Diego", "San Jose", "San Francisco", "Sacramento"]],
  ["CO", ["Denver", "Colorado Springs", "Aurora"]],
  ["CT", ["Hartford", "New Haven", "Stamford"]],
  ["DE", ["Wilmington", "Dover", "Newark"]],
  ["FL", ["Miami", "Orlando", "Tampa", "Jacksonville"]],
  ["GA", ["Atlanta", "Savannah", "Augusta"]],
  ["HI", ["Honolulu", "Hilo", "Kailua"]],
  ["ID", ["Boise", "Idaho Falls", "Nampa"]],
  ["IL", ["Chicago", "Naperville", "Springfield"]],
  ["IN", ["Indianapolis", "Fort Wayne", "Evansville"]],
  ["IA", ["Des Moines", "Cedar Rapids", "Davenport"]],
  ["KS", ["Wichita", "Overland Park", "Topeka"]],
  ["KY", ["Louisville", "Lexington", "Bowling Green"]],
  ["LA", ["New Orleans", "Baton Rouge", "Shreveport"]],
  ["ME", ["Portland", "Augusta", "Bangor"]],
  ["MD", ["Baltimore", "Annapolis", "Silver Spring"]],
  ["MA", ["Boston", "Worcester", "Springfield"]],
  ["MI", ["Detroit", "Grand Rapids", "Ann Arbor"]],
  ["MN", ["Minneapolis", "Saint Paul", "Rochester"]],
  ["MS", ["Jackson", "Gulfport", "Hattiesburg"]],
  ["MO", ["Kansas City", "St. Louis", "Springfield"]],
  ["MT", ["Billings", "Missoula", "Bozeman"]],
  ["NE", ["Omaha", "Lincoln", "Bellevue"]],
  ["NV", ["Las Vegas", "Reno", "Henderson"]],
  ["NH", ["Manchester", "Nashua", "Concord"]],
  ["NJ", ["Newark", "Jersey City", "Trenton"]],
  ["NM", ["Albuquerque", "Santa Fe", "Las Cruces"]],
  ["NY", ["New York", "Buffalo", "Rochester"]],
  ["NC", ["Charlotte", "Raleigh", "Greensboro"]],
  ["ND", ["Fargo", "Bismarck", "Grand Forks"]],
  ["OH", ["Columbus", "Cleveland", "Cincinnati"]],
  ["OK", ["Oklahoma City", "Tulsa", "Norman"]],
  ["OR", ["Portland", "Eugene", "Salem"]],
  ["PA", ["Philadelphia", "Pittsburgh", "Allentown"]],
  ["RI", ["Providence", "Warwick", "Cranston"]],
  ["SC", ["Charleston", "Columbia", "Greenville"]],
  ["SD", ["Sioux Falls", "Rapid City", "Aberdeen"]],
  ["TN", ["Nashville", "Memphis", "Knoxville"]],
  ["TX", ["Houston", "Dallas", "Austin", "San Antonio"]],
  ["UT", ["Salt Lake City", "Provo", "Ogden"]],
  ["VT", ["Burlington", "Montpelier", "Rutland"]],
  ["VA", ["Virginia Beach", "Richmond", "Norfolk"]],
  ["WA", ["Seattle", "Spokane", "Tacoma"]],
  ["WV", ["Charleston", "Morgantown", "Huntington"]],
  ["WI", ["Milwaukee", "Madison", "Green Bay"]],
  ["WY", ["Cheyenne", "Casper", "Laramie"]],
];

const BRANDS = [
  "Toyota","Honda","Ford","Chevrolet","Nissan","Hyundai","Kia","Volkswagen",
  "Subaru","Mazda","Lexus","BMW","Mercedes-Benz","Audi","Volvo","Acura",
  "Infiniti","GMC","Ram","Jeep","Dodge","Chrysler","Cadillac","Buick",
  "Porsche","Jaguar","Land Rover","Mini","Mitsubishi","Tesla"
];

// ---------- helpers
const sleep = ms => new Promise(r => setTimeout(r, ms));

function detectBrands(name, categories) {
  const found = new Set();
  const hay = `${name} ${(categories||[]).map(c => c.title||c.alias||"").join(" ")}`.toLowerCase();
  BRANDS.forEach(b => {
    if (hay.includes(b.toLowerCase())) found.add(b);
  });
  return Array.from(found);
}

function mapBusinessToDealer(biz, idxSeed = 0) {
  const brands = detectBrands(biz.name, biz.categories);
  return {
    id: `YELP_${biz.id}`,
    name: biz.name,
    city: biz.location?.city || "",
    state: biz.location?.state || "",
    zip: biz.location?.zip_code || "",
    brands,
    phone: biz.display_phone || "",
    isNew: /new/i.test(biz.name) || brands.length > 0, // heuristic
    isUsed: true
  };
}

async function yelpSearch(city, state, limit = 50, offset = 0) {
  const params = new URLSearchParams({
    location: `${city}, ${state}`,
    categories: "cardealers",
    term: "car dealership",
    limit: String(Math.min(50, Math.max(1, limit))),
    offset: String(offset),
    sort_by: "best_match"
  });
  const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${YELP_API_KEY}` }
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Yelp error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return (data.businesses || []).filter(b => b && b.is_closed === false);
}

async function gatherForState(state, cities, target) {
  const seen = new Set();
  const dealers = [];

  for (const city of cities) {
    // One request per city (50 max); you can paginate if you want more depth:
    const batch = await yelpSearch(city, state, Math.min(PER_CITY_LIMIT, target));
    batch.forEach(b => {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        dealers.push(mapBusinessToDealer(b));
      }
    });

    // stop if we already reached target for this state
    if (dealers.length >= target) break;

    // gentle rate limit
    await sleep(300);
  }

  // If still short, try a statewide query (coarser, can be noisy but helps)
  if (dealers.length < target) {
    const extra = await yelpSearch(state, state, Math.min(50, target - dealers.length));
    extra.forEach(b => {
      if (!seen.has(b.id)) {
        seen.add(b.id);
        dealers.push(mapBusinessToDealer(b));
      }
    });
  }

  return dealers.slice(0, target);
}

// ---------- run
(async () => {
  const all = [];
  for (const [state, cities] of STATES) {
    try {
      const list = await gatherForState(state, cities, PER_STATE);
      all.push(...list);
      console.log(`State ${state}: +${list.length} dealers (total ${all.length})`);
      await sleep(350); // keep requests polite
    } catch (e) {
      console.error(`State ${state} failed:`, e.message);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(all, null, 2), "utf8");
  console.log(`\nWrote ${all.length} real, open dealerships to ${path.relative(process.cwd(), OUT_FILE)}.`);
  console.log("Reminder: Yelp data usage requires attribution and compliance with their TOS.");
})();
How to use
Add a script to package.json (optional):
"scripts": {
  "seed:real": "node server/seed.yelp.js"
}
