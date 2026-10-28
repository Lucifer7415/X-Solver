const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

function makeSeed() {
  const salt = "mealbridge-demo-v1";
  const passwordHash = crypto.scryptSync("demo1234", salt, 32).toString("hex");
  const users = [
    { id: "usr-admin", email: "admin@mealbridge.test", name: "Riya Sharma", organization: "MealBridge Network", role: "admin", verified: true },
    { id: "usr-donor", email: "donor@mealbridge.test", name: "Arjun Mehta", organization: "GreenFork Kitchen", role: "donor", verified: true },
    { id: "usr-recipient", email: "recipient@mealbridge.test", name: "Neha Kapoor", organization: "Hope Community Kitchen", role: "recipient", verified: true },
    { id: "usr-driver", email: "driver@mealbridge.test", name: "Kabir Singh", organization: "CityRunners", role: "driver", verified: true },
    { id: "usr-volunteer", email: "volunteer@mealbridge.test", name: "Maya Iyer", organization: "MealBridge Volunteers", role: "volunteer", verified: true }
  ].map(user => ({ ...user, passwordSalt: salt, passwordHash, createdAt: "2026-01-01T09:00:00.000Z" }));
  const now = Date.now();
  const future = minutes => new Date(now + minutes * 60_000).toISOString();
  return {
    users,
    donations: [
      {
        id: "DON-5821", donorId: "usr-donor", donor: "GreenFork Kitchen", title: "Fresh vegetable biryani",
        category: "Prepared meals", quantityKg: 32, remainingKg: 12, dietary: ["vegetarian"],
        preparedAt: future(-40), expiresAt: future(190), location: { lat: 28.6139, lng: 77.209 }, storage: "Keep chilled; donor demo note", status: "partially_allocated",
        history: [{ status: "available", at: future(-50), actor: "Arjun Mehta" }, { status: "partially_allocated", at: future(-45), actor: "Riya Sharma" }]
      },
      {
        id: "DON-5820", donorId: "usr-donor", donor: "GreenFork Kitchen", title: "Seasonal fruit boxes",
        category: "Fresh produce", quantityKg: 24, remainingKg: 24, dietary: ["vegan"],
        preparedAt: future(-25), expiresAt: future(340), location: { lat: 28.628, lng: 77.218 }, storage: "Not specified", status: "available",
        history: [{ status: "available", at: future(-35), actor: "Arjun Mehta" }]
      },
      {
        id: "DON-5818", donorId: "usr-donor", donor: "GreenFork Kitchen", title: "Lentil soup & rolls",
        category: "Prepared meals", quantityKg: 18, remainingKg: 0, dietary: ["vegetarian"],
        preparedAt: future(-90), expiresAt: future(70), location: { lat: 28.6139, lng: 77.209 }, storage: "Not specified", status: "assigned",
        history: [{ status: "assigned", at: future(-60), actor: "Riya Sharma" }]
      }
    ],
    recipients: [
      {
        id: "org-hope", userId: "usr-recipient", name: "Hope Community Kitchen", demandKg: 42,
        location: { lat: 28.635, lng: 77.225 }, dietary: ["vegetarian", "vegan"], verified: true, open: true, capacityKg: 120
      },
      {
        id: "org-sunrise", userId: null, name: "Sunrise Shelter", demandKg: 30,
        location: { lat: 28.672, lng: 77.245 }, dietary: ["vegetarian", "vegan", "halal"], verified: true, open: true, capacityKg: 90
      },
      {
        id: "org-neighborhood", userId: null, name: "Neighborhood Food Bank", demandKg: 16,
        location: { lat: 28.59, lng: 77.17 }, dietary: ["vegetarian", "vegan"], verified: false, open: true, capacityKg: 60
      }
    ],
    drivers: [
      {
        id: "usr-driver", userId: "usr-driver", name: "Kabir Singh", vehicle: "Refrigerated van",
        capacityKg: 80, location: { lat: 28.62, lng: 77.21 }, available: false, verified: true
      },
      {
        id: "driver-nisha", userId: null, name: "Nisha Rao", vehicle: "Cargo bicycle",
        capacityKg: 25, location: { lat: 28.64, lng: 77.23 }, available: true, verified: true
      },
      {
        id: "driver-rohan", userId: null, name: "Rohan Das", vehicle: "Insulated mini-van",
        capacityKg: 60, location: { lat: 28.58, lng: 77.2 }, available: true, verified: true
      }
    ],
    deliveries: [
      {
        id: "DEL-9402", donationId: "DON-5821", donation: "Fresh vegetable biryani", recipientId: "org-hope",
        recipientUserId: "usr-recipient", recipient: "Hope Community Kitchen", driverId: "usr-driver", driver: "Kabir Singh", quantityKg: 20,
        distanceKm: 4.1, etaMinutes: 32, status: "in_transit", createdAt: future(-22),
        history: [{ status: "assigned", at: future(-22), actor: "Riya Sharma" }, { status: "picked_up", at: future(-18), actor: "Kabir Singh" }, { status: "in_transit", at: future(-15), actor: "Kabir Singh" }],
        reason: "Matched to a verified recipient nearby with capacity and dietary preferences aligned; ETA is before the expiry time."
      }
    ],
    activities: [
      { id: "act-1", type: "delivery", message: "Fresh vegetable biryani is on its way to Hope Community Kitchen", actor: "Kabir Singh", at: future(-10) },
      { id: "act-2", type: "donation", message: "Seasonal fruit boxes donation posted (24 kg)", actor: "Arjun Mehta", at: future(-35) },
      { id: "act-3", type: "match", message: "20 kg of Fresh vegetable biryani matched to Hope Community Kitchen", actor: "Riya Sharma", at: future(-45) }
    ],
    notifications: [
      { id: "note-1", userId: "usr-admin", title: "Delivery in transit", message: "DEL-9402 is on the way; ETA 32 min.", read: false, at: future(-9) },
      { id: "note-2", userId: "usr-donor", title: "Donation matched", message: "20 kg of Fresh vegetable biryani was allocated.", read: false, at: future(-44) },
      { id: "note-3", userId: "usr-driver", title: "Pickup completed", message: "Fresh vegetable biryani delivery is in transit.", read: false, at: future(-12) }
    ]
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = path.resolve(filePath);
    this.pendingWrite = Promise.resolve();
    this.pendingRequest = Promise.resolve();
  }

  async init(seed) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await fs.access(this.filePath);
      await this.read();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.write(seed);
    }
  }

  async read() {
    const text = await fs.readFile(this.filePath, "utf8");
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`MealBridge data file is invalid JSON: ${this.filePath}`, { cause: error });
    }
  }

  write(value) {
    const operation = this.pendingWrite.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      await fs.rename(temporaryPath, this.filePath);
    });
    this.pendingWrite = operation.catch(() => {});
    return operation;
  }

  withLock(operation) {
    const result = this.pendingRequest.then(operation);
    this.pendingRequest = result.catch(() => {});
    return result;
  }
}

module.exports = { JsonStore, makeSeed };
