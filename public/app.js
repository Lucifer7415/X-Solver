const state = { user: null, route: "overview", dashboard: null, donations: [], deliveries: [], partners: [], recipients: [], analytics: { totals: { donatedKg: 0, rescuedKg: 0, meals: 0, deliveryCount: 0 }, statusCounts: {}, byCategory: {} }, predictions: [], filter: "all", search: "" };
const roleLabels = { admin: "Administrator", donor: "Restaurant / hostel", recipient: "Food bank / NGO", driver: "Delivery partner", volunteer: "Volunteer" };
const routeTitles = { overview: "Overview", donations: "Donations", deliveries: "Deliveries", partners: "Partners", predictions: "Surplus forecast", analytics: "Impact & analytics", audit: "Activity log", demand: "Recipient demand", profile: "Your profile" };
const routeRoles = {
  overview: ["admin", "donor", "recipient", "driver", "volunteer"],
  donations: ["admin", "donor", "recipient"],
  deliveries: ["admin", "recipient", "driver", "volunteer", "donor"],
  partners: ["admin"],
  predictions: ["admin", "donor"],
  analytics: ["admin", "donor", "recipient"],
  audit: ["admin"],
  demand: ["recipient"],
  profile: ["admin", "donor", "recipient", "driver", "volunteer"]
};
const labels = {
  available: "Available", partially_allocated: "Partially allocated", matched: "Matched", assigned: "Assigned",
  picked_up: "Picked up", in_transit: "In transit", delivered: "Delivered", verified: "Verified",
  issue: "Needs attention", cancelled: "Cancelled", open: "Open", closed: "Closed"
};
let toastTimer;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const kg = value => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value || 0)} kg`;
const dateTime = value => value ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
const timeAgo = value => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} days ago`;
};
const initials = name => String(name || "M").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase();

async function api(url, options = {}) {
  const request = { ...options, headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers } };
  if (request.body && typeof request.body !== "string") request.body = JSON.stringify(request.body);
  const response = await fetch(url, request);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status}).`);
  return result;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 3500);
}

function setAuthMode(mode) {
  $("#login-form").closest(".auth-card").classList.toggle("hidden", mode !== "login");
  $("#register-form").classList.toggle("hidden", mode !== "register");
}

function showApp(user) {
  state.user = user;
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  const name = user.name || user.organization || "MealBridge partner";
  $("#sidebar-name").textContent = name;
  $("#sidebar-role").textContent = roleLabels[user.role] || "Partner";
  $("#sidebar-avatar").textContent = initials(name);
  $("#top-avatar").textContent = initials(name);
  $("#top-name").textContent = name.split(" ")[0];
  $$("#main-nav [data-nav]").forEach(button => {
    button.classList.toggle("hidden", !(routeRoles[button.dataset.nav] || []).includes(user.role));
  });
  $("#donation-count").textContent = "0";
  const allowedDefault = ["admin", "donor", "recipient", "driver", "volunteer"].includes(user.role) ? "overview" : "profile";
  navigate(allowedDefault);
  refresh().catch(error => toast(error.message, true));
}

function showAuth() {
  state.user = null;
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  setAuthMode("login");
}

async function refresh() {
  if (!state.user) return;
  const [dashboard, donations, deliveries] = await Promise.all([
    api("/api/dashboard"), api("/api/donations"), api("/api/deliveries")
  ]);
  state.dashboard = dashboard;
  state.donations = donations.donations;
  state.deliveries = deliveries.deliveries;
  $("#donation-count").textContent = String(state.donations.filter(item => item.remainingKg > 0).length);
  $("#notification-dot").classList.toggle("hidden", !dashboard.notifications.some(item => !item.read));
  if (state.dashboard) render();
}

function navigate(route) {
  if (!routeRoles[route]?.includes(state.user?.role)) route = "overview";
  state.route = route;
  $("#page-title").textContent = routeTitles[route] || "Overview";
  $$("#main-nav [data-nav]").forEach(button => button.classList.toggle("active", button.dataset.nav === route));
  $("#sidebar").classList.remove("open");
  render();
}

function pageHeading(title, subtitle, actions = "") {
  return `<div class="page-heading"><div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function statCard(label, value, note, icon) {
  return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${esc(label)}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}</div><div class="stat-foot">${note}</div></article>`;
}

function statusBadge(status, expiry) {
  const expired = expiry && Date.parse(expiry) <= Date.now();
  const expiring = !expired && expiry && Date.parse(expiry) - Date.now() < 3 * 60 * 60 * 1000;
  const value = expired ? "cancelled" : expiring ? "expiring" : status;
  return `<span class="status status-${esc(value)}">${expired ? "Expired · do not allocate" : expiring ? "Expiring soon" : esc(labels[status] || status)}</span>`;
}

function donationRow(item) {
  const action = item.remainingKg > 0 && ["admin", "donor"].includes(state.user.role)
    ? `<button class="row-action" data-action="match" data-id="${esc(item.id)}">Find a match</button>`
    : `<button class="row-action" data-action="view-donation" data-id="${esc(item.id)}">Details</button>`;
  const icon = item.category === "Fresh produce" ? "🍊" : item.category === "Bakery" ? "🥖" : "🍲";
  return `<tr><td><span class="item-cell"><span class="food-emoji">${icon}</span><span>${esc(item.title)}<br><span class="muted small">${esc(item.id)}</span></span></span></td><td>${esc(item.donor)}</td><td>${kg(item.quantityKg)}</td><td>${kg(item.remainingKg)}</td><td>${dateTime(item.expiresAt)}</td><td>${statusBadge(item.status, item.expiresAt)}</td><td>${action}</td></tr>`;
}

function deliveryRow(item) {
  let action = `<button class="row-action" data-action="delivery-detail" data-id="${esc(item.id)}">Details</button>`;
  const nextStatus = { assigned: "picked_up", picked_up: "in_transit", in_transit: "delivered", delivered: "verified" }[item.status];
  const allowed = state.user.role === "admin" || (state.user.role === "driver" && item.driverId === state.user.id) || (state.user.role === "recipient" && item.recipientUserId === state.user.id && item.status === "delivered");
  if (nextStatus && allowed) action = `<button class="row-action" data-action="advance-delivery" data-id="${esc(item.id)}" data-status="${nextStatus}">${nextStatus === "verified" ? "Confirm receipt" : `Mark ${labels[nextStatus].toLowerCase()}`}</button>`;
  if (["assigned", "picked_up", "in_transit"].includes(item.status) && (state.user.role === "admin" || (state.user.role === "driver" && item.driverId === state.user.id))) action += ` <button class="row-action" data-action="report-issue" data-id="${esc(item.id)}">Report issue</button>`;
  if (["issue", "cancelled"].includes(item.status) && state.user.role === "admin") action = `<button class="row-action" data-action="reassign" data-id="${esc(item.id)}">Reassign</button>`;
  return `<tr><td><span class="item-cell"><span class="food-emoji">🚚</span><span>${esc(item.donation)}<br><span class="muted small">${esc(item.id)}</span></span></span></td><td>${esc(item.recipient)}</td><td>${esc(item.driver)}</td><td>${kg(item.quantityKg)}</td><td>${Math.round(item.etaMinutes || 0)} min</td><td>${statusBadge(item.status)}</td><td>${action}</td></tr>`;
}

function tableCard(headers, rows, emptyText) {
  return `<div class="table-card"><div class="table-wrap"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}"><div class="empty-state"><b>Nothing here just yet</b>${esc(emptyText)}</div></td></tr>`}</tbody></table></div></div>`;
}

function activityList(activities) {
  if (!activities.length) return `<div class="empty-state">No recent activity to show.</div>`;
  const symbols = { delivery: "↗", donation: "♧", match: "✓", verification: "◎", reassignment: "⟳" };
  return `<div class="activity-list">${activities.map(item => `<div class="activity-item"><span class="activity-dot">${symbols[item.type] || "•"}</span><div class="activity-copy"><p>${esc(item.message)}</p><span>${esc(item.actor)} · ${timeAgo(item.at)}</span></div></div>`).join("")}</div>`;
}

function mapPanel() {
  return `<div class="map-panel" role="img" aria-label="Illustrative demo map showing donor, recipient and courier locations"><div class="map-roads"></div><span class="map-pin donor-pin" title="Donor"><span>F</span></span><span class="map-pin recipient-pin" title="Recipient"><span>H</span></span><span class="map-pin driver-pin" title="Driver"><span>•</span></span></div><div class="map-caption"><span>Delhi NCR · illustrative demo</span><span class="map-legend"><span class="legend"><i></i>Donor</span><span class="legend"><i></i>Recipient</span><span class="legend"><i></i>Courier</span></span></div>`;
}

function renderOverview() {
  const data = state.dashboard;
  const summary = data.summary;
  const role = state.user.role;
  const subtitle = role === "donor" ? "Here’s how your food is making a difference." :
    role === "driver" ? "Your delivery work is helping good food find its way." :
      role === "recipient" ? "Track incoming food and the impact across your community." :
        "A little good goes a long way. Here’s what’s happening today.";
  const action = ["admin", "donor"].includes(role) ? `<button class="button button-primary" data-action="new-donation">＋ Share surplus food</button>` : "";
  const deliveryRows = data.deliveries.map(deliveryRow).join("");
  return `${pageHeading("Good morning, " + (state.user.name || "").split(" ")[0] + " 👋", subtitle, `${role === "admin" ? `<span class="date-pill">◷ &nbsp;${new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</span>` : ""}${action}`)}
    <div class="stats-grid">
      ${statCard("Meals rescued", summary.mealsSaved.toLocaleString(), `<span class="trend-up">↑ 12.8%</span> &nbsp;vs last month`, "♧")}
      ${statCard("Food rescued", kg(summary.rescuedKg), `${kg(summary.donatedKg)} donated in total`, "♧")}
      ${statCard("Active donations", summary.activeDonations, `${state.donations.filter(item => Date.parse(item.expiresAt) - Date.now() < 3 * 60 * 60 * 1000 && Date.parse(item.expiresAt) > Date.now()).length} nearing expiry`, "◷")}
      ${statCard("On the move", summary.activeDeliveries, `<span class="trend-up">Current workflow</span> &nbsp;status`, "↗")}
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>Latest donations</h2><p>Food ready to find a new home</p></div><button class="text-link" data-nav="donations">View all →</button></div><div class="table-wrap"><table><thead><tr><th>FOOD ITEM</th><th>DONOR</th><th>QUANTITY</th><th>LEFT TO MATCH</th><th>USE BY</th><th>STATUS</th><th></th></tr></thead><tbody>${data.donations.slice(0, 4).map(donationRow).join("")}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Rescue network</h2><p>Partner locations · demo simulation</p></div><span class="status status-available">● Active</span></div><div class="side-panel-body">${mapPanel()}</div></section>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>Delivery pulse</h2><p>Recent handoffs and partner updates</p></div><button class="text-link" data-nav="deliveries">All deliveries →</button></div><div class="table-wrap"><table><thead><tr><th>DELIVERY</th><th>RECIPIENT</th><th>COURIER</th><th>QTY</th><th>ETA</th><th>STATUS</th><th></th></tr></thead><tbody>${deliveryRows || `<tr><td colspan="7"><div class="empty-state">No active deliveries right now.</div></td></tr>`}</tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Activity stream</h2><p>Good things, as they happen</p></div><button class="text-link" data-nav="${role === "admin" ? "audit" : "deliveries"}">View log →</button></div><div class="side-panel-body">${activityList(data.activities)}</div></section>
    </div>
    <div class="notice-banner"><span class="info-icon">i</span><span><b>Demo mode:</b> the map is illustrative, locations are sample coordinates, and delivery ETAs are estimates—not live GPS or traffic data.</span></div>`;
}

function renderDonations() {
  const canPost = ["admin", "donor"].includes(state.user.role);
  const search = state.search.toLowerCase();
  const items = state.donations.filter(item => {
    const matchesText = !search || `${item.title} ${item.donor} ${item.id}`.toLowerCase().includes(search);
    const matchesFilter = state.filter === "all" || (state.filter === "available" ? item.remainingKg > 0 : item.status === state.filter);
    const visibleToRecipient = state.user.role !== "recipient" || ["available", "partially_allocated"].includes(item.status);
    return matchesText && matchesFilter && visibleToRecipient;
  });
  const rows = items.map(donationRow).join("");
  return `${pageHeading("Donations", "Every donation is a chance to turn surplus into something meaningful.", canPost ? `<button class="button button-primary" data-action="new-donation">＋ Share surplus food</button>` : "")}
    <div class="filters"><input class="search-input" id="search-filter" value="${esc(state.search)}" placeholder="Search food, donor or ID…" aria-label="Search donations"><select class="filter-select" id="status-filter" aria-label="Filter by status"><option value="all">All donations</option><option value="available">Available to match</option><option value="assigned">Assigned</option><option value="verified">Verified</option></select><span class="muted small">${items.length} donations</span></div>
    <div class="notice-banner"><span class="info-icon">i</span><span>Expiry timestamps and food safety details come from donors. A successful delivery does not replace manual food-safety verification.</span></div>
    ${tableCard(["FOOD ITEM", "DONOR", "QUANTITY", "LEFT TO MATCH", "USE BY", "STATUS", ""], rows, "New donations will appear here.")}`;
}

function renderDeliveries() {
  const search = state.search.toLowerCase();
  const items = state.deliveries.filter(item => !search || `${item.donation} ${item.recipient} ${item.driver} ${item.id}`.toLowerCase().includes(search));
  return `${pageHeading("Delivery management", "Follow each handoff from pickup through recipient confirmation.", `<span class="date-pill">◉ &nbsp;${items.length} deliveries</span>`)}
    <div class="notice-banner"><span class="info-icon">i</span><span>Delivery status is updated by authorized partners. Only the recipient or administrator can verify receipt; an on-time ETA does not prove food safety.</span></div>
    <div class="filters"><input class="search-input" id="search-filter" value="${esc(state.search)}" placeholder="Search delivery, recipient or courier…" aria-label="Search deliveries"><select class="filter-select" id="status-filter" aria-label="Filter by status"><option value="all">All statuses</option>${["assigned", "picked_up", "in_transit", "delivered", "verified", "issue", "cancelled"].map(item => `<option value="${item}">${labels[item]}</option>`).join("")}</select></div>
    ${tableCard(["DELIVERY", "RECIPIENT", "COURIER", "QTY", "ETA", "STATUS", "NEXT ACTION"], items.filter(item => state.filter === "all" || item.status === state.filter).map(deliveryRow).join(""), "Assigned deliveries will show here.")}
    <div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Delivery route</h2><p>Illustrative, not live navigation</p></div></div><div class="side-panel-body">${mapPanel()}</div></section><section class="panel"><div class="panel-head"><div><h2>Status workflow</h2><p>Every handoff has a traceable checkpoint</p></div></div><div class="event-row">${["Donation created", "Recipient matched", "Driver assigned", "Pickup confirmed", "In transit", "Delivered", "Verified"].map(item => `<span class="tag">${item}</span>`).join("")}</div><div class="notice-banner" style="margin:0 14px 14px"><span class="info-icon">i</span><span>Route distance and travel time use demo coordinates and a simple estimate. No live map or traffic provider is connected.</span></div></section></div>`;
}

function renderPartners() {
  return `${pageHeading("Partner network", "Verified organizations and delivery partners working together.", `<span class="date-pill">♧ &nbsp;${state.partners.length} partners</span>`)}
    <div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Organizations</h2><p>Donors and food recipients</p></div></div>${state.partners.filter(item => ["donor", "recipient"].includes(item.role)).map(partnerCard).join("")}</section><section class="panel"><div class="panel-head"><div><h2>Delivery partners</h2><p>Couriers and transport</p></div></div>${state.partners.filter(item => item.role === "driver").map(partnerCard).join("")}</section></div>
    <section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>Recipient capacity & demand</h2><p>Only verified, open partners are considered for automatic matching.</p></div></div>${state.partners.filter(item => item.role === "recipient").map(item => {
      const rec = state.recipients?.find(org => org.userId === item.id);
      return `<div class="partner-card"><span class="partner-avatar">${initials(item.organization)}</span><div class="partner-info"><b>${esc(item.organization)}</b><span>${rec ? `${kg(rec.demandKg)} requested · ${kg(rec.capacityKg)} capacity · ${rec.open ? "Open" : "Closed"}` : "Recipient settings pending"}</span></div>${item.verified ? `<span class="status status-verified">Verified</span>` : `<button class="button button-secondary button-quiet" data-action="verify-partner" data-id="${esc(item.id)}">Verify</button>`}</div>`;
    }).join("") || `<div class="empty-state">No recipient partners yet.</div>`}</section>`;
}

function partnerCard(item) {
  const verify = item.verified ? `<span class="status status-verified">Verified</span>` : `<button class="button button-secondary button-quiet" data-action="verify-partner" data-id="${esc(item.id)}">Verify</button>`;
  return `<div class="partner-card"><span class="partner-avatar">${initials(item.organization || item.name)}</span><div class="partner-info"><b>${esc(item.organization || item.name)}</b><span>${esc(roleLabels[item.role] || item.role)} · ${esc(item.email)}</span></div>${verify}</div>`;
}

function renderPredictions() {
  const predictions = state.predictions;
  return `${pageHeading("Surplus forecast", "A transparent baseline helps partners plan ahead. These are estimates, not promises.", `<span class="status status-issue">BETA · DEMO MODEL</span>`)}
    <div class="notice-banner"><span class="info-icon">i</span><span><b>Rule-based demo estimate:</b> uses recent sample donation quantity and time of day. Confidence is shown plainly; it is not a trained or validated AI model. Forecasts should not be used as food-safety or operational guarantees.</span></div>
    <div class="prediction-grid">${predictions.map(item => `<article class="prediction-card"><h3>${esc(item.donor)}</h3><p>Potential surplus over the next service window</p><div class="forecast-number">${kg(item.quantityKg)}</div><span class="confidence">${esc(item.confidence)} confidence · sample data</span><p>${esc(item.basis)}</p><p style="margin-top:10px">Estimated available: <b>${dateTime(item.availableAt)}</b></p></article>`).join("")}</div>
    <section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>Forecast inputs</h2><p>Current baseline and suggested model improvements</p></div></div><div class="event-row"><span class="tag">Recent donations</span><span class="tag">Time of day</span><span class="tag">Demo confidence label</span><span class="tag">Historical demand · future</span><span class="tag">Meal schedule · future</span><span class="tag">Events & inventory · future</span></div></section>`;
}

function renderAnalytics() {
  const totals = state.analytics.totals;
  const max = Math.max(1, ...Object.values(state.analytics.byCategory));
  const chart = Object.entries(state.analytics.byCategory).map(([name, value]) => `<div class="chart-column" title="${esc(name)}: ${kg(value)}"><div class="chart-value" style="height:${Math.max(4, value / max * 145)}px"></div><span>${esc(name.split(" ")[0])}</span></div>`).join("");
  return `${pageHeading("Impact & analytics", "A living picture of food rescued and community impact.", `<span class="date-pill">◷ &nbsp;All-time demo data</span>`)}
    <div class="stats-grid">${statCard("Food donated", kg(totals.donatedKg), "Since the start of this demo", "♧")}${statCard("Food delivered", kg(totals.rescuedKg), "Confirmed delivered or verified", "↗")}${statCard("Meals supported", totals.meals.toLocaleString(), "Estimated at 2.4 meals per kg", "♡")}${statCard("Delivery journeys", totals.deliveryCount, "Includes active and completed", "⌁")}</div>
    <div class="split-grid"><section class="panel"><div class="panel-head"><div><h2>Donations by food category</h2><p>Sample quantity at a glance</p></div></div><div class="chart-area">${chart || `<div class="empty-state">No donation data available yet.</div>`}</div><div class="chart-legend"><i></i> Total donated kilograms</div></section>
    <section class="panel"><div class="panel-head"><div><h2>Delivery outcomes</h2><p>Current status count · demo data</p></div></div><div class="side-panel-body">${Object.entries(state.analytics.statusCounts).filter(([, count]) => count).map(([status, count]) => `<div class="profile-field"><span>${esc(labels[status] || status)}</span><b>${count} delivery${count === 1 ? "" : "ies"}</b></div>`).join("") || `<div class="empty-state">No delivery activity yet.</div>`}</div></section></div>
    <div class="notice-banner"><span class="info-icon">i</span><span>Meal counts are estimates, not audited beneficiary totals. Analytics currently aggregate local demo records and are not an impact claim.</span></div>`;
}

function renderAudit() {
  return `${pageHeading("Activity log", "A traceable record of notable donation, delivery and verification updates.", `<span class="date-pill">☷ &nbsp;Latest ${state.dashboard.activities.length} events</span>`)}
    <section class="panel"><div class="panel-head"><div><h2>Recent activity</h2><p>Demo data is stored locally in the project data file</p></div></div><div class="side-panel-body">${activityList(state.dashboard.activities)}</div></section>`;
}

function renderDemand() {
  return `${pageHeading("Recipient demand", "Tell the network what your organization can receive and when you’re open.", `<button class="button button-primary" data-action="edit-demand">Update demand</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>Your organization’s current request</h2><p>Verified recipients with open capacity can be considered for donation matching.</p></div></div><div id="demand-summary" class="side-panel-body"><div class="empty-state">Loading your demand…</div></div></section>
    <div class="notice-banner"><span class="info-icon">i</span><span>Keep demand and availability current. Matching is a demo baseline and does not replace partner confirmation, food-safety checks, or route planning.</span></div>`;
}

function renderProfile() {
  const user = state.user;
  return `${pageHeading("Your profile", "Keep your partner information up to date.", `<button class="button button-secondary" data-action="edit-profile">Edit profile</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>Account details</h2><p>Visible only to authorized MealBridge partners</p></div></div><div class="side-panel-body"><div class="profile-grid">
    <div class="profile-field"><span>Full name</span><b>${esc(user.name)}</b></div><div class="profile-field"><span>Email</span><b>${esc(user.email)}</b></div>
    <div class="profile-field"><span>Organization</span><b>${esc(user.organization)}</b></div><div class="profile-field"><span>Partner role</span><b>${esc(roleLabels[user.role])}</b></div>
    <div class="profile-field"><span>Organization verification</span><b>${user.verified ? "Verified partner" : "Awaiting verification"}</b></div><div class="profile-field"><span>Account created</span><b>${dateTime(user.createdAt)}</b></div>
    </div><button class="button button-secondary button-quiet" style="margin-top:14px" data-action="logout">Sign out</button></div></section>
    ${user.role === "driver" ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>Vehicle & availability</h2><p>Keep capacity and pickup location current for feasible assignments.</p></div></div><div class="side-panel-body" id="driver-settings"><div class="empty-state">Loading vehicle settings…</div></div></section>` : ""}`;
}

function render() {
  if (!state.user || !state.dashboard) return;
  const views = {
    overview: renderOverview, donations: renderDonations, deliveries: renderDeliveries,
    partners: renderPartners, predictions: renderPredictions, analytics: renderAnalytics,
    audit: renderAudit, demand: renderDemand, profile: renderProfile
  };
  $("#content").innerHTML = (views[state.route] || renderOverview)();
  if (state.route === "donations") $("#status-filter").value = state.filter;
  if (state.route === "deliveries") $("#status-filter").value = state.filter;
  if (state.route === "demand") loadDemand();
  if (state.route === "profile" && state.user.role === "driver") loadDriverProfile();
}

async function loadRouteData(route) {
  if (route === "partners") {
    const result = await Promise.all([api("/api/partners"), api("/api/recipients")]);
    state.partners = result[0].partners;
    state.recipients = result[1].recipients;
  } else if (route === "predictions") {
    state.predictions = (await api("/api/predictions")).predictions;
  } else if (route === "analytics") {
    state.analytics = await api("/api/analytics");
  }
}

function navigateWithData(route) {
  if (state.route !== route) {
    state.filter = "all";
    state.search = "";
  }
  const pending = loadRouteData(route);
  navigate(route);
  pending.then(() => render()).catch(error => toast(error.message, true));
}

async function loadDemand() {
  try {
    const { recipients } = await api("/api/recipients");
    const recipient = recipients.find(item => item.userId === state.user.id);
    const box = $("#demand-summary");
    if (!box) return;
    box.innerHTML = recipient ? `<div class="profile-grid"><div class="profile-field"><span>Requested quantity</span><b>${kg(recipient.demandKg)}</b></div><div class="profile-field"><span>Availability</span><b>${recipient.open ? "Open to matches" : "Temporarily closed"}</b></div><div class="profile-field"><span>Storage capacity</span><b>${kg(recipient.capacityKg)}</b></div><div class="profile-field"><span>Organization check</span><b>${recipient.verified ? "Verified" : "Awaiting verification"}</b></div><div class="profile-field"><span>Dietary needs</span><b>${esc(recipient.dietary.join(", ") || "No restrictions listed")}</b></div></div>` : `<div class="empty-state">No recipient profile is connected to this account.</div>`;
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadDriverProfile() {
  try {
    const { driver } = await api("/api/driver-profile");
    const box = $("#driver-settings");
    if (!box) return;
    box.innerHTML = `<form class="form-stack" id="driver-profile-form"><div class="form-row"><label>Vehicle type<input name="vehicle" value="${esc(driver.vehicle)}" required maxlength="80"></label><label>Capacity (kg)<input name="capacityKg" type="number" min="1" max="1000" value="${driver.capacityKg}" required></label></div><div class="form-row"><label>Current latitude<input name="lat" type="number" step="0.0001" value="${driver.location.lat}" required></label><label>Current longitude<input name="lng" type="number" step="0.0001" value="${driver.location.lng}" required></label></div><label class="inline-check"><span>Available for a delivery</span><input name="available" type="checkbox" ${driver.available ? "checked" : ""} ${driver.verified ? "" : "disabled"}></label>${driver.verified ? "" : `<p class="field-help">Your organization needs administrator verification before you can be available.</p>`}<button class="button button-primary" type="submit">Save vehicle settings</button></form>`;
    $("#driver-profile-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api("/api/driver-profile", { method: "PUT", body: { vehicle: form.get("vehicle"), capacityKg: Number(form.get("capacityKg")), lat: Number(form.get("lat")), lng: Number(form.get("lng")), available: form.get("available") === "on" } });
        toast("Vehicle settings updated.");
        await refresh();
        await loadDriverProfile();
      } catch (error) { toast(error.message, true); }
    });
  } catch (error) {
    toast(error.message, true);
  }
}

function openModal(html) {
  $("#modal-content").innerHTML = html;
  $("#modal-layer").classList.remove("hidden");
  $("#modal-close").focus();
}

function closeModal() {
  $("#modal-layer").classList.add("hidden");
}

function showDonationModal() {
  const template = $("#donation-modal-template").content.cloneNode(true);
  const wrapper = document.createElement("div");
  wrapper.append(template);
  openModal(wrapper.innerHTML);
  const minimum = new Date(Date.now() + 60 * 60 * 1000);
  const localISO = new Date(minimum.getTime() - minimum.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("#donation-form [name=expiresAt]").value = localISO;
  $("#donation-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: form.get("title"), category: form.get("category"), quantityKg: Number(form.get("quantityKg")),
      expiresAt: new Date(form.get("expiresAt")).toISOString(), dietary: form.getAll("dietary"), storage: form.get("storage") || "Not specified",
      lat: Number(form.get("lat")), lng: Number(form.get("lng"))
    };
    try {
      await api("/api/donations", { method: "POST", body: payload });
      closeModal();
      toast("Donation posted. Partners can now be matched.");
      await refresh();
    } catch (error) { toast(error.message, true); }
  });
}

function openDonationDetail(id) {
  const item = state.donations.find(donation => donation.id === id);
  if (!item) return;
  openModal(`<span class="eyebrow green">DONATION ${esc(item.id)}</span><h2 id="modal-title">${esc(item.title)}</h2><p class="muted">Shared by ${esc(item.donor)} · ${esc(item.category)}</p><div class="profile-grid"><div class="profile-field"><span>Quantity posted</span><b>${kg(item.quantityKg)}</b></div><div class="profile-field"><span>Available to allocate</span><b>${kg(item.remainingKg)}</b></div><div class="profile-field"><span>Use by</span><b>${dateTime(item.expiresAt)}</b></div><div class="profile-field"><span>Dietary information</span><b>${esc(item.dietary.join(", ") || "Not specified")}</b></div></div><div class="notice-banner"><span class="info-icon">i</span><span>Manual safety checks and recipient confirmation are required. No storage temperature or food-safety evidence is recorded in this demo.</span></div>${["admin", "donor"].includes(state.user.role) && item.remainingKg > 0 ? `<button class="button button-primary button-wide" data-action="match" data-id="${esc(item.id)}">Find a feasible match</button>` : ""}`);
}

function openDeliveryDetail(id) {
  const item = state.deliveries.find(delivery => delivery.id === id);
  if (!item) return;
  const history = item.reason || "No match explanation was stored.";
  openModal(`<span class="eyebrow green">TRACEABLE DELIVERY ${esc(item.id)}</span><h2 id="modal-title">${esc(item.donation)}</h2><p class="muted">${kg(item.quantityKg)} · ${esc(labels[item.status] || item.status)}</p><div class="profile-grid"><div class="profile-field"><span>Recipient</span><b>${esc(item.recipient)}</b></div><div class="profile-field"><span>Courier</span><b>${esc(item.driver)}</b></div><div class="profile-field"><span>Estimated distance</span><b>${Number(item.distanceKm).toFixed(1)} km · demo estimate</b></div><div class="profile-field"><span>Estimated arrival</span><b>${Math.round(item.etaMinutes)} min · no live GPS</b></div><div class="profile-field"><span>Created</span><b>${dateTime(item.createdAt)}</b></div><div class="profile-field"><span>Recipient confirmation</span><b>${item.verifiedAt ? dateTime(item.verifiedAt) : "Not yet confirmed"}</b></div></div><div class="notice-banner"><span class="info-icon">i</span><span>${esc(history)} This feasibility explanation is a demo estimate and is not route-provider data.</span></div>`);
}

async function matchDonation(id) {
  try {
    const result = await api(`/api/donations/${encodeURIComponent(id)}/match`, { method: "POST", body: {} });
    const item = result.delivery;
    closeModal();
    toast(`${kg(item.quantityKg)} matched to ${item.recipient}; delivery assigned to ${item.driver}.`);
    await refresh();
    if (state.route === "deliveries") navigateWithData("deliveries");
  } catch (error) { toast(error.message, true); }
}

async function updateDelivery(id, status) {
  try {
    await api(`/api/deliveries/${encodeURIComponent(id)}/status`, { method: "POST", body: { status } });
    toast(`Delivery marked ${labels[status].toLowerCase()}.`);
    await refresh();
  } catch (error) { toast(error.message, true); }
}

async function reportDeliveryIssue(id) {
  const message = window.prompt("Briefly describe the delivery issue so the administrator can arrange a safe next step.");
  if (!message?.trim()) return;
  try {
    await api(`/api/deliveries/${encodeURIComponent(id)}/status`, { method: "POST", body: { status: "issue", note: message.trim().slice(0, 240) } });
    toast("Issue recorded. The delivery needs attention.");
    await refresh();
  } catch (error) { toast(error.message, true); }
}

async function reassignDelivery(id) {
  try {
    await api(`/api/deliveries/${encodeURIComponent(id)}/reassign`, { method: "POST", body: {} });
    toast("Delivery reassigned to the nearest available partner.");
    await refresh();
  } catch (error) { toast(error.message, true); }
}

async function verifyPartner(id) {
  try {
    await api(`/api/partners/${encodeURIComponent(id)}/verify`, { method: "POST", body: { verified: true } });
    toast("Partner verification recorded.");
    await loadRouteData("partners");
    render();
  } catch (error) { toast(error.message, true); }
}

function showNotifications() {
  const notifications = state.dashboard.notifications;
  openModal(`<span class="eyebrow green">YOUR UPDATES</span><h2 id="modal-title">Notifications</h2><p class="muted">Important moments from your MealBridge network.</p>${notifications.length ? `<div class="activity-list">${notifications.map(item => `<div class="activity-item"><span class="activity-dot">${item.read ? "✓" : "•"}</span><div class="activity-copy"><p><b>${esc(item.title)}</b><br>${esc(item.message)}</p><span>${timeAgo(item.at)}</span></div></div>`).join("")}</div>` : `<div class="empty-state">You’re all caught up.</div>`}<button class="button button-secondary button-wide" id="mark-read">Mark all as read</button>`);
  $("#mark-read").addEventListener("click", async () => {
    try {
      await api("/api/notifications/read", { method: "POST", body: {} });
      closeModal();
      await refresh();
    } catch (error) { toast(error.message, true); }
  });
}

function editProfile() {
  const user = state.user;
  openModal(`<span class="eyebrow green">ACCOUNT SETTINGS</span><h2 id="modal-title">Edit your profile</h2><p class="muted">Keep your partner contact information current.</p><form class="form-stack" id="profile-form"><label>Full name<input name="name" value="${esc(user.name)}" required maxlength="80"></label><label>Organization<input name="organization" value="${esc(user.organization)}" required maxlength="100"></label><button class="button button-primary button-wide" type="submit">Save changes</button></form>`);
  $("#profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/profile", { method: "PUT", body: { name: form.get("name"), organization: form.get("organization") } });
      closeModal();
      showApp(result.user);
      toast("Profile updated.");
    } catch (error) { toast(error.message, true); }
  });
}

function editDemand() {
  api("/api/recipients").then(({ recipients }) => {
    const recipient = recipients.find(item => item.userId === state.user.id);
    if (!recipient) return toast("There is no recipient profile for this account.", true);
    openModal(`<span class="eyebrow green">RECIPIENT REQUEST</span><h2 id="modal-title">Update your food demand</h2><p class="muted">Only verified, open recipient requests are considered during matching.</p><form class="form-stack" id="demand-form"><label>Quantity requested (kg)<input name="demandKg" type="number" min="0" max="2000" step="1" value="${recipient.demandKg}" required></label><label>Storage capacity (kg)<input name="capacityKg" type="number" min="1" max="5000" value="${recipient.capacityKg}" required></label><div class="form-row"><label>Organization latitude<input name="lat" type="number" step="0.0001" value="${recipient.location.lat}" required></label><label>Organization longitude<input name="lng" type="number" step="0.0001" value="${recipient.location.lng}" required></label></div><label class="inline-check"><span>Accepting food matches</span><input name="open" type="checkbox" ${recipient.open ? "checked" : ""}></label><fieldset class="dietary-field"><legend>Dietary needs</legend>${["vegetarian", "vegan", "halal", "gluten-free"].map(item => `<label><input type="checkbox" name="dietary" value="${item}" ${recipient.dietary.includes(item) ? "checked" : ""}> ${item}</label>`).join("")}</fieldset><button class="button button-primary button-wide" type="submit">Save request</button></form>`);
    $("#demand-form").addEventListener("submit", async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api("/api/demand", { method: "PUT", body: { demandKg: Number(form.get("demandKg")), capacityKg: Number(form.get("capacityKg")), lat: Number(form.get("lat")), lng: Number(form.get("lng")), open: form.get("open") === "on", dietary: form.getAll("dietary") } });
        closeModal();
        toast("Recipient demand updated.");
        await navigateWithData("demand");
        await refresh();
      } catch (error) { toast(error.message, true); }
    });
  }).catch(error => toast(error.message, true));
}

async function handleAction(button) {
  const { action, id, status } = button.dataset;
  if (action === "new-donation") return showDonationModal();
  if (action === "match") return matchDonation(id);
  if (action === "view-donation") return openDonationDetail(id);
  if (action === "delivery-detail") return openDeliveryDetail(id);
  if (action === "advance-delivery") return updateDelivery(id, status);
  if (action === "report-issue") return reportDeliveryIssue(id);
  if (action === "reassign") return reassignDelivery(id);
  if (action === "verify-partner") return verifyPartner(id);
  if (action === "edit-profile") return editProfile();
  if (action === "edit-demand") return editDemand();
  if (action === "logout") {
    try { await api("/api/logout", { method: "POST", body: {} }); }
    catch (error) { toast(error.message, true); }
    showAuth();
  }
}

$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/login", { method: "POST", body: { email: form.get("email"), password: form.get("password") } });
    state.dashboard = null;
    showApp(result.user);
  } catch (error) { toast(error.message, true); }
});

$("#register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await api("/api/register", { method: "POST", body: Object.fromEntries(form.entries()) });
    toast(result.message);
    setAuthMode("login");
  } catch (error) { toast(error.message, true); }
});

$("#show-register").addEventListener("click", () => setAuthMode("register"));
$("#show-login").addEventListener("click", () => setAuthMode("login"));
$("#register-form [name=role]").addEventListener("change", event => {
  $("#registration-driver-fields").classList.toggle("hidden", event.target.value !== "driver");
});
$("#forgot-password").addEventListener("click", async () => {
  const email = $("#login-form [name=email]").value;
  if (!email) return toast("Enter your email address first.", true);
  try { await api("/api/password-reset", { method: "POST", body: { email } }); }
  catch (error) { toast(error.message, true); }
});
$(".password-toggle").addEventListener("click", event => {
  const input = $("#login-form [name=password]");
  input.type = input.type === "password" ? "text" : "password";
  event.currentTarget.textContent = input.type === "password" ? "Show" : "Hide";
});
$("#main-nav").addEventListener("click", event => {
  const button = event.target.closest("[data-nav]");
  if (button) navigateWithData(button.dataset.nav);
});
$("#content").addEventListener("click", event => {
  const action = event.target.closest("[data-action]");
  const nav = event.target.closest("[data-nav]");
  if (action) handleAction(action);
  if (nav) navigateWithData(nav.dataset.nav);
});
$("#content").addEventListener("input", event => {
  if (event.target.id === "search-filter") {
    state.search = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const replacement = $("#search-filter");
    replacement?.focus();
    replacement?.setSelectionRange(cursor, cursor);
  }
});
$("#content").addEventListener("change", event => {
  if (event.target.id === "status-filter") {
    state.filter = event.target.value;
    render();
  }
});
$("#modal-close").addEventListener("click", closeModal);
$("#modal-layer").addEventListener("click", event => { if (event.target === $("#modal-layer")) closeModal(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });
$("#notification-button").addEventListener("click", showNotifications);
$("#top-user").addEventListener("click", () => navigateWithData("profile"));
$("#profile-button").addEventListener("click", () => navigateWithData("profile"));
$("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open"));

async function init() {
  try {
    const result = await api("/api/session");
    showApp(result.user);
  } catch {
    showAuth();
  }
}

init();
