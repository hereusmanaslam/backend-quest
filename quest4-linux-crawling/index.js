#!/usr/bin/env node

/**
 * Quest 4: Web Crawling from Linux
 *
 * Production-grade web crawler for iros.go.kr running on Linux.
 * Features: error handling, logging, retry logic, structured output,
 * rate limiting, user-agent rotation, and cron-compatible automation.
 */

const puppeteer = require('puppeteer');
const fs = require('node:fs');
const path = require('node:path');
const { program } = require('commander');
const winston = require('winston');
const config = require('./config');

// ── CLI Setup ──────────────────────────────────────────────────────────────

program
  .name('quest4-linux-crawling')
  .description('Linux web crawler for iros.go.kr')
  .option('-u, --url <url>', 'Target URL to crawl', config.TARGET_URL)
  .option('-d, --depth <depth>', 'Maximum crawl depth', String(config.CRAWL.MAX_DEPTH))
  .option('-p, --max-pages <pages>', 'Maximum pages to crawl', String(config.CRAWL.MAX_PAGES))
  .option('-f, --format <format>', 'Output format: json or csv', config.OUTPUT.FORMAT)
  .option('-o, --output <dir>', 'Output directory', config.OUTPUT.DIR)
  .option('--headed', 'Run browser in headed mode', false)
  .option('--no-screenshots', 'Disable screenshots')
  .parse(process.argv);

const opts = program.opts();

// ── Logger Setup (Winston) ─────────────────────────────────────────────────

const logDir = path.resolve(__dirname, config.OUTPUT.LOG_DIR);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');

const logger = winston.createLogger({
  level: process.env.DEBUG === 'true' ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp: ts, level, message }) => {
      return `[${ts}] [${level.toUpperCase()}] ${message}`;
    }),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp: ts, level, message }) => {
          return `[${ts}] [${level}] ${message}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, `crawl-${timestamp}.log`),
    }),
    new winston.transports.File({
      filename: path.join(logDir, `crawl-error-${timestamp}.log`),
      level: 'error',
    }),
  ],
});

// ── Data Structures ────────────────────────────────────────────────────────

class CrawlResult {
  constructor() {
    this.pages = [];
    this.errors = [];
    this.startTime = Date.now();
    this.endTime = null;
    this.stats = {
      totalPages: 0,
      successfulPages: 0,
      failedPages: 0,
      totalLinks: 0,
      totalImages: 0,
      totalTables: 0,
    };
  }

  addPage(pageData) {
    this.pages.push(pageData);
    this.stats.totalPages++;
    this.stats.successfulPages++;
    this.stats.totalLinks += pageData.links?.length || 0;
    this.stats.totalImages += pageData.images?.length || 0;
    this.stats.totalTables += pageData.tables?.length || 0;
  }

  addError(url, error) {
    this.errors.push({ url, error: error.message, timestamp: new Date().toISOString() });
    this.stats.totalPages++;
    this.stats.failedPages++;
  }

  finalize() {
    this.endTime = Date.now();
    this.stats.duration = this.endTime - this.startTime;
    return this;
  }
}

// ── URL Queue with deduplication ───────────────────────────────────────────

class URLQueue {
  constructor(maxPages) {
    this.queue = [];
    this.visited = new Set();
    this.maxPages = maxPages;
  }

  add(url, depth) {
    const normalized = this.normalize(url);
    if (!normalized) return false;
    if (this.visited.has(normalized)) return false;
    if (this.visited.size >= this.maxPages) return false;

    this.queue.push({ url: normalized, depth });
    this.visited.add(normalized);
    return true;
  }

  next() {
    return this.queue.shift();
  }

  hasMore() {
    return this.queue.length > 0;
  }

  get size() {
    return this.visited.size;
  }

  normalize(url) {
    try {
      const parsed = new URL(url);
      // Remove fragments and trailing slashes
      parsed.hash = '';
      let normalized = parsed.toString();
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return null;
    }
  }
}

// ── Core Crawler ───────────────────────────────────────────────────────────

class WebCrawler {
  constructor(options) {
    this.baseUrl = options.url;
    this.maxDepth = Number.parseInt(options.depth, 10);
    this.maxPages = Number.parseInt(options.maxPages, 10);
    this.outputDir = path.resolve(__dirname, options.output);
    this.format = options.format;
    this.screenshots = options.screenshots !== false;
    this.headed = options.headed;

    this.queue = new URLQueue(this.maxPages);
    this.result = new CrawlResult();
    this.browser = null;
    this.userAgentIdx = 0;
  }

  getNextUserAgent() {
    const ua = config.USER_AGENTS[this.userAgentIdx % config.USER_AGENTS.length];
    this.userAgentIdx++;
    return ua;
  }

  async init() {
    logger.info('Initializing crawler...');

    // Ensure output directories exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Launch browser
    const browserOpts = {
      ...config.BROWSER_OPTIONS,
      headless: this.headed ? false : 'new',
    };

    this.browser = await puppeteer.launch(browserOpts);
    logger.info('Browser launched');
  }

  async crawl() {
    logger.info(`Starting crawl of ${this.baseUrl}`);
    logger.info(`Max depth: ${this.maxDepth}, Max pages: ${this.maxPages}`);

    // Seed the queue
    this.queue.add(this.baseUrl, 0);

    while (this.queue.hasMore() && this.result.stats.successfulPages < this.maxPages) {
      const item = this.queue.next();
      if (!item) break;

      const { url, depth } = item;

      if (depth > this.maxDepth) {
        logger.debug(`Skipping ${url} (depth ${depth} > max ${this.maxDepth})`);
        continue;
      }

      await this.crawlPage(url, depth);

      // Rate limiting
      await new Promise((r) => setTimeout(r, config.CRAWL.REQUEST_DELAY));
    }

    return this.result.finalize();
  }

  async crawlPage(url, depth) {
    const pageStart = Date.now();
    logger.info(`[${this.result.stats.totalPages + 1}/${this.maxPages}] Crawling: ${url} (depth: ${depth})`);

    let page;
    let retries = 0;

    while (retries <= config.MAX_RETRIES) {
      try {
        page = await this.browser.newPage();

        // Set user agent (rotation for anti-detection)
        await page.setUserAgent(this.getNextUserAgent());

        // Set headers
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        });

        // Optimize: block unnecessary resources
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const type = request.resourceType();
          if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
            request.abort();
          } else {
            request.continue();
          }
        });

        // Navigate
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: config.CRAWL.PAGE_TIMEOUT,
        });

        const statusCode = response?.status() || 0;

        if (statusCode >= 400) {
          throw new Error(`HTTP ${statusCode}`);
        }

        // Extract data
        const pageData = await this.extractPageData(page, url, depth);
        pageData.statusCode = statusCode;
        pageData.loadTime = Date.now() - pageStart;

        // Discover new links
        if (depth < this.maxDepth) {
          const newLinks = this.filterLinks(pageData.links || []);
          let added = 0;
          for (const link of newLinks) {
            if (this.queue.add(link, depth + 1)) added++;
          }
          logger.debug(`  Discovered ${newLinks.length} links, queued ${added} new`);
        }

        this.result.addPage(pageData);
        logger.info(`  OK (${pageData.loadTime}ms) - ${pageData.title || 'No title'}`);
        break;

      } catch (err) {
        retries++;
        if (retries > config.MAX_RETRIES) {
          logger.error(`  FAILED after ${config.MAX_RETRIES} retries: ${err.message}`);
          this.result.addError(url, err);
        } else {
          logger.warn(`  Retry ${retries}/${config.MAX_RETRIES}: ${err.message}`);
          await new Promise((r) => setTimeout(r, config.RETRY_DELAY * retries));
        }
      } finally {
        if (page) {
          await page.close().catch(() => {});
        }
      }
    }
  }

  async extractPageData(page, url, depth) {
    return page.evaluate((selectors) => {
      const getText = (el) => (el?.textContent || '').trim();
      const getAttr = (el, attr) => (el?.getAttribute(attr) || '').trim();

      // Title
      const title = getText(document.querySelector('title'));

      // Headings
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: getText(el),
      }));

      // Links
      const links = Array.from(document.querySelectorAll(selectors.links))
        .map((el) => ({
          href: getAttr(el, 'href'),
          text: getText(el).substring(0, 100),
        }))
        .filter((l) => l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('#'));

      // Resolve relative URLs
      const resolvedLinks = links.map((l) => {
        try {
          return { ...l, href: new URL(l.href, window.location.origin).toString() };
        } catch {
          return l;
        }
      });

      // Images
      const images = Array.from(document.querySelectorAll(selectors.images)).map((el) => ({
        src: getAttr(el, 'src'),
        alt: getAttr(el, 'alt'),
      }));

      // Tables
      const tables = Array.from(document.querySelectorAll(selectors.tables)).map((table) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        return rows.slice(0, 10).map((row) => {
          return Array.from(row.querySelectorAll('td, th')).map((cell) => getText(cell));
        });
      });

      // Text content
      const textContent = Array.from(document.querySelectorAll('p, li'))
        .map((el) => getText(el))
        .filter((t) => t.length > 0)
        .slice(0, 50);

      // Meta tags
      const meta = {};
      document.querySelectorAll('meta[name], meta[property]').forEach((el) => {
        const key = getAttr(el, 'name') || getAttr(el, 'property');
        if (key) meta[key] = getAttr(el, 'content');
      });

      return {
        title,
        headings,
        links: resolvedLinks,
        images,
        tables,
        textContent,
        meta,
      };
    }, config.SELECTORS).then((data) => ({
      url,
      depth,
      timestamp: new Date().toISOString(),
      ...data,
    }));
  }

  filterLinks(links) {
    const baseHost = new URL(this.baseUrl).hostname;

    return links
      .map((l) => l.href)
      .filter((href) => {
        try {
          const parsed = new URL(href);
          // Only follow links on the same domain
          return parsed.hostname === baseHost || parsed.hostname.endsWith('.' + baseHost);
        } catch {
          return false;
        }
      });
  }

  async saveResults() {
    const outputBase = path.join(this.outputDir, `crawl-${timestamp}`);

    if (this.format === 'json' || this.format === 'both') {
      const jsonPath = `${outputBase}.json`;
      const output = {
        crawl: {
          targetUrl: this.baseUrl,
          startTime: new Date(this.result.startTime).toISOString(),
          endTime: new Date(this.result.endTime).toISOString(),
          duration: `${(this.result.stats.duration / 1000).toFixed(2)}s`,
          config: {
            maxDepth: this.maxDepth,
            maxPages: this.maxPages,
          },
        },
        stats: this.result.stats,
        pages: this.result.pages,
        errors: this.result.errors,
      };
      fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
      logger.info(`JSON output saved: ${jsonPath}`);
    }

    if (this.format === 'csv' || this.format === 'both') {
      const csvPath = `${outputBase}.csv`;
      const headers = ['url', 'depth', 'title', 'statusCode', 'loadTime', 'linksCount', 'imagesCount', 'timestamp'];
      const rows = this.result.pages.map((p) => [
        `"${p.url}"`,
        p.depth,
        `"${(p.title || '').replaceAll(/"/g, '""')}"`,
        p.statusCode,
        p.loadTime,
        p.links?.length || 0,
        p.images?.length || 0,
        p.timestamp,
      ]);

      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      fs.writeFileSync(csvPath, csv);
      logger.info(`CSV output saved: ${csvPath}`);
    }

    // Save error log separately
    if (this.result.errors.length > 0) {
      const errorPath = `${outputBase}-errors.json`;
      fs.writeFileSync(errorPath, JSON.stringify(this.result.errors, null, 2));
      logger.info(`Error log saved: ${errorPath}`);
    }
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}

// ── Main Execution ─────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Quest 4: Linux Web Crawler                             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Target:    ${opts.url.padEnd(44)}║`);
  console.log(`║  Depth:     ${opts.depth.padEnd(44)}║`);
  console.log(`║  Max pages: ${opts.maxPages.padEnd(44)}║`);
  console.log(`║  Format:    ${opts.format.padEnd(44)}║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  const crawler = new WebCrawler(opts);

  // Handle graceful shutdown
  const shutdown = async (signal) => {
    logger.warn(`Received ${signal}, shutting down gracefully...`);
    await crawler.saveResults().catch((e) => logger.error(`Save error: ${e.message}`));
    await crawler.cleanup();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await crawler.init();
    await crawler.crawl();
    await crawler.saveResults();

    const { stats } = crawler.result;
    const duration = (stats.duration / 1000).toFixed(2);

    console.log('');
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│  CRAWL REPORT                                            │');
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log(`│  Status:          COMPLETE${''.padEnd(31)}│`);
    console.log(`│  Duration:        ${(duration + 's').padEnd(38)}│`);
    console.log(`│  Pages crawled:   ${String(stats.successfulPages).padEnd(38)}│`);
    console.log(`│  Pages failed:    ${String(stats.failedPages).padEnd(38)}│`);
    console.log(`│  Links found:     ${String(stats.totalLinks).padEnd(38)}│`);
    console.log(`│  Images found:    ${String(stats.totalImages).padEnd(38)}│`);
    console.log(`│  Tables found:    ${String(stats.totalTables).padEnd(38)}│`);
    console.log(`│  Output dir:      ${crawler.outputDir.slice(-38).padEnd(38)}│`);
    console.log('└──────────────────────────────────────────────────────────┘');
    console.log('');

    // Log summary to file
    logger.info(`Crawl complete: ${stats.successfulPages} pages in ${duration}s`);

  } catch (err) {
    logger.error(`Crawl failed: ${err.message}`);
    if (process.env.DEBUG === 'true') logger.error(err.stack);
    process.exit(1);
  } finally {
    await crawler.cleanup();
  }
}

main();
