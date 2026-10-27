import { useState } from "react";

type User = { name: string };
type Dashboard = { summary: { activeDonations: number; activeDeliveries: number; mealsSaved: number } };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers }
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result as T;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      const session = await request<{ user: User }>("/api/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      setUser(session.user);
      setDashboard(await request<Dashboard>("/api/dashboard"));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Unable to sign in.");
    }
  }

  async function signOut() {
    await request("/api/logout", { method: "POST", body: "{}" });
    setDashboard(null);
    setUser(null);
  }

  return (
    <main className="shell">
      <header className="header"><span className="logo">m</span><strong>mealbridge</strong><span>Every Meal Finds Its Way</span></header>
      <section className="card">
        <p className="eyebrow">FOOD RESCUE NETWORK</p>
        <h1>{user ? `Welcome, ${user.name}` : "Good food. Good journey."}</h1>
        <p className="muted">React starter connected to the local MealBridge demo API. The complete working dashboard is served by this project’s local demo.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {!user ? (
          <form onSubmit={signIn}>
            <label>Email<input name="email" type="email" defaultValue="admin@mealbridge.test" required /></label>
            <label>Password<input name="password" type="password" defaultValue="demo1234" required /></label>
            <button type="submit">Sign in</button>
            <small>Demo account: admin@mealbridge.test / demo1234</small>
          </form>
        ) : (
          <>
            <div className="stats">
              <article><span>Meals rescued</span><b>{dashboard?.summary.mealsSaved ?? "—"}</b></article>
              <article><span>Active donations</span><b>{dashboard?.summary.activeDonations ?? "—"}</b></article>
              <article><span>Active deliveries</span><b>{dashboard?.summary.activeDeliveries ?? "—"}</b></article>
            </div>
            <button type="button" onClick={signOut}>Sign out</button>
          </>
        )}
        <p className="note">Forecasts and map locations in the demo are illustrative. This scaffold is not production-ready.</p>
      </section>
    </main>
  );
}
