// Node verification of the Weather Dashboard core logic and live Open-Meteo APIs

const API_CONFIG = {
  GEOCODING_URL: 'https://geocoding-api.open-meteo.com/v1/search',
  FORECAST_URL: 'https://api.open-meteo.com/v1/forecast',
  TIMEOUT_MS: 10000
};

async function getCoordinates(city, signal) {
  const encodedCity = encodeURIComponent(city.trim());
  const url = `${API_CONFIG.GEOCODING_URL}?name=${encodedCity}&count=1`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.results || data.results.length === 0) throw new Error('CITY_NOT_FOUND');
  const first = data.results[0];
  return {
    name: first.name,
    country: first.country || first.country_code || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto'
  };
}

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
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return await response.json();
}

const Units = {
  toFahrenheit: (celsius) => (celsius * 9) / 5 + 32,
  toMph: (kmh) => kmh * 0.621371,
  toInches: (mm) => mm * 0.0393701,
  degreesToCompass: (degrees) => {
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round((degrees % 360) / 22.5) % 16;
    return directions[index];
  }
};

async function runTests() {
  console.log('=== STARTING LOGIC & API VERIFICATION TESTS ===\n');

  // Test 1: Chennai
  console.log('[Test 1] Testing live search for "Chennai"...');
  const chennaiCoords = await getCoordinates('Chennai');
  console.log(` -> Found: ${chennaiCoords.name}, ${chennaiCoords.country} (Lat: ${chennaiCoords.latitude}, Lon: ${chennaiCoords.longitude})`);
  const chennaiWeather = await getWeather(chennaiCoords.latitude, chennaiCoords.longitude, chennaiCoords.timezone);
  console.log(` -> Current Temp: ${chennaiWeather.current.temperature_2m}°C (Feels like: ${chennaiWeather.current.apparent_temperature}°C)`);
  console.log(` -> Humidity: ${chennaiWeather.current.relative_humidity_2m}%`);
  console.log(` -> Wind: ${chennaiWeather.current.wind_speed_10m} km/h, Direction: ${Units.degreesToCompass(chennaiWeather.current.wind_direction_10m)} (${chennaiWeather.current.wind_direction_10m}°)`);
  console.log(` -> Hourly count: ${chennaiWeather.hourly.time.length} hours`);
  console.log(` -> 7-Day high/lows: Max ${chennaiWeather.daily.temperature_2m_max[0]}°C, Min ${chennaiWeather.daily.temperature_2m_min[0]}°C\n`);

  // Test 2: London
  console.log('[Test 2] Testing live search for "London"...');
  const londonCoords = await getCoordinates('London');
  console.log(` -> Found: ${londonCoords.name}, ${londonCoords.country} (Lat: ${londonCoords.latitude}, Lon: ${londonCoords.longitude})`);
  const londonWeather = await getWeather(londonCoords.latitude, londonCoords.longitude, londonCoords.timezone);
  console.log(` -> Temp: ${londonWeather.current.temperature_2m}°C, Humidity: ${londonWeather.current.relative_humidity_2m}%\n`);

  // Test 3: New York
  console.log('[Test 3] Testing live search for "New York"...');
  const nyCoords = await getCoordinates('New York');
  console.log(` -> Found: ${nyCoords.name}, ${nyCoords.country} (Lat: ${nyCoords.latitude}, Lon: ${nyCoords.longitude})`);
  const nyWeather = await getWeather(nyCoords.latitude, nyCoords.longitude, nyCoords.timezone);
  console.log(` -> Temp: ${nyWeather.current.temperature_2m}°C, Humidity: ${nyWeather.current.relative_humidity_2m}%\n`);

  // Test 4: Invalid city "asdfghjkl"
  console.log('[Test 4] Testing invalid city "asdfghjkl"...');
  try {
    await getCoordinates('asdfghjkl');
    throw new Error('Expected CITY_NOT_FOUND but succeeded!');
  } catch (err) {
    if (err.message === 'CITY_NOT_FOUND') {
      console.log(' -> Correctly caught CITY_NOT_FOUND error without crashing!');
    } else {
      throw err;
    }
  }

  // Test 5: Unit conversion accuracy
  console.log('\n[Test 5] Testing unit conversion math...');
  const c = 20;
  const f = Units.toFahrenheit(c);
  if (Math.round(f) !== 68) throw new Error(`Unit conversion failed: 20°C should be 68°F, got ${f}`);
  const speedKmh = 100;
  const speedMph = Units.toMph(speedKmh);
  if (Math.round(speedMph) !== 62) throw new Error(`Wind conversion failed: 100 km/h should be 62 mph, got ${speedMph}`);
  const precipMm = 25.4;
  const precipIn = Units.toInches(precipMm);
  if (Math.round(precipIn * 100) / 100 !== 1.00) throw new Error(`Precip conversion failed: 25.4mm should be 1.00in, got ${precipIn}`);
  console.log(' -> 20°C = 68°F (Verified)');
  console.log(' -> 100 km/h = 62 mph (Verified)');
  console.log(' -> 25.4 mm = 1.00 in (Verified)');

  // Test 6: Compass directions
  console.log('\n[Test 6] Testing compass directions...');
  const compassTests = [
    { deg: 0, expected: 'N' },
    { deg: 90, expected: 'E' },
    { deg: 180, expected: 'S' },
    { deg: 270, expected: 'W' },
    { deg: 45, expected: 'NE' },
    { deg: 225, expected: 'SW' }
  ];
  for (const t of compassTests) {
    const res = Units.degreesToCompass(t.deg);
    if (res !== t.expected) throw new Error(`Compass failed for ${t.deg}: expected ${t.expected}, got ${res}`);
  }
  console.log(' -> Compass calculations (N, E, S, W, NE, SW) verified!');

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
