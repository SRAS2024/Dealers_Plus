/* Dealers Plus front-end
   Vanilla JS + Bootstrap
   Hash router with views for home, dealers list, dealer detail, about, contact

   Update highlights:
   - Smarter search parsing on Enter: detects ZIP, "City, ST", "City ST", or "City State".
   - Suggestion clicks now route by type: zip, city, state, brand.
   - Dealers list respects city, state, zip, brand, and q params.
   - Fix: Add Review opens reliably after login and on the dealer page without recursive clicks.
   - Fix: Suggestions dropdown closes on route changes for consistent behavior across screens.
   - NEW: Pen icon to the left of stars (only on user's own reviews) enters edit mode with Save/Cancel/Delete.
*/

(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // State
  let me = null; // current user
  let router = null;
  let accountModal = null;
  let reviewModal = null;
  let pendingAction = null; // { type: "addReview", dealerId }
  let resetVerifyToken = null;

  // Elements
  const viewRoot = $("#viewRoot");
  const globalAlert = $("#globalAlert");
  const yearEl = $("#year");

  // Static helpers and maps
  const STATE_NAME_TO_CODE = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
    california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
    florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
    illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
    kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    "massachusetts": "MA", michigan: "MI", minnesota: "MN", "mississippi": "MS",
    "missouri": "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
    oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
    vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
    wisconsin: "WI", wyoming: "WY", "district of columbia": "DC"
  };
  const STATE_CODES = new Set(Object.values(STATE_NAME_TO_CODE));

  function toTitleCase(s) {
    return String(s || "")
      .trim()
      .toLowerCase()
      .replace(/\b[a-z]/g, ch => ch.toUpperCase());
  }

  function looksLikeZip(s) {
    return /^\s*\d{5}(-\d{4})?\s*$/i.test(String(s || ""));
  }
  function zip5(s) {
    const d = String(s || "").replace(/\D+/g, "");
    return d.slice(0, 5);
  }
  function normalizeStateToken(tok) {
    if (!tok) return "";
    const t = String(tok).trim().toLowerCase();
    if (t.length === 2 && STATE_CODES.has(t.toUpperCase())) return t.toUpperCase();
    if (STATE_NAME_TO_CODE[t]) return STATE_NAME_TO_CODE[t];
    const joined = t.replace(/\s+/g, " ");
    if (STATE_NAME_TO_CODE[joined]) return STATE_NAME_TO_CODE[joined];
    return "";
  }

  // Parse free text into concrete filters when possible
  // Returns an object like { zip } or { city, state } or { q } or { brand }
  function parseSearchQuery(input) {
    const raw = String(input || "").trim();
    if (!raw) return { q: "" };

    // ZIP
    if (looksLikeZip(raw)) {
      return { zip: zip5(raw) };
    }

    // Split by comma first: "City, ST" or "City, State"
    if (raw.includes(",")) {
      const [left, right] = raw.split(",", 2);
      const city = toTitleCase(left);
      const st = normalizeStateToken(right);
      if (city && st) return { city, state: st };
    }

    // Try "City ST" or "City State"
    const parts = raw.split(/\s+/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const st = normalizeStateToken(last);
      if (st) {
        const city = toTitleCase(parts.slice(0, parts.length - 1).join(" "));
        if (city) return { city, state: st };
      }
    }

    // Fallback free text
    return { q: raw };
  }

  // Init
  document.addEventListener("DOMContentLoaded", () => {
    yearEl.textContent = new Date().getFullYear();
    accountModal = new bootstrap.Modal($("#accountModal"));
    bindNav();
    bindAccountFlows();
    bindSearch();
    whoAmI().finally(() => {
      router = new Router();
      router.start();
    });
  });

  // Helpers
  function showAlert(type, msg, timeout = 3000) {
    globalAlert.className = `alert alert-${type}`;
    globalAlert.textContent = msg;
    globalAlert.classList.remove("d-none");
    if (timeout) {
      setTimeout(() => {
        globalAlert.classList.add("d-none");
      }, timeout);
    }
  }

  function starsHtml(rating) {
    const r = Math.round(Number(rating) || 0);
    let h = "";
    for (let i = 1; i <= 5; i++) {
      h += `<i class="bi ${i <= r ? "bi-star-fill text-warning" : "bi-star text-warning"}"></i>`;
    }
    return h;
  }

  function sentimentBadge(sentiment) {
    const s = String(sentiment || "neutral");
    const label = s.charAt(0).toUpperCase() + s.slice(1);
    const tone =
      s === "positive" ? "success" : s === "negative" ? "danger" : "secondary";
    return `<span class="badge bg-${tone} ms-2">${label}</span>`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = data?.error || "Request failed";
      throw new Error(error);
    }
    return data;
  }

  async function whoAmI() {
    try {
      const { user } = await api("/api/me");
      me = user;
      setAuthedUI(true, user);
    } catch {
      me = null;
      setAuthedUI(false);
    }
  }

  function setAuthedUI(authed, user) {
    const accountBtn = $("#btnAccount");
    const navUser = $("#navUserWrapper");
    const navUserName = $("#navUserName");
    const logoutBtn = $("#btnLogout");
    if (authed) {
      accountBtn.classList.add("d-none");
      navUser.classList.remove("d-none");
      navUserName.textContent = `${user.firstName} ${user.lastName}`;
      logoutBtn.onclick = async () => {
        await api("/api/auth/logout", { method: "POST" });
        me = null;
        setAuthedUI(false);
        showAlert("success", "Logged out.");
      };
    } else {
      accountBtn.classList.remove("d-none");
      navUser.classList.add("d-none");
      navUserName.textContent = "";
    }
  }

  function bindNav() {
    $("#btnAccount").addEventListener("click", () => {
      showLogin();
      accountModal.show();
    });
  }

  // Search
  function bindSearch() {
    const input = $("#searchInput");
    const btn = $("#searchGo");
    const dd = $("#suggestions");

    function routeForSuggestion(kind, value) {
      const p = new URLSearchParams();
      if (kind === "zip") {
        p.set("zip", zip5(value));
      } else if (kind === "state") {
        p.set("state", normalizeStateToken(value));
      } else if (kind === "city") {
        p.set("city", toTitleCase(value));
      } else if (kind === "brand") {
        p.set("brand", value);
      } else {
        p.set("q", value);
      }
      location.hash = `#/dealers${p.toString() ? "?" + p.toString() : ""}`;
    }

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (!q) {
        dd.classList.remove("show");
        return;
      }
      debounce = setTimeout(async () => {
        try {
          const data = await api(`/api/search/suggest?q=${encodeURIComponent(q)}`);
          const items = data.suggestions || [];
          if (!items.length) {
            dd.classList.remove("show");
            return;
          }
          dd.innerHTML = items
            .map(
              it => `<button type="button" class="dropdown-item" data-kind="${it.kind || it.type}" data-value="${it.value}">
                  <span class="badge rounded-pill me-2">${it.kind || it.type}</span>
                  <span>${it.value}</span>
                </button>`
            )
            .join("");
          dd.classList.add("show");
          $$("#suggestions .dropdown-item").forEach(el => {
            el.onclick = () => {
              const kind = el.getAttribute("data-kind");
              const value = el.getAttribute("data-value");
              input.value = value;
              dd.classList.remove("show");
              routeForSuggestion(kind, value);
            };
          });
        } catch {
          dd.classList.remove("show");
        }
      }, 180);
    });

    input.addEventListener("keydown", e => {
      if (e.key === "Enter") {
        e.preventDefault();
        dd.classList.remove("show");
        goDealersSearch(input.value);
      }
    });
    btn.addEventListener("click", () => {
      dd.classList.remove("show");
      goDealersSearch(input.value);
    });

    document.addEventListener("click", e => {
      if (!dd.contains(e.target) && e.target !== input) {
        dd.classList.remove("show");
      }
    });

    // Close suggestions when the route changes to keep behavior consistent across screens
    window.addEventListener("hashchange", () => {
      dd.classList.remove("show");
    });
  }

  function goDealersSearch(query) {
    const parsed = parseSearchQuery(query);
    const p = new URLSearchParams();
    if (parsed.zip) p.set("zip", parsed.zip);
    if (parsed.city) p.set("city", parsed.city);
    if (parsed.state) p.set("state", parsed.state);
    if (parsed.brand) p.set("brand", parsed.brand);
    if (parsed.q) p.set("q", parsed.q);
    location.hash = `#/dealers${p.toString() ? "?" + p.toString() : ""}`;
  }

  // Router
  class Router {
    constructor() {
      window.addEventListener("hashchange", () => this.route());
    }
    start() {
      if (!location.hash) {
        location.hash = "#/"; // home
      } else {
        this.route();
      }
    }
    route() {
      const hash = location.hash.slice(1) || "/";
      const [path, qs] = hash.split("?");
      const params = new URLSearchParams(qs || "");
      if (path === "/") {
        renderHome();
      } else if (path === "/dealers") {
        renderDealers(params);
      } else if (path.startsWith("/dealer/")) {
        const id = path.split("/")[2];
        renderDealerDetail(id);
      } else if (path === "/about") {
        renderAbout();
      } else if (path === "/contact") {
        renderContact();
      } else {
        renderHome();
      }
    }
  }

  // Views
  function renderHome() {
    viewRoot.innerHTML = `
      <div class="row gy-4">
        <div class="col-12">
          ${$("#tpl-about").innerHTML}
        </div>
      </div>
    `;
  }

  function renderAbout() {
    viewRoot.innerHTML = $("#tpl-about").innerHTML;
  }

  function renderContact() {
    viewRoot.innerHTML = $("#tpl-contact").innerHTML;
  }

  async function renderDealers(params) {
    viewRoot.innerHTML = $("#tpl-dealers").innerHTML;

    const stateSelect = $("#stateSelect");
    const btnApply = $("#btnStateApply");
    const tbody = $("#dealersTbody");
    const noResults = $("#noResults");

    // states
    try {
      const data = await api("/api/dealers/states");
      (data.states || []).forEach(s => {
        const opt = document.createElement("option");
        opt.value = s;
        opt.textContent = s;
        stateSelect.appendChild(opt);
      });
    } catch {}

    // apply handlers
    btnApply.onclick = () => {
      const st = stateSelect.value;
      const next = new URLSearchParams();
      const q = params.get("q") || "";
      if (q) next.set("q", q);
      if (st) next.set("state", st);
      location.hash = `#/dealers${next.toString() ? "?" + next.toString() : ""}`;
    };

    // initial fetch
    await fetchDealers();

    async function fetchDealers() {
      const query = {};
      if (params.get("state")) query.state = params.get("state");
      if (params.get("city")) query.city = params.get("city");
      if (params.get("zip")) query.zip = params.get("zip");
      if (params.get("brand")) query.brand = params.get("brand");
      if (params.get("q")) query.q = params.get("q");

      const qstr = new URLSearchParams(query).toString();
      const data = await api(`/api/dealers${qstr ? "?" + qstr : ""}`);
      const list = data.dealers || [];
      noResults.classList.toggle("d-none", list.length > 0);
      tbody.innerHTML = list
        .map(
          d => `<tr>
            <td><a href="#/dealer/${d.id}" class="fw-semibold">${d.name}</a></td>
            <td>${d.city}</td>
            <td>${d.state}</td>
            <td>${d.brands.map(b => `<span class="badge-soft me-1">${b}</span>`).join(" ")}</td>
            <td class="text-center">${d.rating ? d.rating.toFixed(1) : "0.0"}</td>
            <td class="text-center">${d.reviewsCount}</td>
            <td class="actions">
              <a class="btn btn-outline-primary btn-sm" href="#/dealer/${d.id}">Details</a>
              <button class="btn btn-primary btn-sm" data-action="review" data-id="${d.id}">
                <i class="bi bi-pencil-square me-1"></i>Review
              </button>
            </td>
          </tr>`
        )
        .join("");

      $$('button[data-action="review"]').forEach(btn => {
        btn.onclick = () => beginAddReview(btn.getAttribute("data-id"));
      });

      if (params.get("state")) {
        stateSelect.value = params.get("state");
      }
    }
  }

  async function renderDealerDetail(id) {
    // fetch dealer summary
    const { dealer } = await api(`/api/dealers/${encodeURIComponent(id)}`);

    // inject template
    viewRoot.innerHTML = $("#tpl-dealer-detail").innerHTML;

    // cache modal instance
    reviewModal = new bootstrap.Modal($("#reviewModal"));

    // header
    $("#dealerName").textContent = dealer.name;
    $("#dealerMeta").textContent = `${dealer.city}, ${dealer.state} • ${dealer.brands.join(", ")}`;
    $("#dealerRating").textContent = dealer.rating ? dealer.rating.toFixed(1) : "0.0";
    $("#dealerStars").innerHTML = starsHtml(dealer.rating);

    // add a loader and a View more container
    const reviewsRoot = $("#reviewsList");
    const moreWrap = document.createElement("div");
    moreWrap.id = "reviewsMore";
    moreWrap.className = "d-flex justify-content-center mt-2";
    reviewsRoot.parentElement.appendChild(moreWrap);

    let page = 1;
    let nextPage = null;

    async function loadPage(p) {
      const res = await api(`/api/dealers/${encodeURIComponent(id)}/reviews?page=${p}&limit=5`);
      const items = res.reviews || [];
      nextPage = res.nextPage;
      appendReviews(items);
      renderMoreButton();
    }

    function renderMoreButton() {
      moreWrap.innerHTML = "";
      if (!nextPage) return;
      const btn = document.createElement("button");
      btn.className = "btn btn-outline-primary";
      btn.textContent = "View more reviews";
      btn.onclick = async () => {
        if (!nextPage) return;
        page = nextPage;
        await loadPage(page);
      };
      moreWrap.appendChild(btn);
    }

    // render reviews page chunk
    function appendReviews(list) {
      const frag = document.createDocumentFragment();
      list.forEach(rv => {
        const canEdit = me && rv.userId === me.id;
        const cardCol = document.createElement("div");
        cardCol.className = "col-12 col-lg-6";
        cardCol.innerHTML = `
          <div class="p-3 review-card" data-review="${rv.id}">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <div>
                <div class="fw-semibold">${rv.userName}</div>
                <div class="review-meta">${new Date(rv.time).toLocaleString()}</div>
              </div>
              <div class="d-flex align-items-center gap-2 text-nowrap">
                ${
                  canEdit
                    ? `<button class="btn btn-link p-0 edit-pen" data-action="edit" data-id="${rv.id}" title="Edit review">
                         <i class="bi bi-pen"></i>
                       </button>`
                    : ""
                }
                <span class="rating-stars">${starsHtml(rv.rating)}</span>
                ${rv.sentiment ? sentimentBadge(rv.sentiment) : ""}
              </div>
            </div>
            <div class="mt-2" data-role="text">${escapeHtml(rv.review)}</div>
            ${
              rv.purchase
                ? `<div class="mt-2 small">
                    <span class="badge-soft me-2">Purchased</span>
                    ${rv.purchase_date ? `<span class="me-2">${rv.purchase_date}</span>` : ""}
                    ${rv.car_year ? `<span>${rv.car_year} ${escapeHtml(rv.car_make || "")} ${escapeHtml(rv.car_model || "")}</span>` : ""}
                  </div>`
                : ""
            }
          </div>
        `;
        frag.appendChild(cardCol);
      });
      reviewsRoot.appendChild(frag);

      $$('button[data-action="edit"]').forEach(btn => {
        btn.onclick = () => startEditReview(btn.getAttribute("data-id"));
      });
      // No default delete buttons anymore; delete is available inside edit mode.
    }

    // first page
    await loadPage(page);

    // add review button
    $("#btnAddReview").onclick = () => beginAddReview(id);

    // star input init inside modal when opened
    initStarInput($("#rfStars"), value => {
      $("#rfRating").value = value;
    });

    // form submit
    $("#reviewForm").addEventListener("submit", async e => {
      e.preventDefault();
      const payload = {
        review: $("#rfText").value.trim(),
        rating: Number($("#rfRating").value),
        purchase: $("#rfPurchase").checked,
        purchase_date: $("#rfDate").value,
        car_make: $("#rfMake").value.trim(),
        car_model: $("#rfModel").value.trim(),
        car_year: $("#rfYear").value ? Number($("#rfYear").value) : ""
      };
      const alertBox = $("#rfAlert");
      alertBox.classList.add("d-none");
      try {
        await api(`/api/dealers/${encodeURIComponent(id)}/reviews`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        reviewModal.hide();
        showAlert("success", "Review submitted.");
        // refresh dealer header and reviews first page so the new one is on top
        const { dealer: refreshed } = await api(`/api/dealers/${encodeURIComponent(id)}`);
        $("#dealerRating").textContent = refreshed.rating ? refreshed.rating.toFixed(1) : "0.0";
        $("#dealerStars").innerHTML = starsHtml(refreshed.rating);
        // reset list and load first page again
        $("#reviewsList").innerHTML = "";
        page = 1;
        await loadPage(page);
      } catch (err) {
        if (String(err.message).includes("Unauthorized")) {
          // prompt login and retry
          pendingAction = { type: "addReview", dealerId: id, payload };
          showLogin();
          accountModal.show();
          return;
        }
        alertBox.className = "alert alert-danger";
        alertBox.textContent = err.message || "Failed to submit review";
        alertBox.classList.remove("d-none");
      }
    });
  }

  function startEditReview(id) {
    const card = document.querySelector(`.review-card[data-review="${id}"]`);
    if (!card) return;
    const textEl = card.querySelector('[data-role="text"]');
    const oldText = textEl.textContent;
    const headerStars = card.querySelector(".rating-stars")?.innerHTML || "";
    card.dataset.mode = "edit";

    const editor = document.createElement("div");
    editor.innerHTML = `
      <div class="mt-3">
        <label class="form-label">Edit your review</label>
        <textarea class="form-control" rows="3" data-role="editor"></textarea>
      </div>
      <div class="mt-2">
        <label class="form-label me-2">Rating</label>
        <div class="star-input" data-value="0" data-role="edit-stars"></div>
      </div>
      <div class="mt-3 d-flex gap-2 justify-content-end">
        <button class="btn btn-outline-danger" data-action="delete-edit">Delete</button>
        <button class="btn btn-outline-dark" data-action="cancel-edit">Cancel</button>
        <button class="btn btn-primary" data-action="save-edit">Save</button>
      </div>
      <div class="alert alert-danger d-none mt-2" role="alert" data-role="edit-alert"></div>
    `;
    card.appendChild(editor);
    textEl.classList.add("d-none");

    // initialize star input
    const starEl = card.querySelector('[data-role="edit-stars"]');
    initStarInput(starEl, val => {
      starEl.dataset.value = String(val);
    });
    // approximate current rating from header
    const currentRating = (headerStars.match(/bi-star-fill/g) || []).length;
    setStarInput(starEl, currentRating);

    // set current text
    card.querySelector('[data-role="editor"]').value = oldText;

    // actions
    card.querySelector('[data-action="cancel-edit"]').onclick = () => {
      card.dataset.mode = "view";
      editor.remove();
      textEl.classList.remove("d-none");
    };

    card.querySelector('[data-action="save-edit"]').onclick = async () => {
      const newText = card.querySelector('[data-role="editor"]').value.trim();
      const newRating = Number(starEl.dataset.value || 0);
      const alertBox = card.querySelector('[data-role="edit-alert"]');
      alertBox.classList.add("d-none");
      try {
        const { review } = await api(`/api/reviews/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: JSON.stringify({ review: newText, rating: newRating })
        });
        // update UI
        textEl.textContent = review.review;
        const containerStars = card.querySelector(".rating-stars");
        containerStars.innerHTML = starsHtml(review.rating);
        card.dataset.mode = "view";
        editor.remove();
        textEl.classList.remove("d-none");
        showAlert("success", "Review updated.");
        // Refresh dealer page so updated review order/rating reflects
        const parts = location.hash.split("/");
        const dealerId = parts[2];
        if (dealerId) {
          // soft refresh to re-paginate and re-fetch rating
          const pos = card.getBoundingClientRect().top;
          renderDealerDetail(dealerId);
          // best-effort scroll restore
          window.scrollTo({ top: window.scrollY + pos - 120, behavior: "instant" });
        }
      } catch (err) {
        if (String(err.message).includes("Unauthorized")) {
          pendingAction = { type: "editReview", reviewId: id, state: { newText, newRating } };
          showLogin();
          accountModal.show();
          return;
        }
        alertBox.textContent = err.message || "Failed to update review";
        alertBox.classList.remove("d-none");
      }
    };

    card.querySelector('[data-action="delete-edit"]').onclick = async () => {
      if (!confirm("Delete this review?")) return;
      const alertBox = card.querySelector('[data-role="edit-alert"]');
      alertBox.classList.add("d-none");
      try {
        await api(`/api/reviews/${encodeURIComponent(id)}`, { method: "DELETE" });
        showAlert("success", "Review deleted.");
        // Re-render dealer detail to refresh list and header rating
        const parts = location.hash.split("/");
        const dealerId = parts[2];
        if (dealerId) {
          renderDealerDetail(dealerId);
        }
      } catch (err) {
        if (String(err.message).includes("Unauthorized")) {
          pendingAction = { type: "editReview", reviewId: id };
          showLogin();
          accountModal.show();
          return;
        }
        alertBox.textContent = err.message || "Failed to delete review";
        alertBox.classList.remove("d-none");
      }
    };
  }

  function initStarInput(container, onChange) {
    if (!container) return;
    container.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "star btn btn-link p-0";
      b.innerHTML = `<i class="bi bi-star"></i>`;
      b.setAttribute("aria-label", `${i} star`);
      b.onclick = () => {
        setStarInput(container, i);
        onChange && onChange(i);
      };
      container.appendChild(b);
    }
    setStarInput(container, Number(container.dataset.value || 0));
  }

  function setStarInput(container, val) {
    const stars = Array.from(container.querySelectorAll(".bi"));
    stars.forEach((icon, idx) => {
      if (idx < val) {
        icon.classList.remove("bi-star");
        icon.classList.add("bi-star-fill", "text-warning");
      } else {
        icon.classList.add("bi-star");
        icon.classList.remove("bi-star-fill", "text-warning");
      }
    });
    container.dataset.value = String(val);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  // Account flows
  function bindAccountFlows() {
    // buttons
    $("#btnShowRegister").onclick = showRegister;
    $("#btnForgot").onclick = showForgot;
    $("#btnBackToLogin1").onclick = showLogin;
    $("#btnBackToLogin2").onclick = showLogin;

    // login submit
    $("#formLogin").addEventListener("submit", async e => {
      e.preventDefault();
      const username = $("#loginUsername").value.trim();
      const password = $("#loginPassword").value;
      const alertBox = $("#accountAlert");
      alertBox.classList.add("d-none");
      try {
        const { user } = await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        me = user;
        setAuthedUI(true, user);
        accountModal.hide();
        showAlert("success", "Signed in.");
        resumePendingIfAny();
      } catch (err) {
        alertBox.className = "alert alert-danger";
        alertBox.textContent = "Invalid Username or Password";
        alertBox.classList.remove("d-none");
      }
    });

    // register submit
    $("#formRegister").addEventListener("submit", async e => {
      e.preventDefault();
      const firstName = $("#regFirst").value.trim();
      const lastName = $("#regLast").value.trim();
      const username = $("#regUser").value.trim();
      const pass1 = $("#regPass").value;
      const pass2 = $("#regPass2").value;
      const mismatch = $("#regMismatch");
      const alertBox = $("#accountAlert");

      mismatch.classList.add("d-none");
      alertBox.classList.add("d-none");

      if (pass1 !== pass2) {
        mismatch.textContent = "passwords do not match";
        mismatch.classList.remove("d-none");
        $("#regPass2").classList.add("is-invalid");
        return;
      }
      $("#regPass2").classList.remove("is-invalid");

      try {
        const { user } = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ firstName, lastName, username, password: pass1 })
        });
        me = user;
        setAuthedUI(true, user);
        accountModal.hide();
        showAlert("success", "Account created.");
        resumePendingIfAny();
      } catch (err) {
        alertBox.className = "alert alert-danger";
        alertBox.textContent = err.message || "Registration failed";
        alertBox.classList.remove("d-none");
      }
    });

    // forgot submit (verify)
    $("#formForgot").addEventListener("submit", async e => {
      e.preventDefault();
      const username = $("#fgUser").value.trim();
      const firstName = $("#fgFirst").value.trim();
      const lastName = $("#fgLast").value.trim();
      const alertBox = $("#accountAlert");
      alertBox.classList.add("d-none");

      try {
        const { verifyToken, resetToken } = await api("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ username, firstName, lastName })
        });
        resetVerifyToken = verifyToken || resetToken;

        // Reveal reset fields and turn the submit button into Reset Password
        $("#resetSection").classList.remove("d-none");
        const submitBtn = $("#btnForgotSubmit");
        submitBtn.textContent = "Reset Password";
        submitBtn.onclick = async () => {
          await doReset();
        };
        // Move button below by appending to reset section
        $("#resetSection").appendChild(submitBtn);
      } catch (err) {
        alertBox.className = "alert alert-danger";
        alertBox.textContent = "Invalid Credentials";
        alertBox.classList.remove("d-none");
      }
    });

    // separate reset handler safeguard
    $("#btnDoReset")?.addEventListener("click", doReset);
  }

  async function doReset() {
    const pass1 = $("#fgPass").value;
    const pass2 = $("#fgPass2").value;
    const mismatch = $("#fgMismatch");
    mismatch.classList.add("d-none");

    if (pass1 !== pass2) {
      mismatch.textContent = "passwords do not match";
      mismatch.classList.remove("d-none");
      $("#fgPass2").classList.add("is-invalid");
      return;
    }
    $("#fgPass2").classList.remove("is-invalid");

    try {
      await api("/api/auth/reset", {
        method: "POST",
        body: JSON.stringify({ verifyToken: resetVerifyToken, password: pass1, confirm: pass2 })
      });
      showAlert("success", "Password reset. Please sign in.");
      showLogin();
    } catch (err) {
      const alertBox = $("#accountAlert");
      alertBox.className = "alert alert-danger";
      alertBox.textContent = "Invalid Credentials";
      alertBox.classList.remove("d-none");
    }
  }

  function resumePendingIfAny() {
    const action = pendingAction;
    pendingAction = null;
    if (!action) return;
    if (action.type === "addReview") {
      location.hash = `#/dealer/${action.dealerId}`;
      setTimeout(() => {
        const modalEl = $("#reviewModal");
        if (modalEl) {
          reviewModal = reviewModal || new bootstrap.Modal(modalEl);
          reviewModal.show();
        }
        if (action.payload) {
          $("#rfText").value = action.payload.review || "";
          setStarInput($("#rfStars"), action.payload.rating || 0);
          $("#rfRating").value = action.payload.rating || 0;
          $("#rfPurchase").checked = !!action.payload.purchase;
          $("#rfDate").value = action.payload.purchase_date || "";
          $("#rfMake").value = action.payload.car_make || "";
          $("#rfModel").value = action.payload.car_model || "";
          $("#rfYear").value = action.payload.car_year || "";
        }
      }, 300);
    } else if (action.type === "editReview") {
      const parts = location.hash.split("/");
      const dealerId = parts[2];
      if (dealerId) {
        renderDealerDetail(dealerId).then(() => {});
      }
    }
  }

  function showLogin() {
    $("#accountTitle").textContent = "Sign in";
    $("#formLogin").classList.remove("d-none");
    $("#formRegister").classList.add("d-none");
    $("#formForgot").classList.add("d-none");
    $("#accountAlert").classList.add("d-none");
  }
  function showRegister() {
    $("#accountTitle").textContent = "Create Account";
    $("#formLogin").classList.add("d-none");
    $("#formRegister").classList.remove("d-none");
    $("#formForgot").classList.add("d-none");
    $("#accountAlert").classList.add("d-none");
  }
  function showForgot() {
    $("#accountTitle").textContent = "Forgot Password";
    $("#formLogin").classList.add("d-none");
    $("#formRegister").classList.add("d-none");
    $("#formForgot").classList.remove("d-none");
    $("#accountAlert").classList.add("d-none");
    $("#resetSection").classList.add("d-none");
    const submitBtn = $("#btnForgotSubmit");
    submitBtn.textContent = "Submit";
  }

  // Begin add review flow, prompt login if needed
  function beginAddReview(dealerId) {
    if (!me) {
      pendingAction = { type: "addReview", dealerId };
      showLogin();
      accountModal.show();
      return;
    }

    const targetHash = `#/dealer/${dealerId}`;

    // If already on the dealer page, show the modal directly
    if (location.hash === targetHash) {
      const modalEl = $("#reviewModal");
      if (modalEl) {
        reviewModal = reviewModal || new bootstrap.Modal(modalEl);
        reviewModal.show();
      }
      return;
    }

    // Navigate to the dealer page, then open the modal when ready
    location.hash = targetHash;
    setTimeout(() => {
      const modalEl = $("#reviewModal");
      if (modalEl) {
        reviewModal = reviewModal || new bootstrap.Modal(modalEl);
        reviewModal.show();
      }
    }, 250);
  }
})();
public/styles.css
/* Dealers Plus – theme + components
   -------------------------------------------------- */

/* ===== CSS Variables ===== */
:root {
  --dp-bg: #f7f8fb;
  --dp-text: #1f2937;
  --dp-muted: #6b7280;
  --dp-surface: #ffffff;
  --dp-border: rgba(15, 23, 42, 0.08);
  --dp-primary: #0d6efd; /* bootstrap primary */
  --dp-primary-600: #0b5ed7;
  --dp-primary-100: #e7f1ff;
  --dp-warning: #f59e0b;

  --dp-glass-bg: rgba(255, 255, 255, 0.7);
  --dp-glass-border: rgba(15, 23, 42, 0.08);
  --dp-glass-blur: 10px;

  --dp-shadow-1: 0 1px 3px rgba(2, 6, 23, 0.06), 0 1px 2px rgba(2, 6, 23, 0.08);
  --dp-shadow-2: 0 12px 20px rgba(2, 6, 23, 0.10), 0 4px 10px rgba(2, 6, 23, 0.08);
}

html[data-theme="dark"] {
  --dp-bg: #0b1220;
  --dp-text: #e5e7eb;
  --dp-muted: #94a3b8;
  --dp-surface: #0f172a;
  --dp-border: rgba(148, 163, 184, 0.12);
  --dp-primary: #66aaff;
  --dp-primary-600: #5496ea;
  --dp-primary-100: #1b2a44;
  --dp-warning: #fbbf24;

  --dp-glass-bg: rgba(15, 23, 42, 0.6);
  --dp-glass-border: rgba(148, 163, 184, 0.14);
  --dp-glass-blur: 12px;
}

/* ===== Base ===== */
html, body {
  background: var(--dp-bg);
  color: var(--dp-text);
}

a {
  color: var(--dp-primary);
  text-decoration: none;
}
a:hover { text-decoration: underline; }

.text-muted { color: var(--dp-muted) !important; }
.text-white-75 { color: rgba(255,255,255,0.75) !important; }
.bg-white-75 { background: rgba(255,255,255,0.75) !important; }

hr {
  border-color: var(--dp-border);
  opacity: 1;
}

/* ===== Brand mark ===== */
.brand-mark {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  display: inline-block;
  background:
    conic-gradient(from 180deg at 70% 30%, var(--dp-primary), #8b5cf6, #06b6d4, var(--dp-primary));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35), var(--dp-shadow-1);
}

/* ===== Glass surfaces ===== */
.glass {
  background: var(--dp-glass-bg);
  border: 1px solid var(--dp-glass-border);
  border-radius: 1rem;
  backdrop-filter: blur(var(--dp-glass-blur));
  -webkit-backdrop-filter: blur(var(--dp-glass-blur));
  box-shadow: var(--dp-shadow-1);
}

/* ===== Navbar (glass) ===== */
.navbar-glass {
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  background: var(--dp-glass-bg);
  border-bottom: 1px solid var(--dp-glass-border);
  box-shadow: var(--dp-shadow-1);
}

.navbar-glass .navbar-brand,
.navbar-glass .nav-link {
  color: var(--dp-text);
}
.navbar-glass .nav-link:hover {
  color: var(--dp-primary);
}

.navbar-toggler {
  border-color: var(--dp-border);
}
.navbar-toggler:focus {
  box-shadow: 0 0 0 .25rem rgba(13,110,253,.25);
}
.navbar-toggler-icon {
  background-image:
    url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 16 16'%3e%3cpath stroke='rgba(100,116,139,1)' stroke-linecap='round' stroke-width='1.5' d='M2 4.5h12M2 8h12M2 11.5h12'/%3e%3c/svg%3e");
}

/* ===== Theme orb (simple glowing circle) ===== */
.theme-orb {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #0b3a8f; /* dark blue when light mode is active */
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.12) inset,
    0 0 10px rgba(13,110,253,0.28);
  transition: background .2s ease, box-shadow .2s ease, transform .05s ease;
}
.theme-orb:active { transform: scale(.98); }

/* Dark mode ON -> white orb with a soft glow */
html[data-theme="dark"] .theme-orb {
  background: #ffffff;
  box-shadow:
    0 0 0 1px rgba(0,0,0,0.18) inset,
    0 0 10px rgba(255,255,255,0.25);
}

/* remove icon glyphs from old design */
.theme-orb::before { content: none; }
html[data-theme="dark"] .theme-orb::before { content: none; }

/* ===== Hero ===== */
.hero-section {
  position: relative;
  padding: clamp(2rem, 5vw, 4rem) 1rem;
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(99,102,241,.55), rgba(99,102,241,.0) 60%),
    radial-gradient(120% 80% at 100% 100%, rgba(14,165,233,.45), rgba(14,165,233,.0) 60%),
    linear-gradient(180deg, #111827, #0b1220);
  border-radius: 1.25rem;
  overflow: hidden;
  box-shadow: var(--dp-shadow-2);
}
html[data-theme="dark"] .hero-section {
  background:
    radial-gradient(120% 80% at 0% 0%, rgba(59,130,246,.45), rgba(59,130,246,.0) 60%),
    radial-gradient(120% 80% at 100% 100%, rgba(139,92,246,.45), rgba(139,92,246,.0) 60%),
    linear-gradient(180deg, #0b1220, #0b1220);
}
.hero-section .lead { margin-bottom: 0; }

/* hero search wrapper tweak */
.search-wrap .input-group > .form-control {
  padding: .9rem 1rem;
}
.search-wrap .input-group > .btn {
  padding: .9rem 1.25rem;
}

/* ===== Search (top bar) ===== */
.search-input {
  border: 1px solid var(--dp-border);
  background: var(--dp-surface);
}
.search-input::placeholder {
  color: var(--dp-muted);
}

/* Suggestions dropdown (shared .dropdown-menu) */
#suggestions.dropdown-menu {
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--dp-border);
  box-shadow: var(--dp-shadow-2);
}
#suggestions .dropdown-item {
  display: flex;
  align-items: center;
  gap: .25rem;
}
#suggestions .badge {
  background: var(--dp-primary-100);
  color: var(--dp-primary-600);
  font-weight: 600;
  text-transform: capitalize;
}

/* ===== Buttons: soft primary ===== */
.btn.btn-primary-soft {
  background: var(--dp-primary-100);
  color: var(--dp-primary-600);
  border: 1px solid transparent;
}
.btn.btn-primary-soft:hover {
  background: rgba(13, 110, 253, 0.12);
  color: var(--dp-primary);
}

/* ===== Badges: soft ===== */
.badge-soft {
  display: inline-block;
  padding: .25rem .5rem;
  border-radius: 999px;
  background: rgba(13, 110, 253, .1);
  color: var(--dp-primary-600);
  font-weight: 600;
  font-size: .75rem;
  border: 1px solid rgba(13,110,253,.12);
}
html[data-theme="dark"] .badge-soft {
  background: rgba(102, 170, 255, .15);
  color: #dbeafe;
  border-color: rgba(102,170,255,.25);
}

/* ===== Tables ===== */
.table {
  --bs-table-striped-bg: transparent;
}
.table thead th {
  font-weight: 600;
  color: var(--dp-muted);
  border-bottom-color: var(--dp-border);
}
.table td, .table th { border-color: var(--dp-border); }
.table .actions .btn { white-space: nowrap; }

/* ===== Dealer detail ===== */
.review-card {
  border: 1px solid var(--dp-border);
  border-radius: .75rem;
  background: var(--dp-surface);
  box-shadow: var(--dp-shadow-1);
}
.review-meta {
  font-size: .8rem;
  color: var(--dp-muted);
}

/* Make the tiny pen feel subtle */
.edit-pen {
  opacity: .8;
}
.edit-pen:hover,
.edit-pen:focus {
  opacity: 1;
  text-decoration: none;
}

/* ===== Star input ===== */
.star-input .star {
  line-height: 1;
}
.star-input .star .bi {
  font-size: 1.25rem;
}
.star-input .star:hover .bi,
.star-input .star:focus .bi {
  transform: translateY(-1px);
}
.star-input .star:focus {
  outline: 2px solid rgba(13,110,253,.4);
  border-radius: .375rem;
}

/* ===== Forms & Modals ===== */
.modal-content.glass {
  background: var(--dp-glass-bg);
  border: 1px solid var(--dp-glass-border);
  backdrop-filter: blur(var(--dp-glass-blur));
  -webkit-backdrop-filter: blur(var(--dp-glass-blur));
}
.form-control,
.form-select {
  background-color: var(--dp-surface);
  color: var(--dp-text);
  border-color: var(--dp-border);
}
.form-control:focus,
.form-select:focus {
  border-color: var(--dp-primary);
  box-shadow: 0 0 0 .2rem rgba(13,110,253,.15);
}

/* ===== Footer ===== */
footer.glass,
footer.bg-white-75.glass {
  background: var(--dp-glass-bg);
}

/* ===== Utilities ===== */
.rounded-4 { border-radius: 1rem !important; }
.shadow-1 { box-shadow: var(--dp-shadow-1); }
.shadow-2 { box-shadow: var(--dp-shadow-2); }

/* Better focus visible */
:focus-visible {
  outline: 2px solid var(--dp-primary);
  outline-offset: 2px;
}

/* Make dropdown buttons look like menu items */
.dropdown-menu .dropdown-item {
  width: 100%;
  text-align: left;
}

/* ===== Small screens ===== */
@media (max-width: 575.98px) {
  .theme-orb { width: 32px; height: 32px; }
  .navbar .dropdown.flex-grow-1 { min-width: 0 !important; }
}

/* ===== Print tweaks ===== */
@media print {
  .navbar, .footer, .btn, .modal { display: none !important; }
  .glass { background: #fff !important; box-shadow: none !important; }
}
