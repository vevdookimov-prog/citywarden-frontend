// Bundled mock data. Cameras are sampled INSIDE the real borough polygons
// (window.CW_BOROUGHS_GEO from boroughs.js) so heat + boundaries line up.
// Shapes mirror backend/main.py (/cameras, /alerts).

(function () {
  const GEO = window.CW_BOROUGHS_GEO;

  // ---- geometry helpers (exposed as CW_GEO) ----
  function ringBounds(ring, b) {
    for (const [x, y] of ring) {
      if (x < b[0][0]) b[0][0] = x;
      if (y < b[0][1]) b[0][1] = y;
      if (x > b[1][0]) b[1][0] = x;
      if (y > b[1][1]) b[1][1] = y;
    }
    return b;
  }
  function featureBounds(f) {
    const b = [[Infinity, Infinity], [-Infinity, -Infinity]];
    f.geometry.coordinates.forEach((r) => ringBounds(r, b));
    return b;
  }
  function featureCenter(f) {
    const b = featureBounds(f);
    return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  }
  function pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }
  function pointInFeature(x, y, f) {
    const rings = f.geometry.coordinates;
    if (!pointInRing(x, y, rings[0])) return false;
    for (let k = 1; k < rings.length; k++)
      if (pointInRing(x, y, rings[k])) return false; // hole
    return true;
  }
  const featureByName = {};
  GEO.features.forEach((f) => (featureByName[f.properties.name] = f));

  function boroughOf(lon, lat) {
    for (const f of GEO.features)
      if (pointInFeature(lon, lat, f)) return f.properties.name;
    return null;
  }

  window.CW_GEO = {
    GEO,
    featureByName,
    featureBounds,
    featureCenter,
    pointInFeature,
    boroughOf,
  };

  // ---- deterministic PRNG ----
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

  // Relative incident pressure per borough (others default to ~0.18).
  const HEAT = {
    Camden: 1.0, Westminster: 0.96, Southwark: 0.82, "Tower Hamlets": 0.8,
    Lambeth: 0.74, Hackney: 0.64, Islington: 0.62, "City of London": 0.55,
    Newham: 0.5, "Kensington and Chelsea": 0.42, "Hammersmith and Fulham": 0.36,
    Wandsworth: 0.34, Greenwich: 0.32, Lewisham: 0.3, Haringey: 0.3,
    Brent: 0.28, Ealing: 0.26, Croydon: 0.26, "Waltham Forest": 0.24,
  };
  const heatOf = (name) => (name in HEAT ? HEAT[name] : 0.18);

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

  // ---- build cameras inside each borough ----
  const CAMERAS = [];
  const BOROUGHS = [];
  let camN = 1;
  GEO.features.forEach((f) => {
    const name = f.properties.name;
    const heat = heatOf(name);
    const b = featureBounds(f);
    const center = featureCenter(f);
    BOROUGHS.push({ name, center, bounds: b, heat });

    const count = 3 + Math.floor(rand() * 4); // 3-6
    let placed = 0;
    let guard = 0;
    while (placed < count && guard < 400) {
      guard++;
      const lon = b[0][0] + rand() * (b[1][0] - b[0][0]);
      const lat = b[0][1] + rand() * (b[1][1] - b[0][1]);
      if (!pointInFeature(lon, lat, f)) continue;
      const id = "n" + String(camN).padStart(3, "0");
      const base = Math.pow(rand(), 1.6);
      const events = Math.round(base * 9800 * heat + rand() * 30);
      CAMERAS.push({
        id,
        name: `${name} Cam ${id.toUpperCase()}`,
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        available: rand() > 0.08,
        borough: name,
        events,
      });
      camN++;
      placed++;
    }
  });

  // ---- alerts from the hottest cameras ----
  const ALERTS = [];
  const hot = [...CAMERAS].sort((a, b) => b.events - a.events);
  const now = Date.now();
  let alertId = 1;
  hot.slice(0, 30).forEach((cam, idx) => {
    const nAlerts = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < nAlerts; k++) {
      const r = RULES[Math.floor(rand() * RULES.length)];
      const sevIdx = Math.min(3, Math.floor(rand() * (idx < 8 ? 3 : 4)));
      const sev = SEVERITIES[sevIdx];
      const minsAgo = Math.floor(rand() * 220) + 1;
      const conf = +(0.62 + rand() * 0.37).toFixed(2);
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
        detail: { confidence: conf },
        severity: sev,
        routed_to: ROUTES[Math.floor(rand() * ROUTES.length)],
        report:
          `${r.label} detected at ${cam.name}. ` +
          `Automated visual verification confirmed the event with ` +
          `${Math.round(conf * 100)}% confidence. Recommended action: ` +
          `dispatch nearest available unit and monitor for escalation.`,
        verdict: null,
        clip_url: null,
      });
    }
  });
  ALERTS.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  function summarise(alerts, cameras) {
    const byB = {};
    cameras.forEach((c) => {
      byB[c.borough] = byB[c.borough] || {
        borough: c.borough, events: 0, cameras: 0, alerts: 0, rules: {},
      };
      byB[c.borough].events += c.events;
      byB[c.borough].cameras += 1;
    });
    alerts.forEach((a) => {
      const b = byB[a.borough];
      if (!b) return;
      b.alerts += 1;
      b.rules[a.rule_label] = (b.rules[a.rule_label] || 0) + 1;
    });
    return Object.values(byB)
      .map((b) => ({
        ...b,
        topRules: Object.entries(b.rules)
          .sort((x, y) => y[1] - x[1])
          .slice(0, 2)
          .map((e) => e[0]),
      }))
      .sort((a, b) => b.events - a.events);
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
