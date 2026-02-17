module.exports = {
  // Target site
  TARGET_URL: 'http://www.iros.go.kr',
  BASE_URL: 'http://www.iros.go.kr',

  // Crawl settings
  CRAWL: {
    MAX_PAGES: 50,
    MAX_DEPTH: 3,
    CONCURRENT_REQUESTS: 3,
    REQUEST_DELAY: 500,
    PAGE_TIMEOUT: 15000,
    RESPECT_ROBOTS_TXT: true,
  },

  // Browser settings (Linux-optimized)
  BROWSER_OPTIONS: {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--mute-audio',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-domain-reliability',
      // Linux-specific: use /tmp for shared memory
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
    ],
    defaultViewport: { width: 1280, height: 900 },
    timeout: 30000,
  },

  // Output settings
  OUTPUT: {
    DIR: '../output/crawl-data',
    FORMAT: 'json', // 'json' or 'csv'
    LOG_DIR: './logs',
  },

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 2000,

  // Data extraction selectors (customizable per target site)
  SELECTORS: {
    links: 'a[href]',
    titles: 'title, h1, h2, h3',
    content: 'p, td, th, li, span, div',
    images: 'img[src]',
    tables: 'table',
  },

  // User agents rotation for anti-detection
  USER_AGENTS: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  ],
};
