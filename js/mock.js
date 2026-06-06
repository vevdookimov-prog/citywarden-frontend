// Bundled mock data so the deployed Pages site looks fully alive without a
// reachable backend. Shapes mirror backend/main.py exactly:
//   /cameras -> {id, name, lat, lon, available}
//   /alerts  -> {id, camera_id, camera_name, lat, lon, created_at, rule,
//                detail, severity, routed_to, report, verdict, clip_url}
// We additionally attach `borough` + per-camera `events` (the heat counter),
// which the frontend derives; the real backend exposes the same via /alerts.

(function () {
  // Deterministic PRNG so the demo is stable across reloads.
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(20260606);

  // 14 representative London boroughs with approximate centroids [lon, lat].
  const BOROUGHS = [
    { name: "Camden", center: [-0.1426, 51.5290], heat: 1.0 },
    { name: "Westminster", center: [-0.1372, 51.4975], heat: 0.95 },
    { name: "Southwark", center: [-0.0877, 51.5028], heat: 0.8 },
    { name: "Tower Hamlets", center: [-0.0333, 51.5099], heat: 0.78 },
    { name: "Hackney", center: [-0.0553, 51.5450], heat: 0.62 },
    { name: "Islington", center: [-0.1031, 51.5416], heat: 0.6 },
    { name: "Lambeth", center: [-0.1167, 51.4607], heat: 0.7 },
    { name: "Kensington and Chelsea", center: [-0.1938, 51.4991], heat: 0.4 },
    { name: "Hammersmith and Fulham", center: [-0.2237, 51.4927], heat: 0.35 },
    { name: "Wandsworth", center: [-0.1910, 51.4571], heat: 0.33 },
    { name: "Newham", center: [0.0333, 51.5255], heat: 0.45 },
    { name: "Greenwich", center: [0.0098, 51.4825], heat: 0.3 },
    { name: "Lewisham", center: [-0.0209, 51.4452], heat: 0.28 },
    { name: "City of London", center: [-0.0917, 51.5155], heat: 0.5 },
  ];

  const RULES = [
    { rule: "vehicle_collision", label: "Vehicle collision" },
    { rule: "person_fall", label: "Person fallen" },
    { rule: "crowd_surge", label: "Crowd surge" },
    { rule: "fire_smoke", label: "Fire / smoke" },
    { rule: "stopped_vehicle", label: "Stopped vehicle" },
    { rule: "altercation", label: "Altercation" },
  ];
  const SEVERITIES = ["P1", "P2", "P3", "P4"];
  const ROUTES = ["Met Police", "LAS (Ambulance)", "LFB (Fire)", "TfL Control"];

  function jitter(v, amt) {
    return v + (rand() - 0.5) * amt;
  }

  // --- Build cameras -------------------------------------------------------
  const CAMERAS = [];
  let camN = 1;
  BOROUGHS.forEach((b) => {
    const count = 3 + Math.floor(rand() * 4); // 3-6 cameras per borough
    for (let i = 0; i < count; i++) {
      const id = "n" + String(camN).padStart(3, "0");
      const lon = jitter(b.center[0], 0.022);
      const lat = jitter(b.center[1], 0.016);
      // Event counter scaled by borough heat (this is what drives the heatmap).
      const base = Math.pow(rand(), 1.6); // skew toward low
      const events = Math.round(base * 9800 * b.heat + rand() * 40);
      CAMERAS.push({
        id,
        name: `${b.name} Cam ${id.toUpperCase()}`,
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        available: rand() > 0.08,
        borough: b.name,
        events,
      });
      camN++;
    }
  });

  // --- Build alerts (recent, per the hottest cameras) ----------------------
  const ALERTS = [];
  const hot = [...CAMERAS].sort((a, b) => b.events - a.events);
  const now = Date.now();
  let alertId = 1;
  hot.slice(0, 24).forEach((cam, idx) => {
    const nAlerts = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < nAlerts; k++) {
      const r = RULES[Math.floor(rand() * RULES.length)];
      const sevIdx = Math.min(3, Math.floor(rand() * (idx < 6 ? 3 : 4)));
      const sev = SEVERITIES[sevIdx];
      const minsAgo = Math.floor(rand() * 220) + 1;
      ALERTS.push({
        id: alertId++,
        camera_id: cam.id,
        camera_name: cam.name,
        lat: cam.lat,
        lon: cam.lon,
        borough: cam.borough,
        created_at: new Date(now - minsAgo * 60000).toISOString(),
        rule: r.rule,
        rule_label: r.label,
        detail: { confidence: +(0.62 + rand() * 0.37).toFixed(2) },
        severity: sev,
        routed_to: ROUTES[Math.floor(rand() * ROUTES.length)],
        report:
          `${r.label} detected at ${cam.name}. ` +
          `Automated visual verification confirmed the event with ` +
          `${Math.round((0.62 + rand() * 0.37) * 100)}% confidence. ` +
          `Recommended action: dispatch nearest available unit and monitor for escalation.`,
        verdict: null,
        clip_url: null, // mock mode renders a synthetic CCTV clip
      });
    }
  });
  ALERTS.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // --- London summary (overview bottom bar) --------------------------------
  function summarise(alerts, cameras) {
    const byBorough = {};
    cameras.forEach((c) => {
      byBorough[c.borough] = byBorough[c.borough] || {
        borough: c.borough,
        events: 0,
        cameras: 0,
        alerts: 0,
        rules: {},
      };
      byBorough[c.borough].events += c.events;
      byBorough[c.borough].cameras += 1;
    });
    alerts.forEach((a) => {
      const b = byBorough[a.borough];
      if (!b) return;
      b.alerts += 1;
      b.rules[a.rule_label] = (b.rules[a.rule_label] || 0) + 1;
    });
    const ranked = Object.values(byBorough)
      .map((b) => ({
        ...b,
        topRules: Object.entries(b.rules)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 2)
          .map((e) => e[0]),
      }))
      .sort((a, b) => b.events - a.events);
    return ranked;
  }

  window.CW_MOCK = {
    BOROUGHS,
    RULES,
    CAMERAS,
    ALERTS,
    summarise,
    ruleLabel: (rule) => (RULES.find((r) => r.rule === rule) || {}).label || rule,
  };
})();
