async function runTest() {
  try {
    const endpoints = [
      'http://localhost:3000/',
      'http://localhost:3000/style.css',
      'http://localhost:3000/script.js',
      'http://localhost:3000/index.html'
    ];

    for (const url of endpoints) {
      const res = await fetch(url);
      console.log(`[HTTP Test] ${url} -> Status: ${res.status} (${res.headers.get('content-type')})`);
      if (!res.ok) {
        throw new Error(`Failed to load ${url}: status ${res.status}`);
      }
    }

    console.log('[HTTP Test] All server endpoints successfully serving 200 OK!');
  } catch (err) {
    console.error('[HTTP Test Failed]', err);
    process.exit(1);
  }
}

runTest();
