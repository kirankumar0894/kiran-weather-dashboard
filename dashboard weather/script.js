/**
 * ============================================================================
 * AETHER REAL-TIME WEATHER DASHBOARD
 * Single-Page Vanilla JavaScript ES6+ Architecture
 * 
 * Features:
 * - Asynchronous data fetching with Fetch API & async/await
 * - AbortController request cancellation & 10s timeout management
 * - Robust error handling (offline, timeouts, 4xx/5xx, rate-limiting, not found)
 * - WMO weather code mapping to rich animated SVG icons
 * - Client-side instant Metric / Imperial unit conversions (°C/°F, km/h/mph, mm/in)
 * - LocalStorage history for up to 5 recent search chips
 * - Dynamic Day / Night & weather condition theme transitions
 * ============================================================================
 */

(() => {
  'use strict';

  /* ==========================================================================
     NAMED CONSTANTS & CONFIGURATION
     ========================================================================== */
  const API_CONFIG = {
    GEOCODING_URL: 'https://geocoding-api.open-meteo.com/v1/search',
    FORECAST_URL: 'https://api.open-meteo.com/v1/forecast',
    TIMEOUT_MS: 10000, // 10-second timeout requirement
    MAX_RECENT_SEARCHES: 5,
    STORAGE_KEYS: {
      RECENT: 'aether_weather_recent_searches_v1',
      UNIT: 'aether_weather_unit_pref_v1',
      LAST_CITY: 'aether_weather_last_city_v1'
    },
    DEFAULT_CITY: 'Chennai'
  };

  /* ==========================================================================
     APPLICATION STATE
     ========================================================================== */
  const state = {
    currentUnit: 'metric', // 'metric' (°C, km/h, mm) | 'imperial' (°F, mph, in)
    currentWeatherData: null,
    currentLocation: null,
    recentSearches: [],
    activeAbortController: null,
    activeTimeoutId: null,
    lastFailedSearch: null,
    isRequestInFlight: false
  };

  /* ==========================================================================
     DOM ELEMENTS
     ========================================================================== */
  const DOM = {
    body: document.body,
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    searchBtn: document.getElementById('search-btn'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    btnText: document.querySelector('.btn-text'),
    btnLoader: document.querySelector('.btn-loader'),
    btnIcon: document.querySelector('.btn-icon'),
    recentChipsList: document.getElementById('recent-chips-list'),
    clearRecentBtn: document.getElementById('clear-recent-btn'),
    unitSwitch: document.getElementById('unit-switch'),
    connectionStatus: document.getElementById('connection-status'),
    connectionLabel: document.getElementById('connection-label'),
    errorBanner: document.getElementById('error-banner'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    dismissErrorBtn: document.getElementById('dismiss-error-btn'),
    loadingSkeleton: document.getElementById('loading-skeleton'),
    weatherDisplay: document.getElementById('weather-display'),
    toastContainer: document.getElementById('toast-container')
  };

  /* ==========================================================================
     SECURITY & SANITIZATION HELPERS
     ========================================================================== */
  function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ==========================================================================
     UNIT CONVERSIONS & FORMATTERS
     ========================================================================== */
  const Units = {
    toFahrenheit: (celsius) => (celsius * 9) / 5 + 32,
    toCelsius: (fahrenheit) => ((fahrenheit - 32) * 5) / 9,
    toMph: (kmh) => kmh * 0.621371,
    toInches: (mm) => mm * 0.0393701,

    formatTemp: (valInCelsius, targetUnit = state.currentUnit) => {
      if (valInCelsius == null || isNaN(valInCelsius)) return 'N/A';
      const num = targetUnit === 'imperial' 
        ? Math.round(Units.toFahrenheit(valInCelsius))
        : Math.round(valInCelsius);
      return `${num}°`;
    },

    formatSpeed: (valInKmh, targetUnit = state.currentUnit) => {
      if (valInKmh == null || isNaN(valInKmh)) return 'N/A';
      if (targetUnit === 'imperial') {
        return `${Math.round(Units.toMph(valInKmh))} mph`;
      }
      return `${Math.round(valInKmh)} km/h`;
    },

    formatPrecip: (valInMm, targetUnit = state.currentUnit) => {
      if (valInMm == null || isNaN(valInMm)) return '0.0 mm';
      if (targetUnit === 'imperial') {
        return `${Units.toInches(valInMm).toFixed(2)} in`;
      }
      return `${Number(valInMm).toFixed(1)} mm`;
    },

    degreesToCompass: (degrees) => {
      if (degrees == null || isNaN(degrees)) return { label: 'N/A', deg: 0 };
      const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const index = Math.round((degrees % 360) / 22.5) % 16;
      return {
        label: directions[index],
        deg: degrees
      };
    }
  };

  /* ==========================================================================
     WMO WEATHER CODE MAPPINGS & SVG ICONS
     Maps WMO code to condition text, category, and curated SVG graphics
     ========================================================================== */
  const WMO_CODES = {
    0: { desc: 'Clear Sky', icon: 'clear', category: 'clear' },
    1: { desc: 'Mainly Clear', icon: 'partly-cloudy', category: 'cloudy' },
    2: { desc: 'Partly Cloudy', icon: 'partly-cloudy', category: 'cloudy' },
    3: { desc: 'Overcast', icon: 'overcast', category: 'cloudy' },
    45: { desc: 'Foggy', icon: 'fog', category: 'fog' },
    48: { desc: 'Rime Fog', icon: 'fog', category: 'fog' },
    51: { desc: 'Light Drizzle', icon: 'drizzle', category: 'rain' },
    53: { desc: 'Moderate Drizzle', icon: 'drizzle', category: 'rain' },
    55: { desc: 'Dense Drizzle', icon: 'drizzle', category: 'rain' },
    56: { desc: 'Freezing Drizzle', icon: 'freezing-rain', category: 'snow' },
    57: { desc: 'Dense Freezing Drizzle', icon: 'freezing-rain', category: 'snow' },
    61: { desc: 'Slight Rain', icon: 'rain', category: 'rain' },
    63: { desc: 'Moderate Rain', icon: 'rain', category: 'rain' },
    65: { desc: 'Heavy Rain', icon: 'heavy-rain', category: 'rain' },
    66: { desc: 'Freezing Rain', icon: 'freezing-rain', category: 'snow' },
    67: { desc: 'Heavy Freezing Rain', icon: 'freezing-rain', category: 'snow' },
    71: { desc: 'Slight Snow', icon: 'snow', category: 'snow' },
    73: { desc: 'Moderate Snow', icon: 'snow', category: 'snow' },
    75: { desc: 'Heavy Snow', icon: 'heavy-snow', category: 'snow' },
    77: { desc: 'Snow Grains', icon: 'snow', category: 'snow' },
    80: { desc: 'Slight Showers', icon: 'rain', category: 'rain' },
    81: { desc: 'Moderate Showers', icon: 'heavy-rain', category: 'rain' },
    82: { desc: 'Violent Showers', icon: 'heavy-rain', category: 'rain' },
    85: { desc: 'Slight Snow Showers', icon: 'snow', category: 'snow' },
    86: { desc: 'Heavy Snow Showers', icon: 'heavy-snow', category: 'snow' },
    95: { desc: 'Thunderstorm', icon: 'thunderstorm', category: 'thunder' },
    96: { desc: 'Thunderstorm & Hail', icon: 'thunderstorm', category: 'thunder' },
    99: { desc: 'Severe Hail Thunderstorm', icon: 'thunderstorm', category: 'thunder' }
  };

  function getWeatherMetadata(code, isDay = 1) {
    const defaultMeta = { desc: 'Fair', icon: 'clear', category: 'clear' };
    const meta = WMO_CODES[code] || defaultMeta;
    return {
      description: meta.desc,
      category: meta.category,
      iconType: meta.icon,
      isDay: Boolean(isDay)
    };
  }

  /**
   * Generates SVG weather icons with glowing accents
   */
  function getWeatherSvg(iconType, isDay = true, size = 48) {
    const s = size;
    switch (iconType) {
      case 'clear':
        if (isDay) {
          return `
            <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
              <circle cx="32" cy="32" r="14" fill="url(#sun-grad)"/>
              <g stroke="#fbbf24" stroke-width="3" stroke-linecap="round">
                <line x1="32" y1="6" x2="32" y2="12"/>
                <line x1="32" y1="52" x2="32" y2="58"/>
                <line x1="6" y1="32" x2="12" y2="32"/>
                <line x1="52" y1="32" x2="58" y2="32"/>
                <line x1="13.6" y1="13.6" x2="17.8" y2="17.8"/>
                <line x1="46.2" y1="46.2" x2="50.4" y2="50.4"/>
                <line x1="13.6" y1="50.4" x2="17.8" y2="46.2"/>
                <line x1="46.2" y1="17.8" x2="50.4" y2="13.6"/>
              </g>
              <defs>
                <radialGradient id="sun-grad" cx="30%" cy="30%" r="70%">
                  <stop offset="0%" stop-color="#fef08a"/>
                  <stop offset="100%" stop-color="#f59e0b"/>
                </radialGradient>
              </defs>
            </svg>
          `;
        } else {
          return `
            <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
              <path d="M38 12a20 20 0 1 0 14 34.3A22 22 0 0 1 38 12z" fill="url(#moon-grad)"/>
              <circle cx="48" cy="18" r="1.5" fill="#fde047"/>
              <circle cx="52" cy="30" r="1" fill="#fde047"/>
              <defs>
                <radialGradient id="moon-grad" cx="40%" cy="40%" r="60%">
                  <stop offset="0%" stop-color="#e9d5ff"/>
                  <stop offset="100%" stop-color="#a855f7"/>
                </radialGradient>
              </defs>
            </svg>
          `;
        }

      case 'partly-cloudy':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <circle cx="26" cy="24" r="10" fill="${isDay ? '#f59e0b' : '#c084fc'}" opacity="0.9"/>
            <path d="M46 48H20a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 48 28a10 10 0 0 1-2 20z" fill="url(#cloud-grad)" filter="drop-shadow(0 4px 6px rgba(0,0,0,0.3))"/>
            <defs>
              <linearGradient id="cloud-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="100%" stop-color="#cbd5e1"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'overcast':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <path d="M44 38H18a10 10 0 0 1 0-20 10 10 0 0 1 4 .8A12 12 0 0 1 44 22a8 8 0 0 1 0 16z" fill="#94a3b8" opacity="0.7"/>
            <path d="M50 50H22a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 50 30a10 10 0 0 1 0 20z" fill="url(#dark-cloud)"/>
            <defs>
              <linearGradient id="dark-cloud" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#e2e8f0"/>
                <stop offset="100%" stop-color="#64748b"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'rain':
      case 'drizzle':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <path d="M46 42H20a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 48 22a10 10 0 0 1-2 20z" fill="url(#rain-cloud)"/>
            <g stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round">
              <line x1="22" y1="48" x2="18" y2="56"/>
              <line x1="32" y1="48" x2="28" y2="56"/>
              <line x1="42" y1="48" x2="38" y2="56"/>
            </g>
            <defs>
              <linearGradient id="rain-cloud" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#cbd5e1"/>
                <stop offset="100%" stop-color="#475569"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'heavy-rain':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <path d="M48 40H20a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 50 20a10 10 0 0 1-2 20z" fill="url(#heavy-cloud)"/>
            <g stroke="#0284c7" stroke-width="3" stroke-linecap="round">
              <line x1="20" y1="46" x2="15" y2="58"/>
              <line x1="29" y1="46" x2="24" y2="58"/>
              <line x1="38" y1="46" x2="33" y2="58"/>
              <line x1="47" y1="46" x2="42" y2="58"/>
            </g>
            <defs>
              <linearGradient id="heavy-cloud" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#94a3b8"/>
                <stop offset="100%" stop-color="#334155"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'thunderstorm':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <path d="M46 38H20a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 48 18a10 10 0 0 1-2 20z" fill="url(#thunder-cloud)"/>
            <polygon points="30,40 24,50 31,50 27,60 38,47 31,47" fill="#fbbf24" stroke="#f59e0b" stroke-width="1.5"/>
            <defs>
              <linearGradient id="thunder-cloud" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#64748b"/>
                <stop offset="100%" stop-color="#1e1b4b"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'snow':
      case 'heavy-snow':
      case 'freezing-rain':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <path d="M46 38H20a12 12 0 0 1 0-24 12.2 12.2 0 0 1 4.5.9A14 14 0 0 1 48 18a10 10 0 0 1-2 20z" fill="url(#snow-cloud)"/>
            <circle cx="22" cy="48" r="2.5" fill="#e0f2fe"/>
            <circle cx="32" cy="54" r="2.5" fill="#e0f2fe"/>
            <circle cx="42" cy="48" r="2.5" fill="#e0f2fe"/>
            <defs>
              <linearGradient id="snow-cloud" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#f8fafc"/>
                <stop offset="100%" stop-color="#94a3b8"/>
              </linearGradient>
            </defs>
          </svg>
        `;

      case 'fog':
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none" stroke="#cbd5e1" stroke-width="3" stroke-linecap="round">
            <line x1="16" y1="24" x2="48" y2="24"/>
            <line x1="12" y1="34" x2="52" y2="34"/>
            <line x1="18" y1="44" x2="46" y2="44"/>
            <line x1="22" y1="52" x2="42" y2="52"/>
          </svg>
        `;

      default:
        return `
          <svg viewBox="0 0 64 64" width="${s}" height="${s}" fill="none">
            <circle cx="32" cy="32" r="14" fill="#a855f7"/>
          </svg>
        `;
    }
  }

  /* ==========================================================================
     CORE ASYNC DATA FETCHING FUNCTIONS (Fetch API + async/await)
     ========================================================================== */

  /**
   * 1. Fetches geographical coordinates for a given city query
   * @param {string} city - Cleaned city name
   * @param {AbortSignal} signal - Cancellation signal
   * @returns {Promise<Object>} Location metadata (name, country, lat, lon, timezone)
   */
  async function getCoordinates(city, signal) {
    const encodedCity = encodeURIComponent(city.trim());
    const url = `${API_CONFIG.GEOCODING_URL}?name=${encodedCity}&count=1`;

    let response;
    try {
      response = await fetch(url, { signal });
    } catch (networkErr) {
      if (networkErr.name === 'AbortError') throw networkErr;
      if (!navigator.onLine) {
        throw new Error('OFFLINE');
      }
      throw new Error('NETWORK_FAILURE');
    }

    if (!response.ok) {
      if (response.status === 429) throw new Error('RATE_LIMITED');
      throw new Error(`HTTP_ERROR_${response.status}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (e) {
      throw new Error('MALFORMED_JSON');
    }

    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
      throw new Error('CITY_NOT_FOUND');
    }

    const first = data.results[0];
    return {
      id: first.id,
      name: first.name,
      country: first.country || first.country_code || '',
      countryCode: first.country_code || '',
      admin1: first.admin1 || '',
      latitude: first.latitude,
      longitude: first.longitude,
      timezone: first.timezone || 'auto'
    };
  }

  /**
   * 2. Fetches atmospheric forecast data for given latitude & longitude
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * @param {string} timezone - Timezone string or 'auto'
   * @param {AbortSignal} signal - Cancellation signal
   * @returns {Promise<Object>} Open-Meteo forecast JSON
   */
  async function getWeather(lat, lon, timezone = 'auto', signal) {
    const currentParams = [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'wind_speed_10m',
      'wind_direction_10m',
      'weather_code',
      'is_day'
    ].join(',');

    const dailyParams = [
      'temperature_2m_max',
      'temperature_2m_min',
      'precipitation_sum',
      'weather_code'
    ].join(',');

    const hourlyParams = [
      'temperature_2m',
      'weather_code',
      'precipitation_probability'
    ].join(',');

    const url = `${API_CONFIG.FORECAST_URL}?latitude=${lat}&longitude=${lon}&current=${currentParams}&daily=${dailyParams}&hourly=${hourlyParams}&timezone=${encodeURIComponent(timezone)}`;

    let response;
    try {
      response = await fetch(url, { signal });
    } catch (networkErr) {
      if (networkErr.name === 'AbortError') throw networkErr;
      if (!navigator.onLine) {
        throw new Error('OFFLINE');
      }
      throw new Error('NETWORK_FAILURE');
    }

    if (!response.ok) {
      if (response.status === 429) throw new Error('RATE_LIMITED');
      throw new Error(`HTTP_ERROR_${response.status}`);
    }

    let forecastData;
    try {
      forecastData = await response.json();
    } catch (e) {
      throw new Error('MALFORMED_JSON');
    }

    if (!forecastData || !forecastData.current) {
      throw new Error('INVALID_WEATHER_DATA');
    }

    return forecastData;
  }

  /* ==========================================================================
     THEMING & BACKGROUND CONTROLLER
     Dynamically sets day/night and weather condition ambient theme
     ========================================================================== */
  function applyTheme(isDay, weatherCategory) {
    DOM.body.classList.remove('theme-day', 'theme-night', 'condition-rain', 'condition-thunder');

    if (isDay) {
      DOM.body.classList.add('theme-day');
    } else {
      DOM.body.classList.add('theme-night');
    }

    if (weatherCategory === 'rain') {
      DOM.body.classList.add('condition-rain');
    } else if (weatherCategory === 'thunder') {
      DOM.body.classList.add('condition-thunder');
    }
  }

  /* ==========================================================================
     RENDER WEATHER DASHBOARD (Dynamic DOM Construction)
     ========================================================================== */
  function renderWeather(data, location) {
    if (!data || !location) return;

    const current = data.current || {};
    const daily = data.daily || {};
    const hourly = data.hourly || {};

    // Safe extraction with nullish coalescing
    const tempCelsius = current.temperature_2m ?? null;
    const feelsCelsius = current.apparent_temperature ?? null;
    const humidity = current.relative_humidity_2m ?? 'N/A';
    const windSpeedKmh = current.wind_speed_10m ?? null;
    const windDirectionDeg = current.wind_direction_10m ?? 0;
    const weatherCode = current.weather_code ?? 0;
    const isDay = current.is_day ?? 1;

    const weatherMeta = getWeatherMetadata(weatherCode, isDay);
    applyTheme(isDay, weatherMeta.category);

    const compass = Units.degreesToCompass(windDirectionDeg);

    // Compute today's high and low
    const todayMaxCelsius = daily.temperature_2m_max?.[0] ?? tempCelsius;
    const todayMinCelsius = daily.temperature_2m_min?.[0] ?? tempCelsius;
    const todayPrecipMm = daily.precipitation_sum?.[0] ?? 0;

    // Format local time from current.time (e.g., "2026-10-02T07:45")
    let localTimeFormatted = 'Local time';
    try {
      if (current.time) {
        const parts = current.time.split('T');
        if (parts[1]) {
          const [hours, minutes] = parts[1].split(':');
          const h = parseInt(hours, 10);
          const ampm = h >= 12 ? 'PM' : 'AM';
          const h12 = h % 12 || 12;
          localTimeFormatted = `${h12}:${minutes} ${ampm}`;
        }
      }
    } catch (e) {
      localTimeFormatted = 'Now';
    }

    // Clear previous view
    DOM.weatherDisplay.innerHTML = '';

    // Create Hero Section
    const heroCard = document.createElement('section');
    heroCard.className = 'glass-panel hero-weather-card';
    heroCard.setAttribute('aria-label', 'Current Weather Showcase');

    heroCard.innerHTML = `
      <div class="hero-main-info">
        <div class="location-badge-row">
          <span class="location-tag">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
              <circle cx="12" cy="10" r="3"/>
            </svg>
            ${escapeHTML(location.name)}
          </span>
          <span class="time-tag">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${escapeHTML(localTimeFormatted)}
          </span>
        </div>

        <div>
          <h2 class="city-name">${escapeHTML(location.name)}<span class="country-label">${location.country ? escapeHTML(location.country) : ''}</span></h2>
        </div>

        <div class="weather-condition-pill">
          <span>${weatherMeta.isDay ? '☀️' : '🌙'}</span>
          <span>${escapeHTML(weatherMeta.description)}</span>
        </div>
      </div>

      <div class="hero-temperature-showcase">
        <div class="temp-primary-row">
          <div class="weather-hero-icon" aria-hidden="true">
            ${getWeatherSvg(weatherMeta.iconType, weatherMeta.isDay, 82)}
          </div>
          <div class="big-temp-value" data-celsius="${tempCelsius != null ? tempCelsius : ''}">
            ${Units.formatTemp(tempCelsius)}
          </div>
        </div>

        <div class="feels-like-label" data-feels-celsius="${feelsCelsius != null ? feelsCelsius : ''}">
          Feels like ${Units.formatTemp(feelsCelsius)}
        </div>

        <div class="today-range-capsule">
          <span class="range-high" title="Today's High" data-celsius="${todayMaxCelsius}">
            ↑ ${Units.formatTemp(todayMaxCelsius)}
          </span>
          <span class="range-low" title="Today's Low" data-celsius="${todayMinCelsius}">
            ↓ ${Units.formatTemp(todayMinCelsius)}
          </span>
        </div>
      </div>
    `;

    DOM.weatherDisplay.appendChild(heroCard);

    // Create Detailed Metrics Section
    const metricsSection = document.createElement('section');
    metricsSection.className = 'metrics-section';
    metricsSection.setAttribute('aria-label', 'Atmospheric Metrics');

    metricsSection.innerHTML = `
      <h3 class="section-title">
        <span class="section-title-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="9" y1="21" x2="9" y2="9"/>
          </svg>
        </span>
        Today's Highlights
      </h3>

      <div class="metrics-grid">
        <!-- Humidity Card -->
        <article class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Humidity</span>
            <div class="metric-icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
              </svg>
            </div>
          </div>
          <div class="metric-body">
            <span class="metric-value">${escapeHTML(humidity)}</span>
            <span class="metric-unit">%</span>
          </div>
          <div>
            <div class="metric-bar-track">
              <div class="metric-bar-fill" style="width: ${typeof humidity === 'number' ? Math.min(humidity, 100) : 0}%"></div>
            </div>
            <p class="metric-footer" style="margin-top: 0.4rem;">
              ${humidity > 65 ? 'High moisture level' : humidity < 30 ? 'Dry air' : 'Optimal comfort'}
            </p>
          </div>
        </article>

        <!-- Wind Card -->
        <article class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Wind Velocity</span>
            <div class="metric-icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17.7 7.7A7.5 7.5 0 0 0 5 12h14a4 4 0 0 0-4-4"/>
                <path d="M3 16h11a3 3 0 0 1 0 6H12"/>
              </svg>
            </div>
          </div>
          <div class="metric-body">
            <span class="metric-value" data-wind-kmh="${windSpeedKmh != null ? windSpeedKmh : ''}">
              ${windSpeedKmh != null ? (state.currentUnit === 'imperial' ? Math.round(Units.toMph(windSpeedKmh)) : Math.round(windSpeedKmh)) : 'N/A'}
            </span>
            <span class="metric-unit" id="metric-wind-unit">
              ${state.currentUnit === 'imperial' ? 'mph' : 'km/h'}
            </span>
          </div>
          <div class="compass-wrapper">
            <div class="compass-dial" title="Direction: ${compass.deg}°">
              <svg class="compass-arrow" style="transform: rotate(${compass.deg}deg);" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="12,2 17,21 12,16 7,21"/>
              </svg>
            </div>
            <span class="metric-footer">Direction: <strong>${escapeHTML(compass.label)}</strong> (${Math.round(compass.deg)}°)</span>
          </div>
        </article>

        <!-- Precipitation Today -->
        <article class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Precipitation Today</span>
            <div class="metric-icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 16.58A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
                <path d="M8 19v2"/>
                <path d="M8 13v2"/>
                <path d="M16 19v2"/>
                <path d="M16 13v2"/>
                <path d="M12 21v2"/>
                <path d="M12 15v2"/>
              </svg>
            </div>
          </div>
          <div class="metric-body">
            <span class="metric-value" data-precip-mm="${todayPrecipMm}">
              ${state.currentUnit === 'imperial' ? Units.toInches(todayPrecipMm).toFixed(2) : Number(todayPrecipMm).toFixed(1)}
            </span>
            <span class="metric-unit" id="metric-precip-unit">
              ${state.currentUnit === 'imperial' ? 'in' : 'mm'}
            </span>
          </div>
          <div class="metric-footer">
            ${todayPrecipMm > 0 ? 'Accumulation expected today' : 'No significant rainfall'}
          </div>
        </article>

        <!-- Diurnal / Atmosphere Status -->
        <article class="metric-card">
          <div class="metric-header">
            <span class="metric-title">Atmospheric Phase</span>
            <div class="metric-icon-wrap" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="4"/>
                <path d="M12 2v2"/>
                <path d="M12 20v2"/>
                <path d="m4.93 4.93 1.41 1.41"/>
                <path d="m17.66 17.66 1.41 1.41"/>
                <path d="M2 12h2"/>
                <path d="M20 12h2"/>
                <path d="m6.34 17.66-1.41 1.41"/>
                <path d="m19.07 4.93-1.41 1.41"/>
              </svg>
            </div>
          </div>
          <div class="metric-body">
            <span class="metric-value" style="font-size: 1.65rem;">${isDay ? 'Daylight' : 'Night'}</span>
          </div>
          <div class="metric-footer">
            Condition: <strong>${escapeHTML(weatherMeta.description)}</strong>
          </div>
        </article>
      </div>
    `;

    DOM.weatherDisplay.appendChild(metricsSection);

    // Create 24-Hour Hourly Forecast Strip
    if (hourly.time && Array.isArray(hourly.time) && hourly.time.length > 0) {
      const hourlySection = document.createElement('section');
      hourlySection.className = 'hourly-section';
      hourlySection.setAttribute('aria-label', '24 Hour Hourly Forecast');

      // Locate current hour index or start from index 0
      let startIndex = 0;
      if (current.time) {
        const currentHourPrefix = current.time.substring(0, 13); // e.g. "2026-10-02T07"
        const foundIdx = hourly.time.findIndex(t => t.startsWith(currentHourPrefix));
        if (foundIdx !== -1) {
          startIndex = foundIdx;
        }
      }

      // Next 24 hours
      const next24Hours = hourly.time.slice(startIndex, startIndex + 24);

      let hourlyCardsHtml = '';
      next24Hours.forEach((isoTime, relIdx) => {
        const globalIdx = startIndex + relIdx;
        const temp = hourly.temperature_2m?.[globalIdx] ?? null;
        const code = hourly.weather_code?.[globalIdx] ?? 0;
        const precipProb = hourly.precipitation_probability?.[globalIdx] ?? null;

        // Parse time: e.g. "2026-10-02T13:00"
        let displayHour = 'Now';
        if (relIdx > 0) {
          try {
            const hourPart = parseInt(isoTime.split('T')[1].split(':')[0], 10);
            const ampm = hourPart >= 12 ? 'PM' : 'AM';
            const h12 = hourPart % 12 || 12;
            displayHour = `${h12} ${ampm}`;
          } catch (e) {
            displayHour = `+${relIdx}h`;
          }
        }

        // Estimate isDay for hourly (approx 6 AM to 7 PM)
        let hourNumber = 12;
        try {
          hourNumber = parseInt(isoTime.split('T')[1].split(':')[0], 10);
        } catch (e) {}
        const isHourDay = hourNumber >= 6 && hourNumber < 19;
        const meta = getWeatherMetadata(code, isHourDay);

        hourlyCardsHtml += `
          <div class="hourly-card ${relIdx === 0 ? 'is-now' : ''}" role="group" aria-label="${displayHour}: ${Units.formatTemp(temp)}, ${escapeHTML(meta.description)}">
            <span class="hourly-time">${displayHour}</span>
            <div class="hourly-icon" aria-hidden="true">
              ${getWeatherSvg(meta.iconType, isHourDay, 34)}
            </div>
            <span class="hourly-temp" data-celsius="${temp != null ? temp : ''}">${Units.formatTemp(temp)}</span>
            ${precipProb != null && precipProb > 0 ? `
              <span class="hourly-precip" title="Precipitation Probability">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                </svg>
                ${precipProb}%
              </span>
            ` : '<span class="hourly-precip" style="visibility:hidden;">0%</span>'}
          </div>
        `;
      });

      hourlySection.innerHTML = `
        <div class="section-header-row">
          <h3 class="section-title">
            <span class="section-title-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </span>
            24-Hour Outlook
          </h3>
          <div class="scroll-controls">
            <button type="button" class="scroll-nav-btn" id="scroll-left-btn" aria-label="Scroll left in hourly forecast">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button type="button" class="scroll-nav-btn" id="scroll-right-btn" aria-label="Scroll right in hourly forecast">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="hourly-strip-scroll" id="hourly-strip" tabindex="0" role="region" aria-label="Hourly weather forecast scrollable list">
          ${hourlyCardsHtml}
        </div>
      `;

      DOM.weatherDisplay.appendChild(hourlySection);

      // Add scroll listener buttons
      const scrollStrip = hourlySection.querySelector('#hourly-strip');
      const leftBtn = hourlySection.querySelector('#scroll-left-btn');
      const rightBtn = hourlySection.querySelector('#scroll-right-btn');
      if (leftBtn && rightBtn && scrollStrip) {
        leftBtn.addEventListener('click', () => {
          scrollStrip.scrollBy({ left: -260, behavior: 'smooth' });
        });
        rightBtn.addEventListener('click', () => {
          scrollStrip.scrollBy({ left: 260, behavior: 'smooth' });
        });
      }
    }

    // Create 7-Day Extended Forecast Section
    if (daily.time && Array.isArray(daily.time) && daily.time.length > 0) {
      const forecastSection = document.createElement('section');
      forecastSection.className = 'forecast-section';
      forecastSection.setAttribute('aria-label', '7-Day Extended Forecast');

      // Find overall min and max to proportionally size the visual temperature bar
      const allMins = (daily.temperature_2m_min || []).filter(v => v != null);
      const allMaxs = (daily.temperature_2m_max || []).filter(v => v != null);
      const minGlobal = allMins.length > 0 ? Math.min(...allMins) : 0;
      const maxGlobal = allMaxs.length > 0 ? Math.max(...allMaxs) : 40;
      const totalSpan = Math.max(maxGlobal - minGlobal, 1);

      let forecastRowsHtml = '';
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      daily.time.slice(0, 7).forEach((dateStr, index) => {
        const minTemp = daily.temperature_2m_min?.[index] ?? null;
        const maxTemp = daily.temperature_2m_max?.[index] ?? null;
        const precip = daily.precipitation_sum?.[index] ?? 0;
        const code = daily.weather_code?.[index] ?? 0;
        const meta = getWeatherMetadata(code, 1);

        let dayTitle = 'Today';
        let subDate = '';
        try {
          const [y, m, d] = dateStr.split('-').map(Number);
          const dateObj = new Date(y, m - 1, d);
          if (index === 0) {
            dayTitle = 'Today';
          } else if (index === 1) {
            dayTitle = 'Tomorrow';
          } else {
            dayTitle = dayNames[dateObj.getDay()];
          }
          subDate = `${monthNames[m - 1]} ${d}`;
        } catch (e) {
          dayTitle = `Day ${index + 1}`;
        }

        // Calculate bar offset and width percentages
        let leftPercent = 10;
        let widthPercent = 80;
        if (minTemp != null && maxTemp != null) {
          leftPercent = Math.max(0, ((minTemp - minGlobal) / totalSpan) * 100);
          const rightPercent = Math.min(100, ((maxTemp - minGlobal) / totalSpan) * 100);
          widthPercent = Math.max(8, rightPercent - leftPercent);
        }

        forecastRowsHtml += `
          <div class="forecast-day-row" role="article" aria-label="${dayTitle}, ${subDate}: High ${Units.formatTemp(maxTemp)}, Low ${Units.formatTemp(minTemp)}, ${escapeHTML(meta.description)}">
            <div class="forecast-date-col">
              <span class="forecast-day-name">${dayTitle}</span>
              <span class="forecast-date-sub">${subDate}</span>
            </div>

            <div class="forecast-condition-col">
              <div class="forecast-icon" aria-hidden="true">
                ${getWeatherSvg(meta.iconType, true, 30)}
              </div>
              <span class="forecast-condition-text">${escapeHTML(meta.description)}</span>
            </div>

            <div class="forecast-temp-bar-col">
              <span class="temp-min-text" data-celsius="${minTemp != null ? minTemp : ''}">
                ${Units.formatTemp(minTemp)}
              </span>
              <div class="temp-bar-track" aria-hidden="true">
                <div class="temp-bar-fill" style="left: ${leftPercent.toFixed(1)}%; width: ${widthPercent.toFixed(1)}%;"></div>
              </div>
              <span class="temp-max-text" data-celsius="${maxTemp != null ? maxTemp : ''}">
                ${Units.formatTemp(maxTemp)}
              </span>
            </div>

            <div class="forecast-precip-col">
              ${precip > 0 ? `
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>
                </svg>
                <span data-precip-mm="${precip}">
                  ${state.currentUnit === 'imperial' ? Units.toInches(precip).toFixed(2) + ' in' : Number(precip).toFixed(1) + ' mm'}
                </span>
              ` : '<span style="color: var(--text-muted); font-size: 0.75rem;">Dry</span>'}
            </div>
          </div>
        `;
      });

      forecastSection.innerHTML = `
        <h3 class="section-title">
          <span class="section-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </span>
          7-Day Forecast
        </h3>
        <div class="forecast-cards-container">
          ${forecastRowsHtml}
        </div>
      `;

      DOM.weatherDisplay.appendChild(forecastSection);
    }
  }

  /* ==========================================================================
     CLIENT-SIDE INSTANT UNIT CONVERSION
     Updates temperatures, speeds, and precipitation on the fly with no re-fetch!
     ========================================================================== */
  function updateDisplayUnits() {
    const isImperial = state.currentUnit === 'imperial';

    // 1. Update Unit Toggle Switch Visuals
    DOM.unitSwitch.setAttribute('aria-checked', isImperial ? 'true' : 'false');

    // 2. Update all elements carrying [data-celsius]
    const tempElements = DOM.weatherDisplay.querySelectorAll('[data-celsius]');
    tempElements.forEach(el => {
      const raw = el.getAttribute('data-celsius');
      if (raw !== '' && raw !== null) {
        const cVal = parseFloat(raw);
        if (!isNaN(cVal)) {
          // Check if it's an arrow indicator (e.g. ↑ or ↓)
          const text = el.textContent || '';
          if (text.includes('↑')) {
            el.textContent = `↑ ${Units.formatTemp(cVal)}`;
          } else if (text.includes('↓')) {
            el.textContent = `↓ ${Units.formatTemp(cVal)}`;
          } else {
            el.textContent = Units.formatTemp(cVal);
          }
        }
      }
    });

    // 3. Update feels-like element
    const feelsEl = DOM.weatherDisplay.querySelector('[data-feels-celsius]');
    if (feelsEl) {
      const raw = feelsEl.getAttribute('data-feels-celsius');
      if (raw !== '' && raw !== null) {
        const cVal = parseFloat(raw);
        if (!isNaN(cVal)) {
          feelsEl.textContent = `Feels like ${Units.formatTemp(cVal)}`;
        }
      }
    }

    // 4. Update wind speed
    const windEl = DOM.weatherDisplay.querySelector('[data-wind-kmh]');
    const windUnitEl = DOM.weatherDisplay.querySelector('#metric-wind-unit');
    if (windEl && windUnitEl) {
      const raw = windEl.getAttribute('data-wind-kmh');
      if (raw !== '' && raw !== null) {
        const kmh = parseFloat(raw);
        if (!isNaN(kmh)) {
          windEl.textContent = isImperial ? Math.round(Units.toMph(kmh)) : Math.round(kmh);
          windUnitEl.textContent = isImperial ? 'mph' : 'km/h';
        }
      }
    }

    // 5. Update precipitation values
    const precipEls = DOM.weatherDisplay.querySelectorAll('[data-precip-mm]');
    precipEls.forEach(el => {
      const raw = el.getAttribute('data-precip-mm');
      if (raw !== '' && raw !== null) {
        const mm = parseFloat(raw);
        if (!isNaN(mm)) {
          el.textContent = isImperial ? `${Units.toInches(mm).toFixed(2)} in` : `${Number(mm).toFixed(1)} mm`;
        }
      }
    });

    const precipUnitEl = DOM.weatherDisplay.querySelector('#metric-precip-unit');
    if (precipUnitEl) {
      precipUnitEl.textContent = isImperial ? 'in' : 'mm';
    }
  }

  function toggleUnits() {
    state.currentUnit = state.currentUnit === 'metric' ? 'imperial' : 'metric';
    localStorage.setItem(API_CONFIG.STORAGE_KEYS.UNIT, state.currentUnit);
    updateDisplayUnits();
    showToast(`Switched units to ${state.currentUnit === 'imperial' ? 'Imperial (°F, mph)' : 'Metric (°C, km/h)'}`);
  }

  /* ==========================================================================
     RECENT SEARCHES & LOCALSTORAGE MANAGEMENT
     ========================================================================== */
  function loadRecentSearches() {
    try {
      const stored = localStorage.getItem(API_CONFIG.STORAGE_KEYS.RECENT);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          state.recentSearches = parsed.slice(0, API_CONFIG.MAX_RECENT_SEARCHES);
        }
      }
    } catch (e) {
      console.warn('[Weather Dashboard] Failed to load recent searches from localStorage:', e);
      state.recentSearches = [];
    }
    renderRecentChips();
  }

  function saveRecentSearch(locationObj) {
    if (!locationObj || !locationObj.name) return;

    // Remove duplicates by name comparison (case-insensitive)
    const filtered = state.recentSearches.filter(
      item => item.name.toLowerCase() !== locationObj.name.toLowerCase()
    );

    // Insert at front
    filtered.unshift({
      name: locationObj.name,
      country: locationObj.country,
      latitude: locationObj.latitude,
      longitude: locationObj.longitude
    });

    state.recentSearches = filtered.slice(0, API_CONFIG.MAX_RECENT_SEARCHES);

    try {
      localStorage.setItem(API_CONFIG.STORAGE_KEYS.RECENT, JSON.stringify(state.recentSearches));
      localStorage.setItem(API_CONFIG.STORAGE_KEYS.LAST_CITY, locationObj.name);
    } catch (e) {
      console.warn('[Weather Dashboard] Failed to save recent searches:', e);
    }

    renderRecentChips();
  }

  function renderRecentChips() {
    DOM.recentChipsList.innerHTML = '';

    if (state.recentSearches.length === 0) {
      DOM.clearRecentBtn.classList.add('hidden');
      return;
    }

    DOM.clearRecentBtn.classList.remove('hidden');

    state.recentSearches.forEach((loc) => {
      const chip = document.createElement('div');
      chip.className = 'recent-chip';
      chip.setAttribute('role', 'listitem');
      chip.setAttribute('tabindex', '0');

      if (state.currentLocation && state.currentLocation.name.toLowerCase() === loc.name.toLowerCase()) {
        chip.classList.add('active');
      }

      chip.innerHTML = `
        <span class="chip-text">${escapeHTML(loc.name)}</span>
        <button type="button" class="chip-remove" aria-label="Remove ${escapeHTML(loc.name)} from history">&times;</button>
      `;

      // Click on chip text to trigger search
      chip.querySelector('.chip-text').addEventListener('click', () => {
        handleSearch(loc.name);
      });

      // Accessible enter/space key
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target === chip || e.target.classList.contains('chip-text')) {
            e.preventDefault();
            handleSearch(loc.name);
          }
        }
      });

      // Remove button listener
      chip.querySelector('.chip-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeRecentSearch(loc.name);
      });

      DOM.recentChipsList.appendChild(chip);
    });
  }

  function removeRecentSearch(cityName) {
    state.recentSearches = state.recentSearches.filter(
      item => item.name.toLowerCase() !== cityName.toLowerCase()
    );
    try {
      localStorage.setItem(API_CONFIG.STORAGE_KEYS.RECENT, JSON.stringify(state.recentSearches));
    } catch (e) {}
    renderRecentChips();
  }

  function clearAllRecentSearches() {
    state.recentSearches = [];
    try {
      localStorage.removeItem(API_CONFIG.STORAGE_KEYS.RECENT);
    } catch (e) {}
    renderRecentChips();
    showToast('Recent searches cleared');
  }

  /* ==========================================================================
     ERROR BANNER & UI FEEDBACK
     ========================================================================== */
  function showError(title, message, canRetry = true) {
    DOM.errorTitle.textContent = title;
    DOM.errorMessage.textContent = message;
    DOM.errorBanner.classList.remove('hidden');

    if (canRetry && state.lastFailedSearch) {
      DOM.retryBtn.classList.remove('hidden');
    } else {
      DOM.retryBtn.classList.add('hidden');
    }

    DOM.errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function hideError() {
    DOM.errorBanner.classList.add('hidden');
  }

  function showLoading(isLoading) {
    state.isRequestInFlight = isLoading;
    DOM.searchBtn.disabled = isLoading;
    DOM.searchInput.disabled = isLoading;

    if (isLoading) {
      DOM.btnText.classList.add('hidden');
      DOM.btnIcon.classList.add('hidden');
      DOM.btnLoader.classList.remove('hidden');
      DOM.loadingSkeleton.classList.remove('hidden');
      DOM.weatherDisplay.classList.add('hidden');
      hideError();
    } else {
      DOM.btnText.classList.remove('hidden');
      DOM.btnIcon.classList.remove('hidden');
      DOM.btnLoader.classList.add('hidden');
      DOM.loadingSkeleton.classList.add('hidden');
      DOM.weatherDisplay.classList.remove('hidden');
    }
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-hide');
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 2800);
  }

  /* ==========================================================================
     SEARCH ORCHESTRATION & COMPREHENSIVE ERROR HANDLING
     ========================================================================== */
  async function handleSearch(cityName) {
    if (!cityName) return;

    const trimmed = cityName.trim();

    // 1. Input Validation: reject empty or numeric-only strings
    if (!trimmed) {
      showError('Invalid Search', 'Please enter a city name to search.', false);
      return;
    }

    if (/^\d+$/.test(trimmed)) {
      showError('Invalid City Name', 'City names cannot consist of numbers only. Please enter a valid city name (e.g. Chennai, London, Tokyo).', false);
      return;
    }

    // 2. Abort any previous in-flight request & clear timer
    if (state.activeAbortController) {
      state.activeAbortController.abort('USER_CANCELLED');
    }
    if (state.activeTimeoutId) {
      clearTimeout(state.activeTimeoutId);
    }

    const abortController = new AbortController();
    state.activeAbortController = abortController;
    state.lastFailedSearch = trimmed;

    // 3. Set 10-second timeout
    state.activeTimeoutId = setTimeout(() => {
      abortController.abort('REQUEST_TIMEOUT');
    }, API_CONFIG.TIMEOUT_MS);

    showLoading(true);

    try {
      // Step 1: Geocoding
      const location = await getCoordinates(trimmed, abortController.signal);

      // Step 2: Forecast
      const weatherData = await getWeather(
        location.latitude,
        location.longitude,
        location.timezone,
        abortController.signal
      );

      // Successfully received data!
      state.currentWeatherData = weatherData;
      state.currentLocation = location;
      state.lastFailedSearch = null;

      // Update state and UI
      saveRecentSearch(location);
      renderWeather(weatherData, location);
      DOM.searchInput.value = location.name;
      DOM.clearSearchBtn.classList.remove('hidden');
      hideError();

    } catch (err) {
      // Check if aborted because of user action vs timeout
      if (err.name === 'AbortError' || err === 'USER_CANCELLED') {
        if (abortController.signal.reason === 'REQUEST_TIMEOUT' || err === 'REQUEST_TIMEOUT') {
          console.error('[Weather Dashboard Error] Request timed out:', err);
          showError('Request Timed Out', 'The weather service took longer than 10 seconds to respond. Please verify your connection and click Retry.', true);
        } else {
          // Normal user abort when a subsequent query started; do not display error
          console.info('[Weather Dashboard] Previous request cancelled by new search.');
          return;
        }
      } else {
        console.error('[Weather Dashboard Error]', err);

        if (err.message === 'OFFLINE' || !navigator.onLine) {
          showError('Network Offline', 'You appear to be disconnected from the internet. Please check your network connection and click Retry.', true);
        } else if (err.message === 'NETWORK_FAILURE') {
          showError('Connection Error', 'Unable to reach the meteorological servers. Please check your network and retry.', true);
        } else if (err.message === 'CITY_NOT_FOUND') {
          showError('City Not Found', `No geographic match was found for "${escapeHTML(trimmed)}". Please check the spelling and try again.`, false);
        } else if (err.message === 'RATE_LIMITED') {
          showError('Service Busy', 'Open-Meteo API rate limit reached. Please wait a moment and try your search again.', true);
        } else if (err.message === 'MALFORMED_JSON' || err.message === 'INVALID_WEATHER_DATA') {
          showError('Data Error', 'Received an unparseable response from the weather service. Please try again in a few moments.', true);
        } else {
          showError('Search Failed', err.message || 'An unexpected error occurred while fetching the weather. Please try again.', true);
        }
      }
    } finally {
      // 4. Always hide loading state in finally
      if (state.activeTimeoutId) {
        clearTimeout(state.activeTimeoutId);
        state.activeTimeoutId = null;
      }
      state.activeAbortController = null;
      showLoading(false);
    }
  }

  /* ==========================================================================
     EVENT LISTENERS & BINDINGS
     ========================================================================== */
  function setupEventListeners() {
    // Search Form Submit
    DOM.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSearch(DOM.searchInput.value);
    });

    // Clear Search Input Button
    DOM.searchInput.addEventListener('input', () => {
      if (DOM.searchInput.value.trim().length > 0) {
        DOM.clearSearchBtn.classList.remove('hidden');
      } else {
        DOM.clearSearchBtn.classList.add('hidden');
      }
    });

    DOM.clearSearchBtn.addEventListener('click', () => {
      DOM.searchInput.value = '';
      DOM.clearSearchBtn.classList.add('hidden');
      DOM.searchInput.focus();
    });

    // Unit Toggle Switch
    DOM.unitSwitch.addEventListener('click', () => {
      toggleUnits();
    });

    // Retry Button in Error Banner
    DOM.retryBtn.addEventListener('click', () => {
      if (state.lastFailedSearch) {
        handleSearch(state.lastFailedSearch);
      }
    });

    // Dismiss Error Banner
    DOM.dismissErrorBtn.addEventListener('click', () => {
      hideError();
    });

    // Clear All Recent Searches
    DOM.clearRecentBtn.addEventListener('click', () => {
      clearAllRecentSearches();
    });

    // Network Online / Offline Detection
    window.addEventListener('online', () => {
      DOM.connectionStatus.className = 'status-badge status-online';
      DOM.connectionLabel.textContent = 'Live';
      showToast('Network restored. You are back online.');
      if (state.lastFailedSearch) {
        handleSearch(state.lastFailedSearch);
      }
    });

    window.addEventListener('offline', () => {
      DOM.connectionStatus.className = 'status-badge status-offline';
      DOM.connectionLabel.textContent = 'Offline';
      showError('Connection Lost', 'You are currently working offline. Active queries will fail until internet connection is restored.', true);
    });

    // Global Keyboard Shortcut: Press '/' to focus search input
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== DOM.searchInput) {
        e.preventDefault();
        DOM.searchInput.focus();
        DOM.searchInput.select();
      }
    });
  }

  /* ==========================================================================
     APPLICATION INITIALIZATION
     ========================================================================== */
  function initApp() {
    // 1. Restore unit preference
    const savedUnit = localStorage.getItem(API_CONFIG.STORAGE_KEYS.UNIT);
    if (savedUnit === 'imperial' || savedUnit === 'metric') {
      state.currentUnit = savedUnit;
    }
    DOM.unitSwitch.setAttribute('aria-checked', state.currentUnit === 'imperial' ? 'true' : 'false');

    // 2. Setup listeners
    setupEventListeners();

    // 3. Load recent searches
    loadRecentSearches();

    // 4. Initial city to load: last searched city, or first recent search, or default (Chennai)
    const lastCity = localStorage.getItem(API_CONFIG.STORAGE_KEYS.LAST_CITY);
    const initialCity = lastCity || (state.recentSearches[0]?.name) || API_CONFIG.DEFAULT_CITY;

    // Check initial network status
    if (!navigator.onLine) {
      DOM.connectionStatus.className = 'status-badge status-offline';
      DOM.connectionLabel.textContent = 'Offline';
      showError('Offline Mode', 'You appear to be offline. Connect to the internet to load meteorological metrics.', true);
    } else {
      handleSearch(initialCity);
    }
  }

  // Launch when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
})();
