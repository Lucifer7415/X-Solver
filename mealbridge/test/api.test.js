const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server");
const { JsonStore, makeSeed } = require("../server/store");

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mealbridge-test-"));
  const store = new JsonStore(path.join(directory, "store.json"));
  await store.init(makeSeed());
  const server = createServer(store);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function login(email, password = "demo1234") {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json();
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    return { response, result, cookie };
  }

  async function request(route, { method = "GET", cookie, body } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { "content-type": "application/json" } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { response, result: await response.json() };
  }

  return { store, login, request };
}

test("demo login issues an HttpOnly session cookie and rejects incorrect passwords", async t => {
  const { login } = await setup(t);
  const valid = await login("admin@mealbridge.test");
  assert.equal(valid.response.status, 200);
  assert.match(valid.response.headers.get("set-cookie"), /HttpOnly/);
  assert.equal(valid.result.user.role, "admin");
  assert.equal("passwordHash" in valid.result.user, false);
  assert.equal("passwordSalt" in valid.result.user, false);

  const invalid = await login("admin@mealbridge.test", "wrong-password");
  assert.equal(invalid.response.status, 401);
});

test("server-side roles prevent recipients from posting donations", async t => {
  const { login, request } = await setup(t);
  const account = await login("recipient@mealbridge.test");
  const result = await request("/api/donations", {
    method: "POST",
    cookie: account.cookie,
    body: { title: "Test", category: "Prepared meals", quantityKg: 4, expiresAt: new Date(Date.now() + 60_000).toISOString(), lat: 28.6, lng: 77.2 }
  });
  assert.equal(result.response.status, 403);
});

test("allocation is feasible, capacity limited, and prevents duplicate over-allocation", async t => {
  const { login, request, store } = await setup(t);
  const account = await login("admin@mealbridge.test");
  const attempts = await Promise.all([
    request("/api/donations/DON-5820/match", { method: "POST", cookie: account.cookie, body: {} }),
    request("/api/donations/DON-5820/match", { method: "POST", cookie: account.cookie, body: {} })
  ]);
  const matched = attempts.find(result => result.response.status === 201);
  assert.ok(matched);
  assert.ok(matched.result.delivery.quantityKg <= 25);
  assert.equal(matched.result.delivery.status, "assigned");
  assert.match(matched.result.delivery.reason, /verified/);
  assert.equal(attempts.filter(result => result.response.status === 409).length, 1);

  const data = await store.read();
  const donation = data.donations.find(item => item.id === "DON-5820");
  assert.ok(donation.remainingKg >= 0);
  assert.equal(data.deliveries.filter(item => item.donationId === donation.id).length, 1);
});

test("delivery issues automatically reassign when another feasible driver is available", async t => {
  const { login, request, store } = await setup(t);
  const driver = await login("driver@mealbridge.test");
  const issue = await request("/api/deliveries/DEL-9402/status", {
    method: "POST", cookie: driver.cookie, body: { status: "issue", note: "Vehicle issue reported" }
  });
  assert.equal(issue.response.status, 200);
  assert.equal(issue.result.delivery.status, "assigned");
  assert.notEqual(issue.result.delivery.driverId, "usr-driver");
  const data = await store.read();
  assert.deepEqual(data.deliveries[0].history.slice(-2).map(item => item.status), ["issue", "assigned"]);
  assert.ok(data.activities.some(item => item.type === "reassignment"));
});

test("cancelling a delivery safely restores the reserved food before a later reassignment", async t => {
  const { login, request, store } = await setup(t);
  const admin = await login("admin@mealbridge.test");
  const cancelled = await request("/api/deliveries/DEL-9402/status", {
    method: "POST", cookie: admin.cookie, body: { status: "cancelled" }
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.result.delivery.allocationRestored, true);

  const reassigned = await request("/api/deliveries/DEL-9402/reassign", {
    method: "POST", cookie: admin.cookie, body: {}
  });
  assert.equal(reassigned.response.status, 200);
  assert.equal(reassigned.result.delivery.allocationRestored, false);
  assert.equal(reassigned.result.delivery.status, "assigned");

  const data = await store.read();
  assert.equal(data.donations.find(item => item.id === "DON-5821").remainingKg, 12);
  assert.equal(data.recipients.find(item => item.id === "org-hope").demandKg, 42);
});

test("expired donations cannot be registered", async t => {
  const { login, request } = await setup(t);
  const account = await login("donor@mealbridge.test");
  const result = await request("/api/donations", {
    method: "POST",
    cookie: account.cookie,
    body: {
      title: "Expired soup", category: "Prepared meals", quantityKg: 5,
      expiresAt: new Date(Date.now() - 60_000).toISOString(), lat: 28.6, lng: 77.2
    }
  });
  assert.equal(result.response.status, 400);
});

test("delivery state transitions are enforced and audit history is retained", async t => {
  const { login, request, store } = await setup(t);
  const driver = await login("driver@mealbridge.test");
  const invalid = await request("/api/deliveries/DEL-9402/status", {
    method: "POST", cookie: driver.cookie, body: { status: "verified" }
  });
  assert.equal(invalid.response.status, 409);

  const delivered = await request("/api/deliveries/DEL-9402/status", {
    method: "POST", cookie: driver.cookie, body: { status: "delivered" }
  });
  assert.equal(delivered.response.status, 200);
  const recipient = await login("recipient@mealbridge.test");
  const verified = await request("/api/deliveries/DEL-9402/status", {
    method: "POST", cookie: recipient.cookie, body: { status: "verified" }
  });
  assert.equal(verified.response.status, 200);
  const data = await store.read();
  assert.deepEqual(data.deliveries[0].history.map(item => item.status), ["assigned", "picked_up", "in_transit", "delivered", "verified"]);
});

test("registration stores a salted password and creates unverified recipient records", async t => {
  const { request, login, store } = await setup(t);
  const registered = await request("/api/register", {
    method: "POST",
    body: {
      email: "new-partner@example.test", password: "A-strong-demo-password",
      name: "Sam Partner", organization: "Community Table", role: "recipient"
    }
  });
  assert.equal(registered.response.status, 201);
  const data = await store.read();
  const account = data.users.find(user => user.email === "new-partner@example.test");
  assert.ok(account.passwordHash);
  assert.notEqual(account.passwordSalt, "mealbridge-demo-v1");
  assert.equal(data.recipients.find(recipient => recipient.userId === account.id).verified, false);
  assert.equal((await login(account.email, "A-strong-demo-password")).response.status, 200);
});

test("delivery partners can update vehicle capacity and availability only after verification", async t => {
  const { login, request, store } = await setup(t);
  const account = await login("driver@mealbridge.test");
  const updated = await request("/api/driver-profile", {
    method: "PUT", cookie: account.cookie,
    body: { vehicle: "Insulated van", capacityKg: 45, lat: 28.62, lng: 77.22, available: true }
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.result.driver.available, true);
  const data = await store.read();
  assert.equal(data.drivers.find(item => item.userId === "usr-driver").capacityKg, 45);
});

test("distance calculation returns a finite estimate", async () => {
  const { haversineKm } = require("../server");
  const distance = haversineKm({ lat: 28.61, lng: 77.2 }, { lat: 28.63, lng: 77.22 });
  assert.ok(distance > 0 && distance < 10);
});
