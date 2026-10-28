const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore, makeSeed } = require("./store");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const MAX_BODY_BYTES = 64 * 1024;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const registrationAttempts = new Map();
const cookieName = "mealbridge_session";
const store = new JsonStore(process.env.MEALBRIDGE_DATA_FILE || path.join(ROOT, "data", "store.json"));
const statuses = ["matched", "assigned", "picked_up", "in_transit", "delivered", "verified", "issue", "cancelled"];
const allowedTransitions = {
  matched: ["assigned", "cancelled", "issue"],
  assigned: ["picked_up", "cancelled", "issue"],
  picked_up: ["in_transit", "cancelled", "issue"],
  in_transit: ["delivered", "cancelled", "issue"],
  delivered: ["verified", "issue"],
  verified: [],
  issue: ["assigned", "cancelled"],
  cancelled: []
};

function json(res, status, value, headers = {}) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(value));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(fail(413, "Request body is too large."));
        req.destroy();
        return;
      }
      text += chunk;
    });
    req.on("end", () => {
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(fail(400, "Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => {
    const index = part.indexOf("=");
    if (index < 0) return ["", ""];
    const key = part.slice(0, index).trim();
    try {
      return [key, decodeURIComponent(part.slice(index + 1).trim())];
    } catch {
      return [key, ""];
    }
  }).filter(([key]) => key));
}

function getUser(req, data) {
  const token = parseCookies(req.headers.cookie)[cookieName];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return data.users.find(user => user.id === session.userId) || null;
}

function safeUser(user) {
  const { passwordHash: ignoredHash, passwordSalt: ignoredSalt, ...profile } = user;
  return profile;
}

function requireUser(user) {
  if (!user) throw fail(401, "Please sign in to continue.");
}

function requireRole(user, roles) {
  requireUser(user);
  if (!roles.includes(user.role)) throw fail(403, "Your account cannot perform this action.");
}

function cleanText(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw fail(400, `${label} is required and must be at most ${max} characters.`);
  }
  return value.trim();
}

function finiteNumber(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw fail(400, `${label} must be between ${min} and ${max}.`);
  return number;
}

function haversineKm(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function predictSurplus(donations, donorId) {
  const history = donations.filter(item => item.donorId === donorId).slice(0, 12);
  const average = history.length ? history.reduce((sum, item) => sum + item.quantityKg, 0) / history.length : 18;
  const hourFactor = new Date().getHours() >= 15 ? 1.15 : 0.9;
  return {
    quantityKg: Math.max(5, Math.round(average * hourFactor)),
    confidence: history.length >= 5 ? "Moderate" : "Low",
    basis: history.length ? `${history.length} recent demo donation${history.length === 1 ? "" : "s"} and time of day` : "Transparent rule-based estimate; no donor history yet",
    availableAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
}

function allocationCandidates(data, donation) {
  const now = Date.now();
  return data.recipients
    .filter(recipient => recipient.verified && recipient.open && recipient.demandKg > 0)
    .map(recipient => {
      const distanceKm = haversineKm(donation.location, recipient.location);
      const remainingMinutes = (Date.parse(donation.expiresAt) - now) / 60000;
      const dietaryMatch = donation.dietary.length === 0 || donation.dietary.some(tag => recipient.dietary.includes(tag));
      const quantityKg = Math.min(donation.remainingKg, recipient.demandKg, recipient.capacityKg);
      const driver = data.drivers
        .filter(item => item.available && item.verified && item.capacityKg >= quantityKg)
        .map(item => {
          const pickupKm = haversineKm(item.location, donation.location);
          return {
            item,
            pickupKm,
            etaMinutes: Math.ceil((pickupKm + distanceKm) / 28 * 60) + 20
          };
        })
        .filter(item => item.pickupKm <= 35)
        .sort((a, b) => a.etaMinutes - b.etaMinutes)[0];
      const etaMinutes = driver?.etaMinutes ?? Infinity;
      const feasible = distanceKm <= 40 && etaMinutes < remainingMinutes && dietaryMatch && Boolean(driver);
      const score = Math.max(0, Math.round(100 - distanceKm * 1.4 + (remainingMinutes < 180 ? 12 : 0) + (dietaryMatch ? 8 : 0)));
      return { recipient, driver: driver?.item || null, distanceKm, etaMinutes, feasible, quantityKg, score };
    })
    .filter(candidate => candidate.feasible && candidate.quantityKg > 0)
    .sort((a, b) => b.score - a.score);
}

function findReplacementDriver(data, delivery, donation, recipient) {
  const remainingMinutes = (Date.parse(donation.expiresAt) - Date.now()) / 60000;
  const deliveryKm = haversineKm(donation.location, recipient.location);
  return data.drivers
    .filter(driver => driver.available && driver.verified && driver.id !== delivery.driverId && driver.capacityKg >= delivery.quantityKg)
    .map(driver => {
      const pickupKm = haversineKm(driver.location, donation.location);
      const etaMinutes = Math.ceil((pickupKm + deliveryKm) / 28 * 60) + 20;
      return { driver, pickupKm, deliveryKm, etaMinutes };
    })
    .filter(item => item.pickupKm <= 35 && item.etaMinutes < remainingMinutes)
    .sort((a, b) => a.etaMinutes - b.etaMinutes)[0] || null;
}

function addActivity(data, type, message, actor) {
  data.activities.unshift({
    id: crypto.randomUUID(),
    type,
    message,
    actor: actor.name,
    at: new Date().toISOString()
  });
  data.activities = data.activities.slice(0, 40);
}

function notify(data, userId, title, message, resourceId) {
  if (!userId) return;
  data.notifications.unshift({ id: crypto.randomUUID(), userId, title, message, ...(resourceId ? { resourceId } : {}), read: false, at: new Date().toISOString() });
}

function statusLabel(status) {
  return status.replaceAll("_", " ");
}

async function route(req, res, store) {
  const url = new URL(req.url, "http://localhost");
  const data = await store.read();
  const user = getUser(req, data);
  const method = req.method;
  const body = ["POST", "PUT", "PATCH"].includes(method) ? await readBody(req) : {};
  const pathName = url.pathname;
  const origin = req.headers.origin;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw fail(403, "Cross-origin requests are not allowed.");
    }
    if (originHost !== req.headers.host) throw fail(403, "Cross-origin requests are not allowed.");
  }

  if (method === "GET" && pathName === "/api/health") return json(res, 200, { status: "ok", name: "MealBridge API" });
  if (method === "POST" && pathName === "/api/login") {
    const address = req.socket.remoteAddress || "unknown";
    const priorAttempts = loginAttempts.get(address) || [];
    const attempts = priorAttempts.filter(at => Date.now() - at < 15 * 60 * 1000);
    if (attempts.length >= 10) return json(res, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
    const email = String(body.email || "").toLowerCase().trim();
    const userRecord = data.users.find(item => item.email.toLowerCase() === email);
    const salt = userRecord?.passwordSalt || "mealbridge-invalid-user";
    const submittedPassword = String(body.password || "");
    const submittedHash = crypto.scryptSync(submittedPassword.slice(0, 128), salt, 32);
    const expectedHash = Buffer.from(userRecord?.passwordHash || crypto.scryptSync("invalid", salt, 32).toString("hex"), "hex");
    const validPassword = crypto.timingSafeEqual(submittedHash, expectedHash);
    if (!userRecord || submittedPassword.length > 128 || !validPassword || userRecord.disabled) {
      attempts.push(Date.now());
      loginAttempts.set(address, attempts);
      return json(res, 401, { error: "Email or password is incorrect." });
    }
    loginAttempts.delete(address);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, { userId: userRecord.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return json(res, 200, { user: safeUser(userRecord) }, {
      "set-cookie": `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
    });
  }
  if (method === "POST" && pathName === "/api/logout") {
    const token = parseCookies(req.headers.cookie)[cookieName];
    if (token) sessions.delete(token);
    return json(res, 200, { ok: true }, { "set-cookie": `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }
  if (method === "GET" && pathName === "/api/session") {
    if (!user) return json(res, 401, { error: "Please sign in to continue." });
    return json(res, 200, { user: safeUser(user) });
  }
  if (method === "POST" && pathName === "/api/register") {
    const address = req.socket.remoteAddress || "unknown";
    const recentAttempts = (registrationAttempts.get(address) || []).filter(at => Date.now() - at < 15 * 60 * 1000);
    if (recentAttempts.length >= 5) return json(res, 429, { error: "Too many account registration attempts. Try again in 15 minutes." });
    recentAttempts.push(Date.now());
    registrationAttempts.set(address, recentAttempts);
    const email = cleanText(body.email, "Email", 160).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "Enter a valid email address.");
    if (data.users.some(person => person.email.toLowerCase() === email)) throw fail(409, "An account with this email already exists.");
    if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128) throw fail(400, "Password must contain 10 to 128 characters.");
    const role = body.role;
    if (!["donor", "recipient", "driver", "volunteer"].includes(role)) throw fail(400, "Choose an available partner role.");
    const account = {
      id: crypto.randomUUID(), email, name: cleanText(body.name, "Name", 80),
      organization: cleanText(body.organization, "Organization", 100), role,
      passwordSalt: crypto.randomBytes(16).toString("hex"),
      passwordHash: "",
      verified: role === "volunteer", createdAt: new Date().toISOString()
    };
    account.passwordHash = crypto.scryptSync(body.password, account.passwordSalt, 32).toString("hex");
    data.users.push(account);
    if (role === "recipient") data.recipients.push({
      id: account.id, userId: account.id, name: account.organization, demandKg: 0, location: { lat: 28.6139, lng: 77.209 },
      dietary: [], verified: false, open: false, capacityKg: 100
    });
    if (role === "driver") data.drivers.push({
      id: account.id, userId: account.id, name: account.name,
      vehicle: cleanText(body.vehicle, "Vehicle", 80),
      capacityKg: finiteNumber(body.capacityKg, "Vehicle capacity", 1, 1000),
      location: {
        lat: finiteNumber(body.lat, "Latitude", 6.8, 37.2),
        lng: finiteNumber(body.lng, "Longitude", 68.1, 97.4)
      },
      available: false, verified: false
    });
    await store.write(data);
    return json(res, 201, { message: "Account created. Sign in after your organization is verified." });
  }
  if (method === "POST" && pathName === "/api/password-reset") {
    const email = String(body.email || "").toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "Enter a valid email address.");
    return json(res, 501, { error: "Password reset delivery is not configured in this local demo. No email was sent." });
  }
  requireUser(user);

  if (method === "GET" && pathName === "/api/dashboard") {
    const activeDonations = data.donations.filter(item => !["verified", "cancelled"].includes(item.status));
    const deliveries = data.deliveries.filter(item => !["verified", "cancelled"].includes(item.status));
    const totalKg = data.donations.reduce((sum, item) => sum + item.quantityKg, 0);
    const rescuedKg = data.deliveries.filter(item => ["delivered", "verified"].includes(item.status)).reduce((sum, item) => sum + item.quantityKg, 0);
    const savedMeals = Math.round(rescuedKg * 2.4);
    const visibleDonations = user.role === "admin" ? data.donations :
      user.role === "donor" ? data.donations.filter(item => item.donorId === user.id) :
        user.role === "recipient" ? data.donations.filter(item => item.remainingKg > 0) :
          data.donations.filter(item => data.deliveries.some(delivery => delivery.donationId === item.id && delivery.driverId === user.id));
    const visibleDeliveries = user.role === "admin" ? deliveries :
      user.role === "donor" ? deliveries.filter(item => data.donations.some(donation => donation.id === item.donationId && donation.donorId === user.id)) :
        user.role === "recipient" ? deliveries.filter(item => item.recipientUserId === user.id) :
          user.role === "driver" ? deliveries.filter(item => item.driverId === user.id) : deliveries;
    let addedExpiryAlert = false;
    for (const donation of visibleDonations) {
      const minutesToExpiry = (Date.parse(donation.expiresAt) - Date.now()) / 60000;
      if (donation.remainingKg > 0 && minutesToExpiry <= 180 && minutesToExpiry > 0) {
        const recipients = user.role === "admin" ? data.users.filter(person => person.role === "admin") :
          data.users.filter(person => person.id === donation.donorId);
        for (const recipient of recipients) {
          if (!data.notifications.some(item => item.userId === recipient.id && item.resourceId === donation.id && item.title === "Donation expiring soon")) {
            notify(data, recipient.id, "Donation expiring soon", `${donation.title} has less than three hours before its use-by time.`, donation.id);
            addedExpiryAlert = true;
          }
        }
      }
    }
    if (addedExpiryAlert) await store.write(data);
    return json(res, 200, {
      summary: {
        activeDonations: user.role === "admin" ? activeDonations.length : visibleDonations.filter(item => item.remainingKg > 0).length,
        activeDeliveries: user.role === "admin" ? deliveries.length : visibleDeliveries.length,
        mealsSaved: savedMeals, rescuedKg, donatedKg: totalKg
      },
      donations: visibleDonations.slice(0, 8),
      deliveries: visibleDeliveries.slice(0, 6),
      activities: data.activities.slice(0, 6),
      notifications: data.notifications.filter(item => item.userId === user.id).slice(0, 6),
      user: safeUser(user)
    });
  }
  if (method === "GET" && pathName === "/api/donations") {
    const donations = user.role === "admin" ? data.donations :
      user.role === "donor" ? data.donations.filter(item => item.donorId === user.id) :
        user.role === "recipient" ? data.donations.filter(item => item.remainingKg > 0 && ["available", "partially_allocated"].includes(item.status)) :
          data.donations.filter(item => data.deliveries.some(delivery => delivery.donationId === item.id && delivery.driverId === user.id));
    return json(res, 200, { donations });
  }
  if (method === "POST" && pathName === "/api/donations") {
    requireRole(user, ["admin", "donor"]);
    if (user.role === "donor" && !user.verified) throw fail(403, "Your organization must be verified before posting donations.");
    const quantityKg = finiteNumber(body.quantityKg, "Quantity", 1, 2000);
    const expiresAt = new Date(body.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) throw fail(400, "Expiry must be a future date and time.");
    const donation = {
      id: `DON-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      donorId: user.id,
      donor: user.organization,
      title: cleanText(body.title, "Food name", 80),
      category: cleanText(body.category, "Category", 40),
      quantityKg,
      remainingKg: quantityKg,
      dietary: Array.isArray(body.dietary) ? body.dietary.filter(item => ["vegetarian", "vegan", "halal", "gluten-free"].includes(item)) : [],
      preparedAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
      location: {
        lat: finiteNumber(body.lat, "Latitude", 6.8, 37.2),
        lng: finiteNumber(body.lng, "Longitude", 68.1, 97.4)
      },
      storage: cleanText(body.storage || "Not specified", "Storage notes", 160),
      status: "available",
      history: [{ status: "available", at: new Date().toISOString(), actor: user.name }]
    };
    data.donations.unshift(donation);
    addActivity(data, "donation", `${donation.title} donation posted (${quantityKg} kg)`, user);
    notify(data, data.users.find(person => person.role === "admin")?.id, "New food donation", `${donation.title} is ready for matching.`);
    await store.write(data);
    return json(res, 201, { donation });
  }
  if (method === "POST" && /^\/api\/donations\/[^/]+\/match$/.test(pathName)) {
    requireRole(user, ["admin", "donor"]);
    const id = pathName.split("/")[3];
    const donation = data.donations.find(item => item.id === id);
    if (!donation) throw fail(404, "Donation was not found.");
    if (user.role === "donor" && donation.donorId !== user.id) throw fail(403, "You can only match your own donations.");
    if (donation.remainingKg <= 0) throw fail(409, "This donation has already been fully allocated.");
    const candidates = allocationCandidates(data, donation);
    const match = candidates[0];
    if (!match) throw fail(409, "No verified recipient and delivery partner currently meet expiry, distance, dietary, and capacity constraints.");
    const driver = match.driver;
    const delivery = {
      id: `DEL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
      donationId: donation.id,
      donation: donation.title,
      recipientId: match.recipient.id,
      recipientUserId: match.recipient.userId,
      recipient: match.recipient.name,
      driverId: driver.id,
      driver: driver.name,
      quantityKg: match.quantityKg,
      distanceKm: Math.round(match.distanceKm * 10) / 10,
      etaMinutes: match.etaMinutes,
      status: "assigned",
      createdAt: new Date().toISOString(),
      history: [{ status: "assigned", at: new Date().toISOString(), actor: user.name, note: "Automatic demo allocation" }],
      reason: `Matched to verified ${match.recipient.name}: ${match.distanceKm.toFixed(1)} km recipient distance, ${match.etaMinutes} min demo ETA, ${match.recipient.demandKg} kg demand before allocation, ${driver.capacityKg} kg courier capacity, and delivery before expiry. Dietary preferences were considered.`
    };
    donation.remainingKg -= match.quantityKg;
    donation.status = donation.remainingKg ? "partially_allocated" : "assigned";
    donation.history ||= [];
    donation.history.push({ status: donation.status, at: delivery.createdAt, actor: user.name, note: `${match.quantityKg} kg allocated to ${match.recipient.name}` });
    match.recipient.demandKg -= match.quantityKg;
    driver.available = false;
    data.deliveries.unshift(delivery);
    addActivity(data, "match", `${delivery.quantityKg} kg of ${donation.title} matched to ${match.recipient.name}`, user);
    notify(data, driver.userId, "New delivery assigned", `${delivery.donation} needs pickup; estimated ${delivery.etaMinutes} min.`, delivery.id);
    notify(data, match.recipient.userId, "Food donation matched", `${delivery.quantityKg} kg of ${delivery.donation} is on its way.`, delivery.id);
    await store.write(data);
    return json(res, 201, { delivery, candidates: candidates.map(item => ({ recipient: item.recipient.name, distanceKm: Math.round(item.distanceKm * 10) / 10, etaMinutes: item.etaMinutes, quantityKg: item.quantityKg, score: item.score })) });
  }
  if (method === "GET" && pathName === "/api/deliveries") {
    const deliveries = user.role === "admin" ? data.deliveries :
      user.role === "donor" ? data.deliveries.filter(item => data.donations.some(donation => donation.id === item.donationId && donation.donorId === user.id)) :
        user.role === "recipient" ? data.deliveries.filter(item => item.recipientUserId === user.id) :
          user.role === "driver" ? data.deliveries.filter(item => item.driverId === user.id) :
            data.deliveries.filter(item => !["verified", "cancelled"].includes(item.status));
    return json(res, 200, { deliveries });
  }
  if (method === "POST" && /^\/api\/deliveries\/[^/]+\/status$/.test(pathName)) {
    const id = pathName.split("/")[3];
    const delivery = data.deliveries.find(item => item.id === id);
    if (!delivery) throw fail(404, "Delivery was not found.");
    if (user.role === "driver" && !user.verified) throw fail(403, "Your delivery account must be verified before updating a job.");
    if (user.role === "driver" && delivery.driverId !== user.id) throw fail(403, "This delivery is assigned to another driver.");
    const previousStatus = delivery.status;
    const next = cleanText(body.status, "Status", 20);
    if (user.role === "recipient") {
      if (delivery.recipientUserId !== user.id || next !== "verified" || delivery.status !== "delivered") throw fail(403, "Recipients can only confirm their own delivered orders.");
    } else {
      requireRole(user, ["admin", "driver", "volunteer"]);
    }
    if (!statuses.includes(next) || !allowedTransitions[delivery.status]?.includes(next)) {
      throw fail(409, `Cannot change delivery from ${delivery.status} to ${next}.`);
    }
    delivery.status = next;
    delivery.updatedAt = new Date().toISOString();
    if (next === "verified") delivery.verifiedAt = delivery.updatedAt;
    delivery.history ||= [];
    delivery.history.push({ status: next, at: delivery.updatedAt, actor: user.name, ...(typeof body.note === "string" && body.note.trim() ? { note: body.note.trim().slice(0, 240) } : {}) });
    const donation = data.donations.find(item => item.id === delivery.donationId);
    const recipient = data.recipients.find(item => item.id === delivery.recipientId);
    if (next === "cancelled" && !delivery.allocationRestored && !["delivered", "verified"].includes(previousStatus) && donation && recipient) {
      donation.remainingKg = Math.min(donation.quantityKg, donation.remainingKg + delivery.quantityKg);
      donation.status = donation.remainingKg === donation.quantityKg ? "available" : "partially_allocated";
      donation.history ||= [];
      donation.history.push({ status: donation.status, at: delivery.updatedAt, actor: user.name, note: `${delivery.quantityKg} kg returned after delivery cancellation` });
      recipient.demandKg += delivery.quantityKg;
      delivery.allocationRestored = true;
    }
    if (next === "cancelled" || next === "issue") {
      const driver = data.drivers.find(item => item.id === delivery.driverId);
      if (driver) driver.available = true;
    }
    if (next === "delivered" || next === "verified") {
      const driver = data.drivers.find(item => item.id === delivery.driverId);
      if (driver) driver.available = true;
    }
    if (next === "issue" && donation) {
      const recipient = data.recipients.find(item => item.id === delivery.recipientId);
      const replacement = recipient && findReplacementDriver(data, delivery, donation, recipient);
      if (replacement) {
        delivery.driverId = replacement.driver.id;
        delivery.driver = replacement.driver.name;
        delivery.status = "assigned";
        delivery.etaMinutes = replacement.etaMinutes;
        delivery.distanceKm = Math.round((replacement.pickupKm + replacement.deliveryKm) * 10) / 10;
        delivery.updatedAt = new Date().toISOString();
        delivery.history.push({ status: "assigned", at: delivery.updatedAt, actor: "MealBridge auto-reassignment", note: `Automatically reassigned to ${replacement.driver.name}; estimated arrival ${replacement.etaMinutes} min.` });
        replacement.driver.available = false;
        notify(data, replacement.driver.userId, "Delivery reassigned to you", `${delivery.donation} needs pickup.`, delivery.id);
        addActivity(data, "reassignment", `Delivery ${delivery.id} automatically reassigned to ${replacement.driver.name}`, user);
      } else {
        notify(data, data.users.find(person => person.role === "admin")?.id, "Delivery needs attention", `${delivery.id} could not be automatically reassigned; review it now.`, delivery.id);
      }
    }
    if (donation && ["issue", "cancelled", "picked_up", "in_transit", "delivered", "verified"].includes(next)) {
      const donor = data.users.find(person => person.id === donation.donorId);
      notify(data, donor?.id, next === "issue" ? "Delivery issue reported" : "Delivery status updated", `${delivery.donation} is now ${statusLabel(next)}.`, delivery.id);
      notify(data, delivery.recipientUserId, next === "issue" ? "Delivery needs attention" : "Delivery status updated", `${delivery.donation} is now ${statusLabel(next)}.`, delivery.id);
    }
    if (next === "delivered") notify(data, data.users.find(person => person.role === "admin")?.id, "Delivery completed", `${delivery.donation} reached ${delivery.recipient}.`, delivery.id);
    addActivity(data, "delivery", `${delivery.donation} delivery marked ${next.replaceAll("_", " ")}`, user);
    await store.write(data);
    return json(res, 200, { delivery });
  }
  if (method === "POST" && /^\/api\/deliveries\/[^/]+\/reassign$/.test(pathName)) {
    requireRole(user, ["admin", "driver"]);
    const id = pathName.split("/")[3];
    const delivery = data.deliveries.find(item => item.id === id);
    if (!delivery) throw fail(404, "Delivery was not found.");
    if (user.role === "driver" && delivery.driverId !== user.id) throw fail(403, "You can only reassign a delivery assigned to you.");
    if (!["issue", "cancelled", "assigned"].includes(delivery.status)) throw fail(409, "Only new, cancelled, or issue deliveries can be reassigned.");
    const previousDriver = data.drivers.find(item => item.id === delivery.driverId);
    if (previousDriver) previousDriver.available = true;
    const donation = data.donations.find(item => item.id === delivery.donationId);
    const recipient = data.recipients.find(item => item.id === delivery.recipientId);
    if (!donation || !recipient) throw fail(409, "The original donation or recipient is unavailable.");
    const replacement = findReplacementDriver(data, delivery, donation, recipient);
    if (!replacement) throw fail(409, "No verified, available driver with enough capacity can arrive before expiry.");
    if (delivery.allocationRestored) {
      if (donation.remainingKg < delivery.quantityKg || recipient.demandKg < delivery.quantityKg || recipient.capacityKg < delivery.quantityKg) {
        throw fail(409, "The original quantity is no longer available for reassignment.");
      }
      donation.remainingKg -= delivery.quantityKg;
      donation.status = donation.remainingKg ? "partially_allocated" : "assigned";
      donation.history ||= [];
      donation.history.push({ status: donation.status, at: new Date().toISOString(), actor: user.name, note: `${delivery.quantityKg} kg reserved again after reassignment` });
      recipient.demandKg -= delivery.quantityKg;
      delivery.allocationRestored = false;
    }
    const nextDriver = replacement.driver;
    delivery.driverId = nextDriver.id;
    delivery.driver = nextDriver.name;
    delivery.distanceKm = Math.round((replacement.pickupKm + replacement.deliveryKm) * 10) / 10;
    delivery.etaMinutes = replacement.etaMinutes;
    delivery.status = "assigned";
    delivery.updatedAt = new Date().toISOString();
    delivery.history ||= [];
    delivery.history.push({ status: "assigned", at: delivery.updatedAt, actor: user.name, note: `Reassigned to ${nextDriver.name}` });
    nextDriver.available = false;
    notify(data, nextDriver.userId, "Delivery reassigned to you", `${delivery.donation} needs pickup.`, delivery.id);
    addActivity(data, "reassignment", `Delivery ${delivery.id} reassigned to ${nextDriver.name}`, user);
    await store.write(data);
    return json(res, 200, { delivery });
  }
  if (method === "GET" && pathName === "/api/recipients") {
    const recipients = user.role === "admin" ? data.recipients :
      user.role === "recipient" ? data.recipients.filter(item => item.userId === user.id) :
        data.recipients.filter(item => item.verified && item.open).map(({ id, name, demandKg, dietary, verified, open, capacityKg }) => ({ id, name, demandKg, dietary, verified, open, capacityKg }));
    return json(res, 200, { recipients });
  }
  if (method === "POST" && /^\/api\/partners\/[^/]+\/verify$/.test(pathName)) {
    requireRole(user, ["admin"]);
    const id = pathName.split("/")[3];
    const partner = data.users.find(item => item.id === id);
    if (!partner || !["donor", "recipient", "driver"].includes(partner.role)) throw fail(404, "Partner organization was not found.");
    partner.verified = Boolean(body.verified);
    partner.verifiedAt = partner.verified ? new Date().toISOString() : null;
    const recipient = data.recipients.find(item => item.userId === id);
    if (recipient) recipient.verified = partner.verified;
    const driver = data.drivers.find(item => item.userId === id);
    if (driver) driver.verified = partner.verified;
    addActivity(data, "verification", `${partner.organization} ${partner.verified ? "verified" : "verification revoked"}`, user);
    await store.write(data);
    return json(res, 200, { partner: safeUser(partner) });
  }
  if (method === "GET" && pathName === "/api/predictions") {
    const donors = data.users.filter(person => person.role === "donor" && (user.role === "admin" || person.id === user.id));
    return json(res, 200, {
      predictions: donors.map(donor => ({ donor: donor.organization, ...predictSurplus(data.donations.filter(item => item.donorId === donor.id), donor.id) }))
    });
  }
  if (method === "GET" && pathName === "/api/analytics") {
    const totalKg = data.donations.reduce((sum, item) => sum + item.quantityKg, 0);
    const delivered = data.deliveries.filter(item => ["delivered", "verified"].includes(item.status));
    const rescuedKg = delivered.reduce((sum, item) => sum + item.quantityKg, 0);
    const statusCounts = statuses.reduce((result, status) => {
      result[status] = data.deliveries.filter(item => item.status === status).length;
      return result;
    }, {});
    return json(res, 200, {
      totals: { donatedKg: totalKg, rescuedKg, meals: Math.round(rescuedKg * 2.4), deliveryCount: data.deliveries.length },
      statusCounts,
      byCategory: data.donations.reduce((result, item) => {
        result[item.category] = (result[item.category] || 0) + item.quantityKg;
        return result;
      }, {})
    });
  }
  if (method === "GET" && pathName === "/api/partners") {
    requireRole(user, ["admin"]);
    return json(res, 200, { partners: data.users.filter(person => ["donor", "recipient", "driver"].includes(person.role)).map(safeUser) });
  }
  if (method === "PUT" && pathName === "/api/profile") {
    user.name = cleanText(body.name, "Name", 80);
    user.organization = cleanText(body.organization, "Organization", 100);
    const driver = data.drivers.find(item => item.userId === user.id);
    if (driver) driver.name = user.name;
    const recipient = data.recipients.find(item => item.userId === user.id);
    if (recipient) recipient.name = user.organization;
    await store.write(data);
    return json(res, 200, { user: safeUser(user) });
  }
  if (method === "PUT" && pathName === "/api/demand") {
    requireRole(user, ["recipient"]);
    const recipient = data.recipients.find(item => item.userId === user.id);
    if (!recipient) throw fail(404, "Recipient profile was not found.");
    recipient.demandKg = finiteNumber(body.demandKg, "Demand", 0, 2000);
    recipient.capacityKg = finiteNumber(body.capacityKg, "Storage capacity", 1, 5000);
    recipient.location = {
      lat: finiteNumber(body.lat, "Latitude", 6.8, 37.2),
      lng: finiteNumber(body.lng, "Longitude", 68.1, 97.4)
    };
    recipient.open = Boolean(body.open);
    recipient.dietary = Array.isArray(body.dietary) ? body.dietary.filter(item => ["vegetarian", "vegan", "halal", "gluten-free"].includes(item)) : [];
    addActivity(data, "demand", `${recipient.name} updated recipient demand to ${recipient.demandKg} kg`, user);
    await store.write(data);
    return json(res, 200, { recipient });
  }
  if (method === "GET" && pathName === "/api/driver-profile") {
    requireRole(user, ["driver"]);
    const driver = data.drivers.find(item => item.userId === user.id);
    if (!driver) throw fail(404, "Delivery partner profile was not found.");
    return json(res, 200, { driver });
  }
  if (method === "PUT" && pathName === "/api/driver-profile") {
    requireRole(user, ["driver"]);
    const driver = data.drivers.find(item => item.userId === user.id);
    if (!driver) throw fail(404, "Delivery partner profile was not found.");
    driver.vehicle = cleanText(body.vehicle, "Vehicle", 80);
    driver.capacityKg = finiteNumber(body.capacityKg, "Vehicle capacity", 1, 1000);
    driver.location = {
      lat: finiteNumber(body.lat, "Latitude", 6.8, 37.2),
      lng: finiteNumber(body.lng, "Longitude", 68.1, 97.4)
    };
    if (body.available && !user.verified) throw fail(403, "Your partner account must be verified before becoming available.");
    driver.available = Boolean(body.available);
    await store.write(data);
    return json(res, 200, { driver });
  }
  if (method === "GET" && pathName === "/api/notifications") {
    return json(res, 200, { notifications: data.notifications.filter(item => item.userId === user.id) });
  }
  if (method === "POST" && pathName === "/api/notifications/read") {
    data.notifications.filter(item => item.userId === user.id).forEach(item => { item.read = true; });
    await store.write(data);
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && pathName === "/api/profile") return json(res, 200, { user: safeUser(user) });
  return json(res, 404, { error: "API route not found." });
}

function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  let file;
  try {
    file = pathname === "/" ? "index.html" : path.normalize(decodeURIComponent(pathname).slice(1));
  } catch {
    res.writeHead(400);
    return res.end("Invalid path");
  }
  const fullPath = path.resolve(PUBLIC_DIR, file);
  if (!fullPath.startsWith(`${PUBLIC_DIR}${path.sep}`) && fullPath !== path.join(PUBLIC_DIR, "index.html")) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(fullPath, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500);
      return res.end("Not found");
    }
    const type = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" }[path.extname(fullPath)] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    });
    res.end(content);
  });
}

function createServer(dataStore = store) {
  return http.createServer(async (req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
    if (req.url.startsWith("/api/")) {
      try {
        await dataStore.withLock(() => route(req, res, dataStore));
      } catch (error) {
        if (error.status) return json(res, error.status, { error: error.message });
        console.error("MealBridge API error:", error);
        json(res, 500, { error: "The server could not complete the request." });
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      return res.end("Method not allowed");
    }
    serveStatic(req, res);
  });
}

async function start() {
  await store.init(makeSeed());
  const port = Number(process.env.PORT || 3000);
  const server = createServer();
  server.listen(port, process.env.HOST || "127.0.0.1", () => console.log(`MealBridge running at http://localhost:${port}`));
  return server;
}

module.exports = { createServer, start, haversineKm, allocationCandidates, predictSurplus };

if (require.main === module) start();
