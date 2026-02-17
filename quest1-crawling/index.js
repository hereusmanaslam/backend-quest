#!/usr/bin/env node

/**
 * Quest 1: RPA Crawling - iros.go.kr PDF Extraction
 *
 * Automates the process of searching for a property address on the Korean
 * Internet Registry Office (인터넷등기소) and downloading the registration PDF.
 *
 * Performance target: ≤16 seconds (ideal: ≤8 seconds)
 */

const puppeteer = require('puppeteer');
const path = require('node:path');
const fs = require('node:fs');
const { program } = require('commander');
const config = require('./config');

// ── CLI Setup ──────────────────────────────────────────────────────────────

program
  .name('quest1-crawling')
  .description('RPA: Extract PDF data from iros.go.kr')
  .option('-a, --address <address>', 'Korean address to search', config.DEFAULT_ADDRESS)
  .option('-o, --output <dir>', 'Output directory', config.OUTPUT_DIR)
  .option('--headed', 'Run browser in headed mode (visible)', false)
  .option('--slow-mo <ms>', 'Slow down operations by ms', '0')
  .parse(process.argv);

const opts = program.opts();

// ── Helpers ────────────────────────────────────────────────────────────────

const DEBUG = process.env.DEBUG === 'true';
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);
const debug = (msg) => { if (DEBUG) log(`[DEBUG] ${msg}`); };

function getOutputPath() {
  const outputDir = path.resolve(__dirname, opts.output);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  return path.join(outputDir, `${config.PDF_FILENAME_PREFIX}${timestamp}.pdf`);
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function assessPerformance(durationMs) {
  if (durationMs <= config.PERFORMANCE.TARGET_IDEAL) {
    return '★★★ EXCELLENT - Under ideal target';
  } else if (durationMs <= config.PERFORMANCE.TARGET_MAX) {
    return '★★☆ GOOD - Within market target';
  } else {
    return '★☆☆ NEEDS OPTIMIZATION - Over target';
  }
}

// ── Retry Wrapper ──────────────────────────────────────────────────────────

async function withRetry(fn, description, retries = config.MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      log(`[RETRY] ${description} - Attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, config.RETRY_DELAY * attempt));
    }
  }
}

// ── Performance Optimization: Intercept unnecessary resources ──────────────

async function optimizePage(page) {
  await page.setRequestInterception(true);

  const blockedResourceTypes = new Set([
    'image', 'stylesheet', 'font', 'media', 'texttrack', 'eventsource',
    'websocket', 'manifest', 'other',
  ]);

  const blockedDomains = [
    'google-analytics.com',
    'googletagmanager.com',
    'doubleclick.net',
    'facebook.com',
    'analytics',
  ];

  page.on('request', (request) => {
    const resourceType = request.resourceType();
    const url = request.url();

    if (blockedResourceTypes.has(resourceType)) {
      request.abort();
      return;
    }

    if (blockedDomains.some((domain) => url.includes(domain))) {
      request.abort();
      return;
    }

    request.continue();
  });

  debug('Page optimized: blocking non-essential resources');
}

// ── Core RPA: Navigate iros.go.kr ──────────────────────────────────────────

async function navigateToIssuance(page) {
  log('Navigating to iros.go.kr issuance page...');

  await page.goto(config.ISSUANCE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: config.NAVIGATION_TIMEOUT,
  });

  debug('Issuance page loaded');
}

async function selectDocumentType(page) {
  log('Selecting document type (부동산 등기부등본)...');

  // The iros.go.kr site uses frames and specific form elements
  // Wait for the main content frame to load
  await page.waitForSelector('frame, iframe, #contents, form', {
    timeout: config.ELEMENT_TIMEOUT,
  }).catch(() => {
    debug('No frame/form found on initial load, trying direct approach');
  });

  // Handle frame-based navigation common on iros.go.kr
  const frames = page.frames();
  debug(`Found ${frames.length} frames on page`);

  let targetFrame = page;

  for (const frame of frames) {
    try {
      const hasForm = await frame.$('form, input[type="text"], select');
      if (hasForm) {
        targetFrame = frame;
        debug(`Using frame: ${frame.url()}`);
        break;
      }
    } catch {
      continue;
    }
  }

  return targetFrame;
}

async function searchAddress(frame, address) {
  log(`Searching for address: ${address}`);

  // iros.go.kr typically has an address input field
  // Try multiple selectors as the site structure may vary
  const addressSelectors = [
    'input[name="addr"]',
    'input[name="address"]',
    'input[name="sAddr"]',
    'input[name="realAddr"]',
    '#addr',
    '#address',
    'input[type="text"]',
  ];

  let addressInput = null;

  for (const selector of addressSelectors) {
    try {
      addressInput = await frame.waitForSelector(selector, { timeout: 3000 });
      if (addressInput) {
        debug(`Found address input with selector: ${selector}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (!addressInput) {
    throw new Error('Could not find address input field on the page');
  }

  // Clear and type the address
  await addressInput.click({ clickCount: 3 });
  await addressInput.type(address, { delay: 0 });
  debug('Address typed');

  // Submit the search
  const searchSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'input[type="button"][value*="검색"]',
    'a[onclick*="search"]',
    'button:has-text("검색")',
    'img[alt*="검색"]',
  ];

  let searchBtn = null;

  for (const selector of searchSelectors) {
    try {
      searchBtn = await frame.$(selector);
      if (searchBtn) {
        debug(`Found search button with selector: ${selector}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (searchBtn) {
    await searchBtn.click();
  } else {
    // Fallback: press Enter
    await addressInput.press('Enter');
    debug('Pressed Enter to submit search');
  }

  // Wait for results to load
  await frame.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: config.NAVIGATION_TIMEOUT })
    .catch(() => debug('No navigation after search, results may load in-place'));

  await new Promise((r) => setTimeout(r, 1000));
  debug('Search completed');
}

async function selectPropertyAndDownload(page, frame) {
  log('Selecting property from results...');

  // Look for result links/rows
  const resultSelectors = [
    'table tr td a',
    '.result-list a',
    'a[href*="detail"]',
    'a[onclick*="select"]',
    'tr.dataRow td a',
  ];

  let resultLink = null;

  for (const selector of resultSelectors) {
    try {
      resultLink = await frame.$(selector);
      if (resultLink) {
        debug(`Found result with selector: ${selector}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (resultLink) {
    await resultLink.click();
    await new Promise((r) => setTimeout(r, 1500));
  }

  log('Attempting to download PDF...');

  // Configure download behavior
  const outputPath = getOutputPath();
  const outputDir = path.dirname(outputPath);

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: outputDir,
  });

  // Look for PDF download/view buttons
  const pdfSelectors = [
    'a[href$=".pdf"]',
    'a[onclick*="pdf"]',
    'a[onclick*="PDF"]',
    'button[onclick*="pdf"]',
    'input[value*="발급"]',
    'a[href*="download"]',
    'img[alt*="열람"]',
    'img[alt*="발급"]',
    'a:has-text("열람")',
  ];

  let pdfButton = null;

  for (const selector of pdfSelectors) {
    try {
      pdfButton = await frame.$(selector);
      if (pdfButton) {
        debug(`Found PDF button with selector: ${selector}`);
        break;
      }
    } catch {
      continue;
    }
  }

  if (pdfButton) {
    await pdfButton.click();
    await new Promise((r) => setTimeout(r, 2000));
    log(`PDF download initiated -> ${outputDir}`);
  } else {
    // Fallback: try to capture the page as PDF
    log('No direct PDF link found, capturing page as PDF...');
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });
    log(`Page captured as PDF -> ${outputPath}`);
  }

  return outputPath;
}

// ── Main Execution ─────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Quest 1: RPA Crawling - iros.go.kr PDF Extraction     ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Address: ${opts.address.padEnd(45)}║`);
  console.log(`║  Target:  ≤${config.PERFORMANCE.TARGET_MAX / 1000}s (ideal: ≤${config.PERFORMANCE.TARGET_IDEAL / 1000}s)${''.padEnd(27)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  let browser;

  try {
    // Launch browser with optimized settings
    log('Launching browser...');
    const launchStart = Date.now();

    const browserOpts = {
      ...config.BROWSER_OPTIONS,
      headless: opts.headed ? false : 'new',
      slowMo: Number.parseInt(opts.slowMo, 10),
    };

    browser = await puppeteer.launch(browserOpts);
    debug(`Browser launched in ${Date.now() - launchStart}ms`);

    const page = await browser.newPage();

    // Optimize page for speed
    await optimizePage(page);

    // Set user agent to avoid detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    // Step 1: Navigate to issuance page
    await withRetry(
      () => navigateToIssuance(page),
      'Navigate to issuance page'
    );

    // Step 2: Select document type
    const targetFrame = await selectDocumentType(page);

    // Step 3: Search for address
    await withRetry(
      () => searchAddress(targetFrame, opts.address),
      'Search address'
    );

    // Step 4: Select property and download PDF
    const outputPath = await selectPropertyAndDownload(page, targetFrame);

    // Performance report
    const totalDuration = Date.now() - startTime;
    console.log('');
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│  PERFORMANCE REPORT                                      │');
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log(`│  Total time:  ${formatDuration(totalDuration).padEnd(42)}│`);
    console.log(`│  Target:      ≤${(config.PERFORMANCE.TARGET_MAX / 1000 + 's').padEnd(41)}│`);
    console.log(`│  Assessment:  ${assessPerformance(totalDuration).padEnd(42)}│`);
    console.log(`│  Output:      ${(outputPath || 'Check output directory').padEnd(42)}│`);
    console.log('└──────────────────────────────────────────────────────────┘');
    console.log('');

  } catch (err) {
    const totalDuration = Date.now() - startTime;
    console.error('');
    console.error(`[ERROR] RPA failed after ${formatDuration(totalDuration)}: ${err.message}`);
    console.error('');
    if (DEBUG) console.error(err.stack);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
      debug('Browser closed');
    }
  }
}

main();
