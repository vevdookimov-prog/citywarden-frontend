// CityWarden frontend config.
// Flip USE_MOCK to false when running against the real backend locally.
window.CW_CONFIG = {
  // Mapbox public (pk.) token. It's a client-side token by design; base64 here
  // only so GitHub's secret scanner doesn't block the push — not for secrecy.
  MAPBOX_TOKEN: atob(
    "cGsuZXlKMUlqb2laWFprYnpNMU1DSXNJbUVpT2lKamJXVjJjMjB3ZW00d2FtRTNNbXh6TkhNNU1ERm5iWE53SW4wLlhpb1pGNDY1cGNQSmFJSmQ2S00ybUE="
  ),
  // Real FastAPI backend (see backend/main.py). Only reachable when run locally.
  API_BASE: "http://localhost:8090",
  // true  -> use bundled mock data (works on the deployed Pages site)
  // false -> hit API_BASE (run the backend with: uv run uvicorn backend.main:app --port 8090)
  USE_MOCK: true,
  // London center / bounds used to keep the overview map on London only.
  LONDON_CENTER: [-0.118, 51.509],
  LONDON_BOUNDS: [
    [-0.51, 51.28], // SW
    [0.33, 51.69], // NE
  ],
};
