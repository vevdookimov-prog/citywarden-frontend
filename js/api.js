// Data layer. In mock mode (default, and on the deployed site) it serves the
// bundled CW_MOCK data. With USE_MOCK=false it calls the real FastAPI backend
// and gracefully falls back to mock if the backend is unreachable.

(function () {
  const cfg = window.CW_CONFIG;
  const mock = window.CW_MOCK;

  async function http(path, opts) {
    const res = await fetch(cfg.API_BASE + path, opts);
    if (!res.ok) throw new Error(`${path} -> ${res.status}`);
    return res.json();
  }

  // Attach borough by nearest mock borough centroid (real /cameras has no borough).
  function inferBorough(lon, lat) {
    let best = null;
    let bestD = Infinity;
    mock.BOROUGHS.forEach((b) => {
      const d = (b.center[0] - lon) ** 2 + (b.center[1] - lat) ** 2;
      if (d < bestD) {
        bestD = d;
        best = b.name;
      }
    });
    return best;
  }

  async function getCameras() {
    if (cfg.USE_MOCK) return mock.CAMERAS;
    try {
      const cams = await http("/cameras");
      // Derive events (heat) by aggregating alerts per camera.
      const alerts = await getAlerts(1000);
      const counts = {};
      alerts.forEach((a) => (counts[a.camera_id] = (counts[a.camera_id] || 0) + 1));
      return cams.map((c) => ({
        ...c,
        borough: inferBorough(c.lon, c.lat),
        events: counts[c.id] || 0,
      }));
    } catch (e) {
      console.warn("[api] cameras fell back to mock:", e.message);
      return mock.CAMERAS;
    }
  }

  async function getAlerts(limit = 100) {
    if (cfg.USE_MOCK) return mock.ALERTS;
    try {
      const rows = await http(`/alerts?limit=${limit}`);
      return rows.map((a) => ({
        ...a,
        borough: inferBorough(a.lon, a.lat),
        rule_label: mock.ruleLabel(a.rule),
        clip_url: a.clip_url ? cfg.API_BASE + a.clip_url : null,
      }));
    } catch (e) {
      console.warn("[api] alerts fell back to mock:", e.message);
      return mock.ALERTS;
    }
  }

  async function setVerdict(alertId, verdict) {
    // verdict: "confirmed" (ACT ON) | "dismissed"
    if (cfg.USE_MOCK) return { id: alertId, verdict };
    try {
      return await http(`/alerts/${alertId}/verdict?verdict=${verdict}`, {
        method: "POST",
      });
    } catch (e) {
      console.warn("[api] setVerdict failed:", e.message);
      return { id: alertId, verdict, error: true };
    }
  }

  window.CW_API = { getCameras, getAlerts, setVerdict, summarise: mock.summarise };
})();
