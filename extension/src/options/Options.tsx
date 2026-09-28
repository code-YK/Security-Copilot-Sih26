import { Radar, Save, Server } from "lucide-react";
import { useEffect, useState } from "react";

import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getStorage, setStorage } from "@/lib/storage";

export function Options() {
  const [apiBaseUrl, setApiBaseUrl] = useState("http://127.0.0.1:8010");
  const [dashboardBaseUrl, setDashboardBaseUrl] = useState("http://localhost:3000");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [autoScanEnabled, setAutoScanEnabled] = useState(true);

  useEffect(() => {
    void (async () => {
      const storage = await getStorage();
      setApiBaseUrl(storage.apiBaseUrl);
      setDashboardBaseUrl(storage.dashboardBaseUrl);
      setAutoScanEnabled(storage.autoScanEnabled);
    })();
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    await setStorage({
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ""),
      dashboardBaseUrl: dashboardBaseUrl.replace(/\/+$/, ""),
    });
    setSavedMessage("Saved.");
    setTimeout(() => setSavedMessage(null), 2000);
  }

  async function toggleAutoScan() {
    const next = !autoScanEnabled;
    setAutoScanEnabled(next);
    await setStorage({ autoScanEnabled: next });
  }

  return (
    <div className="opt">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="opt-hd">
        <BrandMark />
        <div>
          <h1>Security Copilot</h1>
          <div className="sub">Settings</div>
        </div>
        <span className="spacer" />
        <ThemeToggle />
      </div>

      {/* ── Automatic scanning ──────────────────────────────── */}
      <section className="opt-card">
        <div className="switch-row">
          <div>
            <h2>
              <Radar /> Automatic scanning
            </h2>
            <p>
              Checks every page you open with a fast local model — no LLM call, no cost. Shows an in-page banner only when a
              page looks suspicious or dangerous; safe pages stay silent. Click <span className="k">Full report</span> on a
              banner to run the complete investigation.
            </p>
          </div>
          <button
            role="switch"
            aria-checked={autoScanEnabled}
            aria-label="Toggle automatic scanning"
            onClick={toggleAutoScan}
            className={`switch ${autoScanEnabled ? "on" : ""}`}
          >
            <span className="knob" />
          </button>
        </div>
      </section>

      {/* ── Backend connection ──────────────────────────────── */}
      <section className="opt-card">
        <h2>
          <Server /> Backend connection
        </h2>
        <p>
          Point the extension at your running backend (<code>uvicorn api.app:app</code> in <code>backend/</code>). No sign-in
          is required.
        </p>
        <form onSubmit={handleSave}>
          <div className="field">
            <label>API endpoint</label>
            <input
              type="url"
              required
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:8010"
            />
          </div>
          <div className="field">
            <label>Dashboard URL — where “Full report” opens a run</label>
            <input
              type="url"
              required
              value={dashboardBaseUrl}
              onChange={(e) => setDashboardBaseUrl(e.target.value)}
              placeholder="http://localhost:3000"
            />
          </div>
          <button type="submit" className="btn primary" style={{ marginTop: 18, width: 160 }}>
            <span className="lead">
              <Save />
            </span>
            Save changes
          </button>
        </form>
        {savedMessage && (
          <p className="save-note">
            <span className="d" />
            {savedMessage}
          </p>
        )}
      </section>

      <p className="ver">Security Copilot · v1.0.0</p>
    </div>
  );
}
