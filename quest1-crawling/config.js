module.exports = {
  TARGET_URL: 'http://www.iros.go.kr',
  ISSUANCE_URL: 'http://www.iros.go.kr/PissWeb/Jsp/sje/sje001001s01.jsp',

  // Default search address (can be overridden via CLI)
  DEFAULT_ADDRESS: '서울특별시 강남구 역삼동',

  // Browser settings optimized for speed
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
    ],
    defaultViewport: { width: 1280, height: 900 },
    timeout: 30000,
  },

  // Performance targets (milliseconds)
  PERFORMANCE: {
    TARGET_MAX: 16000,
    TARGET_IDEAL: 8000,
  },

  // Output settings
  OUTPUT_DIR: '../output',
  PDF_FILENAME_PREFIX: 'iros_registry_',

  // Retry settings
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000,

  // Timeouts
  NAVIGATION_TIMEOUT: 15000,
  ELEMENT_TIMEOUT: 10000,
};
