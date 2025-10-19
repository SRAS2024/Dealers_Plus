// server/seed.js
// Generate a large, realistic dealers dataset covering all 50 states.
// Writes to seed/dealers.json which server/index.js loads at boot.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- config / args
const args = Object.fromEntries(
  process.argv.slice(2).map(s => {
    const [k, v] = s.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  })
);
const PER_STATE = Number(process.env.PER_STATE || args.perState || 15); // default dealers per state
const OUT_DIR = path.join(__dirname, "..", "seed");
const OUT_FILE = path.join(OUT_DIR, "dealers.json");

// ---------- data
const STATES = [
  ["AL", ["Birmingham", "Montgomery", "Mobile"]],
  ["AK", ["Anchorage", "Fairbanks", "Juneau"]],
  ["AZ", ["Phoenix", "Tucson", "Mesa"]],
  ["AR", ["Little Rock", "Fayetteville", "Fort Smith"]],
  ["CA", ["Los Angeles", "San Diego", "San Francisco", "Sacramento", "San Jose"]],
  ["CO", ["Denver", "Colorado Springs", "Aurora"]],
  ["CT", ["Hartford", "New Haven", "Stamford"]],
  ["DE", ["Wilmington", "Dover", "Newark"]],
  ["FL", ["Miami", "Orlando", "Tampa", "Jacksonville"]],
  ["GA", ["Atlanta", "Savannah", "Augusta"]],
  ["HI", ["Honolulu", "Hilo", "Kailua"]],
  ["ID", ["Boise", "Idaho Falls", "Nampa"]],
  ["IL", ["Chicago", "Springfield", "Naperville"]],
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

const NAME_PARTS = {
  adj: ["Summit","Premier","Metro","Golden","Liberty","Pinnacle","Heritage","Capital","Grand","Silver","Tri-City","Sunset","Highline","Blue Ridge","Frontier","Red Rock","Coastal","Prairie","Bay Area","River"],
  noun: ["Motors","Auto Group","Auto Mall","Autohaus","Garage","Drive","Car Center","Auto Plaza","Motorcars","Auto Sales","Automotive","Imports","Dealership","Auto Outlet","Autos"]
};

// ---------- helpers
function pseudoRandomInt(min, max, seed) {
  const h = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 8);
  const n = parseInt(h, 16);
  return min + (n % (max - min + 1));
}

function pickN(arr, n, seed) {
  const copy = arr.slice();
  // Fisher-Yates with deterministic seed steps
  for (let i = copy.length - 1; i > 0; i--) {
    const j = pseudoRandomInt(0, i, seed + ":" + i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function phoneFor(seed) {
  // NANP-ish, not real. Area 2-9xx, exchange 2-9xx, line xxxx
  const a = pseudoRandomInt(200, 989, seed + ":a");
  const b = pseudoRandomInt(200, 989, seed + ":b");
  const c = String(pseudoRandomInt(0, 9999, seed + ":c")).padStart(4, "0");
  return `(${a}) ${String(b).padStart(3, "0")}-${c}`;
}

function zipFor(state, city, i) {
  // deterministic 5-digit
  const n = pseudoRandomInt(10000, 99999, `${state}|${city}|${i}`);
  return String(n);
}

function nameFor(city, seed) {
  const adj = NAME_PARTS.adj[pseudoRandomInt(0, NAME_PARTS.adj.length - 1, seed + ":adj")];
  const noun = NAME_PARTS.noun[pseudoRandomInt(0, NAME_PARTS.noun.length - 1, seed + ":noun")];
  // 50/50 include city in name
  if (pseudoRandomInt(0, 1, seed + ":city") === 1) {
    return `${city} ${noun}`;
  }
  return `${adj} ${noun}`;
}

function dealerRecord(idx, state, city) {
  const seed = `${state}-${city}-${idx}`;
  const id = "D" + String(idx + 1).padStart(4, "0");
  const brands = pickN(BRANDS, pseudoRandomInt(1, 3, seed + ":brands"), seed);
  return {
    id,
    name: nameFor(city, seed),
    city,
    state,
    zip: zipFor(state, city, idx),
    brands,
    phone: phoneFor(seed),
    isNew: pseudoRandomInt(0, 1, seed + ":new") === 1,
    isUsed: true // most dealers sell used; keep UX rich
  };
}

// ---------- generate
const dealers = [];
let counter = 0;

STATES.forEach(([state, cities]) => {
  for (let i = 0; i < PER_STATE; i++) {
    const city = cities[pseudoRandomInt(0, cities.length - 1, `${state}:${i}`)];
    dealers.push(dealerRecord(counter, state, city));
    counter++;
  }
});

// ---------- write
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(dealers, null, 2), "utf8");

console.log(`Wrote ${dealers.length} dealers to ${path.relative(process.cwd(), OUT_FILE)} across ${STATES.length} states (≈${PER_STATE} per state).`);
console.log("Tip: re-run with --perState=25 (or PER_STATE=25) to scale up.");
