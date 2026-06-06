// CityWarden frontend controller.
(function () {
  const cfg = window.CW_CONFIG;
  const api = window.CW_API;

  const state = {
    cameras: [],
    alerts: [],
    ranked: [],
    view: "overview", // | "detail"
    borough: null,
    dismissed: new Set(),
  };

  let map;
  let mapReady = false;
  const els = {};

  const EMPTY_FC = { type: "FeatureCollection", features: [] };
  const WORLD_RING = [
    [-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85],
  ];

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const fmtNum = (n) => n.toLocaleString("en-GB");
  function timeAgo(iso) {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  const activeAlerts = () =>
    state.alerts.filter((a) => !state.dismissed.has(a.id));

  // ---------- map ----------
  function camerasGeoJSON(list) {
    return {
      type: "FeatureCollection",
      features: list.map((c) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [c.lon, c.lat] },
        properties: {
          id: c.id,
          name: c.name,
          borough: c.borough,
          events: c.events,
          available: c.available ? 1 : 0,
        },
      })),
    };
  }

  function maxEvents(list) {
    return list.reduce((m, c) => Math.max(m, c.events), 1);
  }

  function initMap() {
    mapboxgl.accessToken = cfg.MAPBOX_TOKEN;
    map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/light-v11",
      center: cfg.LONDON_CENTER,
      zoom: 10.1,
      maxBounds: cfg.LONDON_BOUNDS,
      attributionControl: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      const mx = maxEvents(state.cameras);
      map.addSource("cameras", { type: "geojson", data: camerasGeoJSON(state.cameras) });

      // Heatmap weighted by event count.
      map.addLayer({
        id: "cam-heat",
        type: "heatmap",
        source: "cameras",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "events"], 0, 0, mx, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 1, 14, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 18, 14, 46],
          "heatmap-opacity": 0.85,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(229,72,77,0)",
            0.2, "rgba(229,72,77,0.25)",
            0.5, "rgba(229,72,77,0.55)",
            0.8, "rgba(214,36,47,0.8)",
            1, "rgba(180,20,30,0.95)",
          ],
        },
      });

      // Subtle outline of ALL boroughs so London reads as a set of areas.
      map.addSource("boroughs", { type: "geojson", data: window.CW_GEO.GEO });
      map.addLayer({
        id: "boroughs-line",
        type: "line",
        source: "boroughs",
        paint: { "line-color": "#c4ccd4", "line-width": 0.8, "line-opacity": 0.7 },
      });

      // Focus mask: dims everything outside the selected borough.
      map.addSource("focus-mask", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "focus-mask-fill",
        type: "fill",
        source: "focus-mask",
        paint: { "fill-color": "#f6f8fa", "fill-opacity": 0.78 },
      });

      // Selected borough fill + bold outline.
      map.addSource("focus", { type: "geojson", data: EMPTY_FC });
      map.addLayer({
        id: "focus-fill",
        type: "fill",
        source: "focus",
        paint: { "fill-color": "#0d1117", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: "focus-line",
        type: "line",
        source: "focus",
        paint: { "line-color": "#0d1117", "line-width": 2.4, "line-opacity": 0.9 },
      });

      // Camera dots (always visible so you can see cameras with zero heat).
      map.addLayer({
        id: "cam-dots",
        type: "circle",
        source: "cameras",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.2, 14, 6],
          "circle-color": ["case", ["==", ["get", "available"], 1], "#0d1117", "#8b949e"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.9,
        },
      });

      mapReady = true;
      if (state.view === "detail" && state.borough) setBoroughFocus(state.borough);
      wireMapInteractions();
    });
  }

  let hoverPopup;
  function wireMapInteractions() {
    hoverPopup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
    });
    map.on("mouseenter", "cam-dots", (e) => {
      map.getCanvas().style.cursor = "pointer";
      const p = e.features[0].properties;
      const recent = state.alerts.find((a) => a.camera_id === p.id);
      hoverPopup
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(
          `<div class="cw-pop-name">${p.name}</div>` +
            `<div class="cw-pop-row"><span>Borough</span><b>${p.borough}</b></div>` +
            `<div class="cw-pop-row"><span>Events</span><b>${fmtNum(p.events)}</b></div>` +
            (recent
              ? `<div class="cw-pop-row"><span>Latest</span><b>${recent.rule_label}</b></div>`
              : "") +
            (p.available ? "" : `<div class="cw-pop-off">camera offline</div>`)
        )
        .addTo(map);
    });
    map.on("mouseleave", "cam-dots", () => {
      map.getCanvas().style.cursor = "";
      hoverPopup.remove();
    });
    map.on("click", "cam-dots", (e) => {
      const b = e.features[0].properties.borough;
      if (b) enterBorough(b);
    });
  }

  function setBoroughFocus(name) {
    const f = window.CW_GEO.featureByName[name];
    if (!f) return;
    map.getSource("focus").setData(f);
    map.getSource("focus-mask").setData({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [WORLD_RING, f.geometry.coordinates[0]],
      },
    });
    const b = window.CW_GEO.featureBounds(f);
    map.fitBounds(b, { padding: 70, maxZoom: 14.5, duration: 850 });
  }

  function clearBoroughFocus() {
    map.getSource("focus").setData(EMPTY_FC);
    map.getSource("focus-mask").setData(EMPTY_FC);
    map.fitBounds(cfg.LONDON_BOUNDS, { padding: 30, duration: 800 });
  }

  // ---------- overview: borough list ----------
  function renderBoroughList(filter = "") {
    const f = filter.trim().toLowerCase();
    const items = state.ranked.filter((b) =>
      b.borough.toLowerCase().includes(f)
    );
    const mx = state.ranked.length ? state.ranked[0].events : 1;
    els.boroughList.innerHTML =
      items
        .map((b) => {
          const rank = state.ranked.indexOf(b) + 1;
          return `
      <li class="borough-item" data-borough="${b.borough}">
        <span class="bi-rank">${rank}</span>
        <div style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <span class="bi-name">${b.borough}</span>
            <span class="bi-meta">${fmtNum(b.events)} ev · ${b.alerts} alerts</span>
          </div>
          <div class="bi-bar" style="width:${Math.max(4, (b.events / mx) * 100)}%"></div>
        </div>
      </li>`;
        })
        .join("") || `<li class="empty">No boroughs match "${filter}".</li>`;
    els.boroughList.querySelectorAll(".borough-item").forEach((li) => {
      li.addEventListener("click", () => enterBorough(li.dataset.borough));
    });
  }

  // ---------- overview: London summary ----------
  function renderSummary() {
    const totalEvents = state.cameras.reduce((s, c) => s + c.events, 0);
    const totalAlerts = activeAlerts().length;
    const p1 = activeAlerts().filter((a) => a.severity === "P1").length;
    els.summaryKpis.innerHTML = `
      <div class="kpi"><div class="kpi-num">${fmtNum(state.cameras.length)}</div><div class="kpi-label">Cameras</div></div>
      <div class="kpi"><div class="kpi-num">${fmtNum(totalEvents)}</div><div class="kpi-label">Events</div></div>
      <div class="kpi"><div class="kpi-num">${fmtNum(totalAlerts)}</div><div class="kpi-label">Live alerts</div></div>
      <div class="kpi"><div class="kpi-num" style="color:var(--heat)">${p1}</div><div class="kpi-label">P1 critical</div></div>`;

    const top = state.ranked[0];
    els.summarySub.textContent = top
      ? `${top.borough} has the highest incident rate right now — leading on ${
          top.topRules.join(" & ") || "varied incidents"
        }.`
      : "Live across the network.";

    const mx = state.ranked.length ? state.ranked[0].events : 1;
    els.summaryRank.innerHTML = state.ranked
      .slice(0, 10)
      .map(
        (b, i) => `
      <div class="rank-card" data-borough="${b.borough}">
        <div class="rank-top">
          <span class="rank-pos">#${i + 1}</span>
          <span class="rank-name">${b.borough}</span>
        </div>
        <div class="rank-events">${fmtNum(b.events)} events · ${b.alerts} alerts</div>
        <div class="rank-track"><div class="rank-fill" style="width:${(b.events / mx) * 100}%"></div></div>
        <div class="rank-rules">${
          b.topRules.length ? "Top: " + b.topRules.join(", ") : "No active alerts"
        }</div>
      </div>`
      )
      .join("");
    els.summaryRank.querySelectorAll(".rank-card").forEach((c) => {
      c.addEventListener("click", () => enterBorough(c.dataset.borough));
    });
  }

  // ---------- detail view ----------
  function enterBorough(name) {
    state.view = "detail";
    state.borough = name;
    document.body.classList.remove("view-overview");
    document.body.classList.add("view-detail");
    renderDetail();
    if (mapReady) {
      setTimeout(() => map.resize(), 80);
      setBoroughFocus(name);
    }
  }

  function exitBorough() {
    state.view = "overview";
    state.borough = null;
    document.body.classList.remove("view-detail");
    document.body.classList.add("view-overview");
    if (mapReady) {
      setTimeout(() => map.resize(), 80);
      clearBoroughFocus();
    }
  }

  function renderDetail() {
    const name = state.borough;
    const cams = state.cameras.filter((c) => c.borough === name);
    const alerts = activeAlerts().filter((a) => a.borough === name);
    const events = cams.reduce((s, c) => s + c.events, 0);
    const rank = state.ranked.findIndex((b) => b.borough === name) + 1;

    els.detailName.textContent = name;
    els.detailSub.textContent = alerts.length
      ? `Here's what's happening in ${name} — ${alerts.length} live alert${
          alerts.length > 1 ? "s" : ""
        } across ${cams.length} cameras.`
      : `${name} is quiet right now — ${cams.length} cameras monitored, no live alerts.`;

    els.detailStats.innerHTML = `
      <div class="stat"><div class="stat-num">#${rank || "—"}</div><div class="stat-label">London rank</div></div>
      <div class="stat"><div class="stat-num">${fmtNum(events)}</div><div class="stat-label">Events</div></div>
      <div class="stat"><div class="stat-num">${cams.length}</div><div class="stat-label">Cameras</div></div>`;

    renderAlertList(alerts);
  }

  function renderAlertList(alerts) {
    if (!alerts.length) {
      els.alertList.innerHTML = `<li class="empty">No live alerts in this borough.</li>`;
      return;
    }
    els.alertList.innerHTML = alerts
      .map(
        (a) => `
      <li class="alert-item" data-id="${a.id}">
        <div class="alert-top">
          <span class="sev-badge sev-${a.severity}">${a.severity}</span>
          <span class="alert-rule">${a.rule_label}</span>
          <span class="alert-time">${timeAgo(a.created_at)}</span>
        </div>
        <div class="alert-sub">${a.camera_name} · routed to ${a.routed_to || "—"}</div>
      </li>`
      )
      .join("");
    els.alertList.querySelectorAll(".alert-item").forEach((li) => {
      li.addEventListener("click", () => openModal(+li.dataset.id));
    });
  }

  // ---------- modal ----------
  function clipMarkup(a) {
    if (a.clip_url) {
      return `<div class="clip"><video src="${a.clip_url}" controls autoplay muted playsinline></video></div>`;
    }
    const ts = new Date(a.created_at).toLocaleString("en-GB");
    return `
      <div class="clip"><div class="cctv">
        <div class="cctv-rec"><span class="dot"></span> REC</div>
        <div class="cctv-center">
          <div class="cctv-box"></div>
          <div class="tag">${a.rule_label.toUpperCase()} DETECTED</div>
        </div>
        <div class="cctv-meta">${a.camera_name} · ${a.camera_id.toUpperCase()}</div>
        <div class="cctv-ts">${ts}</div>
      </div></div>`;
  }

  function openModal(id) {
    const a = state.alerts.find((x) => x.id === id);
    if (!a) return;
    const conf = a.detail && a.detail.confidence ? Math.round(a.detail.confidence * 100) + "%" : "—";
    els.modalBody.innerHTML = `
      ${clipMarkup(a)}
      <div class="modal-meta">
        <div class="modal-rule">
          <span class="sev-badge sev-${a.severity}">${a.severity}</span>
          <h3>${a.rule_label}</h3>
        </div>
        <div class="modal-grid">
          <div class="mg-item"><span>Camera</span>${a.camera_name}</div>
          <div class="mg-item"><span>Borough</span>${a.borough}</div>
          <div class="mg-item"><span>Detected</span>${timeAgo(a.created_at)}</div>
          <div class="mg-item"><span>Confidence</span>${conf}</div>
          <div class="mg-item"><span>Routed to</span>${a.routed_to || "—"}</div>
          <div class="mg-item"><span>Alert ID</span>#${a.id}</div>
        </div>
        <div class="modal-report">${a.report}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-dismiss" id="act-dismiss">Dismiss</button>
        <button class="btn btn-act" id="act-on">Act on</button>
      </div>`;
    els.modalBackdrop.hidden = false;
    $("act-dismiss").addEventListener("click", () => resolveAlert(a, "dismissed"));
    $("act-on").addEventListener("click", () => resolveAlert(a, "confirmed"));
  }

  function closeModal() {
    els.modalBackdrop.hidden = true;
    els.modalBody.innerHTML = "";
  }

  async function resolveAlert(a, verdict) {
    state.dismissed.add(a.id); // dismiss removes it; act-on routes & clears from queue
    await api.setVerdict(a.id, verdict);
    closeModal();
    toast(
      verdict === "dismissed"
        ? `Alert #${a.id} dismissed & clip deleted.`
        : `Acting on alert #${a.id} — dispatched to ${a.routed_to || "control"}.`
    );
    if (state.view === "detail") renderDetail();
    renderSummary();
  }

  let toastTimer;
  function toast(msg) {
    let t = $("cw-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "cw-toast";
      t.className = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // ---------- boot ----------
  async function boot() {
    els.boroughList = $("borough-list");
    els.boroughSearch = $("borough-search");
    els.summaryKpis = $("summary-kpis");
    els.summarySub = $("summary-sub");
    els.summaryRank = $("summary-rank");
    els.detailName = $("detail-borough-name");
    els.detailSub = $("detail-borough-sub");
    els.detailStats = $("detail-stats");
    els.alertList = $("alert-list");
    els.modalBackdrop = $("modal-backdrop");
    els.modalBody = $("modal-body");

    [state.cameras, state.alerts] = await Promise.all([
      api.getCameras(),
      api.getAlerts(500),
    ]);
    state.ranked = api.summarise(state.alerts, state.cameras);

    renderBoroughList();
    renderSummary();
    initMap();

    els.boroughSearch.addEventListener("input", (e) =>
      renderBoroughList(e.target.value)
    );
    els.boroughSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = state.ranked.filter((b) =>
          b.borough.toLowerCase().includes(e.target.value.trim().toLowerCase())
        )[0];
        if (first) enterBorough(first.borough);
      }
    });
    $("back-btn").addEventListener("click", exitBorough);
    $("map-back-btn").addEventListener("click", exitBorough);
    $("modal-close").addEventListener("click", closeModal);
    els.modalBackdrop.addEventListener("click", (e) => {
      if (e.target === els.modalBackdrop) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!els.modalBackdrop.hidden) closeModal();
        else if (state.view === "detail") exitBorough();
      }
    });
  }

  boot();
})();
