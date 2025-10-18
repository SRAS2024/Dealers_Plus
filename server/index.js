// Dealers Plus — Express server
// Railway-friendly: uses PORT or 5000, and TOKEN as the only extra env var.
// TOKEN defaults to "5000" to match your deployment preference.

const express = require("express");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const path = require("path");

// -------- Config
const PORT = process.env.PORT || 5000;
const SECRET = process.env.TOKEN || "5000";
const NODE_ENV = process.env.NODE_ENV || "development";

// -------- App
const app = express();
app.use(express.json());
app.use(cookieParser());

// Serve static frontend
app.use(express.static(path.join(__dirname, "..", "public")));

// -------- In-memory data (can be swapped for Mongo later)
const users = [
  // default admin
  {
    id: uuid(),
    username: "admin",
    firstName: "Admin",
    lastName: "User",
    role: "admin",
    // password: Admin@123
    passwordHash: bcrypt.hashSync("Admin@123", 10)
  }
];

const makes = [
  { id: uuid(), name: "Toyota" },
  { id: uuid(), name: "Honda" },
  { id: uuid(), name: "Ford" },
  { id: uuid(), name: "Chevrolet" },
  { id: uuid(), name: "Audi" },
  { id: uuid(), name: "BMW" },
  { id: uuid(), name: "Mercedes-Benz" }
];

const models = [
  { id: uuid(), make: "Toyota", name: "Camry" },
  { id: uuid(), make: "Toyota", name: "RAV4" },
  { id: uuid(), make: "Honda", name: "Civic" },
  { id: uuid(), make: "Honda", name: "Accord" },
  { id: uuid(), make: "Ford", name: "F-150" },
  { id: uuid(), make: "Ford", name: "Escape" },
  { id: uuid(), make: "Audi", name: "A6" },
  { id: uuid(), make: "BMW", name: "3 Series" },
  { id: uuid(), make: "Mercedes-Benz", name: "C-Class" }
];

const reviews = []; // filled by seedReviews()

const dealers = [
  {
    id: "D001",
    name: "Rocky Mountain Motors",
    city: "Denver",
    state: "CO",
    zip: "80202",
    brands: ["Toyota", "Honda"],
    phone: "(303) 555-1300"
  },
  {
    id: "D002",
    name: "Hudson River Autos",
    city: "New York",
    state: "NY",
    zip: "10001",
    brands: ["Audi", "BMW", "Mercedes-Benz"],
    phone: "(212) 555-2200"
  },
  {
    id: "D003",
    name: "Lone Star Drive",
    city: "Austin",
    state: "TX",
    zip: "73301",
    brands: ["Ford", "Chevrolet"],
    phone: "(512) 555-9988"
  },
  {
    id: "D004",
    name: "Windy City Wheels",
    city: "Chicago",
    state: "IL",
    zip: "60601",
    brands: ["Honda", "Toyota", "Ford"],
    phone: "(773) 555-4400"
  },
  {
    id: "D005",
    name: "Golden Gate Garage",
    city: "San Francisco",
    state: "CA",
    zip: "94103",
    brands: ["Audi", "BMW"],
    phone: "(415) 555-7777"
  }
];

// -------- Helpers
function sign(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role || "user",
      firstName: user.firstName,
      lastName: user.lastName
    },
    SECRET,
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const token = req.cookies?.dp_token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role === "admin") return next();
  return res.status(403).json({ error: "Forbidden" });
}

function averageRating(dealerId) {
  const r = reviews.filter(rv => rv.dealerId === dealerId);
  if (!r.length) return 0;
  const sum = r.reduce((acc, x) => acc + (x.rating || 0), 0);
  return Math.round((sum / r.length) * 10) / 10;
}

function toDealerDTO(d) {
  return {
    ...d,
    rating: averageRating(d.id),
    reviewsCount: reviews.filter(r => r.dealerId === d.id).length
  };
}

// Very small fuzzy search based on normalized inclusion and Levenshtein distance
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function lev(a, b) {
  a = norm(a);
  b = norm(b);
  const m = [];
  for (let i = 0; i <= b.length; i++) {
    m[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    m[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1)
      );
    }
  }
  return m[b.length][a.length];
}
function scoreQuery(q, text) {
  const nq = norm(q);
  const nt = norm(text);
  if (!nq || !nt) return 999;
  if (nt.includes nq) return 0;
  return lev(nq, nt);
}

// -------- Seed some reviews
function seedReviews() {
  const sample = [
    {
      review:
        "Friendly staff and quick service. Pricing was clear and fair. I would come back.",
      rating: 5,
      purchase: true,
      car_make: "Toyota",
      car_model: "Camry",
      car_year: 2021
    },
    {
      review:
        "Good selection and helpful test drive. Finance process was a little slow.",
      rating: 4,
      purchase: true,
      car_make: "Honda",
      car_model: "Civic",
      car_year: 2020
    },
    {
      review:
        "Showroom was clean. Sales team did not pressure me. Prices were competitive.",
      rating: 4,
      purchase: false
    },
    {
      review:
        "Service department diagnosed the issue fast and fixed it the same day.",
      rating: 5,
      purchase: false
    },
    {
      review:
        "Nice location and premium vibe. Some models had limited inventory.",
      rating: 4,
      purchase: false
    }
  ];

  const demoUser = {
    id: uuid(),
    username: "berkly",
    firstName: "Berkly",
    lastName: "Shepley",
    role: "user",
    passwordHash: bcrypt.hashSync("Password1!", 10)
  };
  users.push(demoUser);

  dealers.forEach((d, idx) => {
    const base = sample[idx % sample.length];
    // push three varied reviews per dealer
    for (let k = 0; k < 3; k++) {
      reviews.push({
        id: uuid(),
        dealerId: d.id,
        userId: demoUser.id,
        userName: `${demoUser.firstName} ${demoUser.lastName}`,
        review:
          k === 0
            ? base.review
            : k === 1
            ? "Total grid-enabled service desk. Smooth from start to finish."
            : "Excellent customer service. Transparent pricing and quality delivery.",
        rating: Math.max(3, Math.min(5, (base.rating || 4) - 1 + k)),
        time: new Date(Date.now() - (k + 1) * 86400000).toISOString(),
        purchase: !!base.purchase,
        purchase_date: base.purchase ? "07/11/2020" : "",
        car_make: base.car_make || "Ford",
        car_model: base.car_model || "F-150",
        car_year: base.car_year || 2019
      });
    }
  });
}
seedReviews();

// -------- Routes

app.get("/api/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Auth
app.post("/api/auth/register", async (req, res) => {
  const { username, firstName, lastName, password } = req.body || {};
  if (!username || !firstName || !lastName || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(400).json({ error: "Username already exists" });
  }
  const user = {
    id: uuid(),
    username,
    firstName,
    lastName,
    role: "user",
    passwordHash: await bcrypt.hash(password, 10)
  };
  users.push(user);
  const token = sign(user);
  res
    .cookie("dp_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    })
    .json({ ok: true, user: { username, firstName, lastName, role: "user" } });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body || {};
  const user = users.find(
    u => u.username.toLowerCase() === String(username || "").toLowerCase()
  );
  if (!user) {
    return res.status(401).json({ error: "Invalid Username or Password" });
  }
  const ok = await bcrypt.compare(password || "", user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid Username or Password" });
  }
  const token = sign(user);
  res
    .cookie("dp_token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60 * 1000
    })
    .json({
      ok: true,
      user: {
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("dp_token").json({ ok: true });
});

// Forgot password flow: verify then reset
app.post("/api/auth/verify", (req, res) => {
  const { username, firstName, lastName } = req.body || {};
  const user = users.find(
    u =>
      u.username.toLowerCase() === String(username || "").toLowerCase() &&
      u.firstName.toLowerCase() === String(firstName || "").toLowerCase() &&
      u.lastName.toLowerCase() === String(lastName || "").toLowerCase()
  );
  if (!user) return res.status(401).json({ error: "Invalid Credentials" });

  // short lived token to allow password reset without email
  const verifyToken = jwt.sign({ sub: user.id, kind: "reset" }, SECRET, {
    expiresIn: "10m"
  });
  res.json({ ok: true, verifyToken });
});

app.post("/api/auth/reset", async (req, res) => {
  const { verifyToken, password } = req.body || {};
  try {
    const payload = jwt.verify(verifyToken, SECRET);
    if (payload.kind !== "reset") throw new Error("bad kind");
    const user = users.find(u => u.id === payload.sub);
    if (!user) return res.status(404).json({ error: "Not found" });
    user.passwordHash = await bcrypt.hash(password, 10);
    return res.json({ ok: true });
  } catch {
    return res.status(401).json({ error: "Invalid Credentials" });
  }
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.sub,
      username: req.user.username,
      firstName: req.user.firstName,
      lastName: req.user.lastName,
      role: req.user.role
    }
  });
});

// Admin: add make and model
app.post("/api/admin/makes", authMiddleware, adminMiddleware, (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Missing name" });
  if (makes.find(m => m.name.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: "Make already exists" });
  }
  const mk = { id: uuid(), name };
  makes.push(mk);
  res.json({ ok: true, make: mk });
});

app.post("/api/admin/models", authMiddleware, adminMiddleware, (req, res) => {
  const { make, name } = req.body || {};
  if (!make || !name) return res.status(400).json({ error: "Missing fields" });
  if (!makes.find(m => m.name.toLowerCase() === make.toLowerCase())) {
    return res.status(400).json({ error: "Unknown make" });
  }
  const md = { id: uuid(), make, name };
  models.push(md);
  res.json({ ok: true, model: md });
});

// Dealers and reviews
app.get("/api/dealers/states", (req, res) => {
  const states = Array.from(new Set(dealers.map(d => d.state))).sort();
  res.json({ ok: true, states });
});

app.get("/api/dealers", (req, res) => {
  const { state, city, zip, brand, q } = req.query;
  let list = dealers.slice();

  if (state) {
    list = list.filter(d => d.state.toLowerCase() === String(state).toLowerCase());
  }
  if (city) {
    list = list.filter(d => d.city.toLowerCase() === String(city).toLowerCase());
  }
  if (zip) {
    list = list.filter(d => d.zip === String(zip));
  }
  if (brand) {
    list = list.filter(d =>
      d.brands.map(b => b.toLowerCase()).includes(String(brand).toLowerCase())
    );
  }
  if (q) {
    // smart search across name, city, state, zip, brands
    const scored = list
      .map(d => {
        const s = Math.min(
          scoreQuery(q, d.name),
          scoreQuery(q, d.city),
          scoreQuery(q, d.state),
          scoreQuery(q, d.zip),
          ...d.brands.map(b => scoreQuery(q, b))
        );
        return { dealer: d, score: s };
      })
      .sort((a, b) => a.score - b.score);

    // if best score is high, return empty to trigger "No matching results"
    if (!scored.length || scored[0].score > 4) {
      return res.json({ ok: true, dealers: [] });
    }
    list = scored.map(x => x.dealer);
  }

  res.json({ ok: true, dealers: list.map(toDealerDTO) });
});

app.get("/api/dealers/:id", (req, res) => {
  const d = dealers.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });
  const r = reviews
    .filter(rv => rv.dealerId === d.id)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({
    ok: true,
    dealer: toDealerDTO(d),
    reviews: r
  });
});

app.post("/api/dealers/:id/reviews", authMiddleware, (req, res) => {
  const d = dealers.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: "Not found" });

  const {
    review,
    rating,
    purchase,
    purchase_date,
    car_make,
    car_model,
    car_year
  } = req.body || {};

  const user = users.find(u => u.id === req.user.sub);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const rv = {
    id: uuid(),
    dealerId: d.id,
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`,
    review: String(review || "").trim(),
    rating: Math.max(1, Math.min(5, Number(rating) || 0)),
    time: new Date().toISOString(),
    purchase: !!purchase,
    purchase_date: purchase ? String(purchase_date || "") : "",
    car_make: car_make || "",
    car_model: car_model || "",
    car_year: Number(car_year) || ""
  };

  if (!rv.review) return res.status(400).json({ error: "Review text required" });
  if (!rv.rating) return res.status(400).json({ error: "Rating required" });

  reviews.push(rv);

  const r = reviews
    .filter(x => x.dealerId === d.id)
    .sort((a, b) => new Date(b.time) - new Date(a.time));

  res.json({ ok: true, dealer: toDealerDTO(d), reviews: r, featured: rv.id });
});

app.put("/api/reviews/:id", authMiddleware, (req, res) => {
  const rv = reviews.find(x => x.id === req.params.id);
  if (!rv) return res.status(404).json({ error: "Not found" });
  if (rv.userId !== req.user.sub) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { review, rating } = req.body || {};
  if (typeof review === "string") rv.review = review.trim();
  if (rating != null) rv.rating = Math.max(1, Math.min(5, Number(rating) || 0));
  rv.time = new Date().toISOString(); // bump to top
  res.json({ ok: true, review: rv });
});

// Suggestions for the typeahead (three items)
app.get("/api/search/suggest", (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ ok: true, suggestions: [] });

  const pool = [
    ...dealers.map(d => ({ kind: "dealer", value: d.name })),
    ...dealers.map(d => ({ kind: "city", value: d.city })),
    ...dealers.map(d => ({ kind: "state", value: d.state })),
    ...dealers.map(d => ({ kind: "zip", value: d.zip })),
    ...Array.from(new Set(dealers.flatMap(d => d.brands))).map(b => ({
      kind: "brand",
      value: b
    }))
  ];

  const scored = pool
    .map(it => ({ ...it, score: scoreQuery(q, it.value) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3);

  res.json({ ok: true, suggestions: scored });
});

// Fallback to index.html for app routes
app.get("*", (req, res, next) => {
  // only serve index for non-api paths
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// -------- Start
app.listen(PORT, () => {
  console.log(`Dealers Plus server running on port ${PORT}`);
});
