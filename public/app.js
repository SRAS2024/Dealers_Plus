/* Dealers Plus front-end
   Vanilla JS + Bootstrap
   Hash router with views for home, dealers list, dealer detail, about, contact
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
              it => `<button type="button" class="dropdown-item" data-kind="${it.kind}" data-value="${it.value}">
                  <span class="badge rounded-pill me-2">${it.kind}</span>
                  <span>${it.value}</span>
                </button>`
            )
            .join("");
          dd.classList.add("show");
          $$("#suggestions .dropdown-item").forEach(el => {
            el.onclick = () => {
              input.value = el.getAttribute("data-value");
              dd.classList.remove("show");
              goDealersSearch(input.value);
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
  }

  function goDealersSearch(query) {
    const q = String(query || "").trim();
    if (!q) {
      location.hash = "#/dealers";
      return;
    }
    // pass q via hash query
    location.hash = `#/dealers?q=${encodeURIComponent(q)}`;
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
      const q = params.get("q") || "";
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (st) p.set("state", st);
      location.hash = `#/dealers${p.toString() ? "?" + p.toString() : ""}`;
    };

    // initial fetch
    await fetchDealers();

    async function fetchDealers() {
      const query = {};
      if (params.get("state")) query.state = params.get("state");
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

      // set dropdown to current state param after options load
      if (params.get("state")) {
        stateSelect.value = params.get("state");
      }
    }
  }

  async function renderDealerDetail(id) {
    // fetch data
    const { dealer, reviews } = await api(`/api/dealers/${encodeURIComponent(id)}`);

    // inject template
    viewRoot.innerHTML = $("#tpl-dealer-detail").innerHTML;

    // cache modal instance
    reviewModal = new bootstrap.Modal($("#reviewModal"));

    // header
    $("#dealerName").textContent = dealer.name;
    $("#dealerMeta").textContent = `${dealer.city}, ${dealer.state} • ${dealer.brands.join(", ")}`;
    $("#dealerRating").textContent = dealer.rating ? dealer.rating.toFixed(1) : "0.0";
    $("#dealerStars").innerHTML = starsHtml(dealer.rating);

    // render reviews
    renderReviews(reviews);

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
        const resp = await api(`/api/dealers/${encodeURIComponent(id)}/reviews`, {
          method: "POST",
          body: JSON.stringify(payload)
        });
        reviewModal.hide();
        showAlert("success", "Review submitted.");
        $("#dealerRating").textContent = resp.dealer.rating ? resp.dealer.rating.toFixed(1) : "0.0";
        $("#dealerStars").innerHTML = starsHtml(resp.dealer.rating);
        renderReviews(resp.reviews, resp.featured);
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

  function renderReviews(list, featuredId = null) {
    const root = $("#reviewsList");
    if (!root) return;
    root.innerHTML = list
      .map(rv => {
        const canEdit = me && rv.userId === me.id;
        const featured = rv.id === featuredId;
        return `
          <div class="col-12 col-lg-6">
            <div class="p-3 review-card ${featured ? "border-primary" : ""}" data-review="${rv.id}">
              <div class="d-flex justify-content-between align-items-start mb-1">
                <div>
                  <div class="fw-semibold">${rv.userName}</div>
                  <div class="review-meta">${new Date(rv.time).toLocaleString()}</div>
                </div>
                <div class="text-nowrap">
                  <span>${starsHtml(rv.rating)}</span>
                  ${
                    canEdit
                      ? `<button class="btn btn-sm btn-outline-dark ms-2" data-action="edit" data-id="${rv.id}" title="Edit review">
                           <i class="bi bi-pen"></i>
                         </button>`
                      : ""
                  }
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
          </div>
        `;
      })
      .join("");

    $$('button[data-action="edit"]').forEach(btn => {
      btn.onclick = () => startEditReview(btn.getAttribute("data-id"));
    });
  }

  function startEditReview(id) {
    const card = document.querySelector(`.review-card[data-review="${id}"]`);
    if (!card) return;
    const textEl = card.querySelector('[data-role="text"]');
    const oldText = textEl.textContent;
    const headerStars = card.querySelector("span").innerHTML;
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
        const containerStars = card.querySelector(".text-nowrap span");
        containerStars.innerHTML = starsHtml(review.rating);
        card.dataset.mode = "view";
        editor.remove();
        textEl.classList.remove("d-none");
        showAlert("success", "Review updated.");
        // bump card to top by reloading dealer view
        const current = location.hash.split("/");
        const dealerId = current[2];
        renderDealerDetail(dealerId);
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
        // match requested message
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
        const { verifyToken } = await api("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ username, firstName, lastName })
        });
        resetVerifyToken = verifyToken;

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
        // match requested message
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
        body: JSON.stringify({ verifyToken: resetVerifyToken, password: pass1 })
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
      // open dealer page and show modal
      location.hash = `#/dealer/${action.dealerId}`;
      // wait a tick for render then open modal
      setTimeout(() => {
        const btn = $("#btnAddReview");
        if (btn) btn.click();
        // prefill if we had data
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
      }, 250);
    } else if (action.type === "editReview") {
      // best effort: reload current dealer detail
      const parts = location.hash.split("/");
      const dealerId = parts[2];
      if (dealerId) {
        renderDealerDetail(dealerId).then(() => {
          // not trivial to auto open editor for a review without knowing which dealer owns it
        });
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
    // navigate to dealer page and open modal
    location.hash = `#/dealer/${dealerId}`;
    setTimeout(() => {
      const btn = $("#btnAddReview");
      btn && btn.click();
    }, 200);
  }
})();
