# Aether | Real-Time Weather Dashboard 🌦️

A dynamic, ultra-responsive weather dashboard single-page application built with vanilla HTML5, CSS3, and ES6+ JavaScript. Powered by Open-Meteo's open public REST API (no API key required).

---

## ✨ Features

- **Live Meteorological Metrics:**
  - Real-time temperature and apparent ("Feels like") temperature.
  - Humidity percentage with descriptive comfort indicators.
  - Wind velocity and 16-point compass directions with dynamic rotating compass needles.
  - Precipitation accumulation and probability.
  - Day/Night diurnal indicators.

- **24-Hour Horizon Strip:**
  - Horizontally scrollable strip displaying the next 24 consecutive hours.
  - Smooth custom purple scrollbar and dedicated navigation arrows.
  - Hour labels, condition icons, temperatures, and precipitation probabilities.

- **7-Day Extended Forecast:**
  - Multi-day outlook with custom day names, dates, and weather conditions.
  - Proportional visual temperature gradient bars comparing daily lows and highs.
  - Daily precipitation totals.

- **Client-Side Instant Unit Toggle:**
  - Seamlessly switch between **Metric** (°C, km/h, mm) and **Imperial** (°F, mph, in).
  - All values recalculate instantly on the client without requiring a new network request.
  - Unit preferences automatically persist in `localStorage`.

- **Smart Search & Recent Locations:**
  - Input validation (rejects empty or numeric-only queries).
  - Saves the last 5 searches to `localStorage` as clickable chips with removal buttons.
  - Loads the last searched city automatically upon startup.
  - Keyboard shortcut: Press `/` anywhere to focus the search bar.

- **Resilient Error Handling & Network Awareness:**
  - Uses `AbortController` to cancel pending in-flight requests whenever a new search begins.
  - Automatic 10-second request timeout.
  - User-friendly error banners (never raw unhandled exceptions) with an interactive **Retry** button.
  - Graceful handling of city-not-found, offline states, timeouts, and rate limits.
  - Loading skeleton screen and animated spinner.

- **Luxury Violet / Purple Glassmorphism Aesthetic:**
  - Deep space and cosmic purple gradients.
  - Layered ambient floating glowing light orbs.
  - Frosted glass cards (`backdrop-filter: blur(20px)`).
  - Day / Night dynamic themes and atmospheric condition adaptations (Rain, Thunderstorm).
  - Crisp modern typography via Google Fonts (Outfit & Plus Jakarta Sans).

---

## 🚀 How to Run the App

Because this is a 100% vanilla web application with zero external framework dependencies or build steps, you can run it in multiple convenient ways:

### Option 1: Direct File Opening
Double-click `index.html` in your file explorer or open it directly in any modern browser:
```bash
# Windows
start index.html
```

### Option 2: Local HTTP Server (Recommended)
You can use Python, Node, or VS Code Live Server:

**Using Python 3:**
```bash
python -m http.server 3000
```
Then visit `http://localhost:3000` in your browser.

**Using npx serve / http-server:**
```bash
npx serve .
```

---

## 🛠️ Architecture & APIs

- **Geocoding API:** `https://geocoding-api.open-meteo.com/v1/search?name={city}&count=1`
- **Forecast API:** `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=...&daily=...&hourly=...&timezone=auto`
- **Modular Code Organization:**
  - `index.html` — Accessible, semantic HTML5 structure with ARIA live regions and loading skeletons.
  - `style.css` — Custom purple design system, CSS grid/flexbox, keyframe animations, and responsive media queries.
  - `script.js` — Self-executing closure (IIFE) with separated async functions (`getCoordinates`, `getWeather`, `renderWeather`), unit conversions, and state management.

---

## 📋 Acceptance Criteria Checklist

- [x] Searching "Chennai", "London", or "New York" shows live temperature, humidity, and wind speed.
- [x] Searching invalid strings (e.g. "asdfghjkl") shows a clear "City not found" message without crashing.
- [x] Going offline and searching shows a network error with a working "Retry" button.
- [x] The UI never freezes or gets stuck in a loading state (`finally` block guarantee).
- [x] The unit toggle updates all values across hero, metrics, hourly, and 7-day cards instantly.
- [x] Purple color scheme with glowing animations and glassmorphic aesthetic.
