# Backend Quest v1.1.2

RPA, PDF Processing, Translation & Web Crawling — Node.js

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Quest 1: RPA Crawling (iros.go.kr)](#quest-1-rpa-crawling)
- [Quest 2: PDF Merging](#quest-2-pdf-merging)
- [Quest 3: PDF Translation (Korean → English)](#quest-3-pdf-translation)
- [Quest 4: Linux Web Crawling](#quest-4-linux-web-crawling)
- [Project Structure](#project-structure)
- [Performance Notes](#performance-notes)

---

## Prerequisites

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **Chromium/Chrome** (auto-installed via Puppeteer)
- **Linux** (for Quest 4; all quests also run on macOS/Windows)

### Linux-specific dependencies (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates fonts-liberation libappindicator3-1 \
  libasound2 libatk-bridge2.0-0 libatk1.0-0 libcups2 \
  libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 \
  libnss3 libx11-xcb1 libxcomposite1 libxdamage1 \
  libxrandr2 xdg-utils wget
```

---

## Setup

```bash
git clone <this-repo-url>
cd backend-quest
npm install
```

---

## Quest 1: RPA Crawling

**Goal:** Automatically extract PDF data from iros.go.kr (Korean Internet Registry Office).

**Performance target:** ≤ 16 seconds (ideal: ≤ 8 seconds)

### Usage

```bash
# Default: search for 서울특별시 강남구 역삼동
npm run quest1

# Custom address
npm run quest1 -- --address "서울특별시 서초구 서초동"

# Headed mode (visible browser) for debugging
npm run quest1 -- --headed

# Debug mode with verbose logging
npm run quest1:debug
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --address <addr>` | Korean address to search | 서울특별시 강남구 역삼동 |
| `-o, --output <dir>` | Output directory | `../output` |
| `--headed` | Show browser window | `false` |
| `--slow-mo <ms>` | Slow down operations | `0` |

### Key Design Decisions

- **Resource interception**: Blocks images, CSS, fonts, and analytics for maximum speed
- **Retry logic**: 3 automatic retries with exponential backoff
- **Frame handling**: iros.go.kr uses frames; the script detects and navigates them
- **Anti-detection**: Realistic user-agent and Korean language headers
- **Fallback**: If no direct PDF link is found, captures the page as PDF

---

## Quest 2: PDF Merging

**Goal:** Merge two PDF files (10-page + 3-page) into a single 13-page document.

### Usage

```bash
# Generate sample PDFs and merge them
npm run quest2

# Merge custom PDFs
npm run quest2 -- --pdf-a /path/to/first.pdf --pdf-b /path/to/second.pdf

# Merge in reverse order
npm run quest2 -- --order ba

# Select specific pages
npm run quest2 -- --pages-a "1-5" --pages-b "2-3"
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-a, --pdf-a <path>` | First PDF path | `./pdfs/document-a.pdf` |
| `-b, --pdf-b <path>` | Second PDF path | `./pdfs/document-b.pdf` |
| `-o, --output <path>` | Output path | `../output/merged.pdf` |
| `--order <ab\|ba>` | Merge order | `ab` |
| `--pages-a <range>` | Page range for PDF A | `all` |
| `--pages-b <range>` | Page range for PDF B | `all` |

### Features

- Auto-generates sample PDFs (10 + 3 pages) if none exist
- Selective page ranges (e.g., `1-5`, `2,4,6`, `all`)
- Preserves PDF metadata
- Minimal dependencies (pdf-lib only, no native binaries)

---

## Quest 3: PDF Translation

**Goal:** Extract Korean text from a PDF, translate it to English, and produce a translated PDF.

### Usage

```bash
# Generate sample Korean PDF, translate, and save
npm run quest3

# Translate a specific PDF
npm run quest3 -- --input /path/to/korean.pdf

# Overlay translation on original (preserves layout)
npm run quest3 -- --preserve-layout

# Debug mode (shows extracted and translated text previews)
DEBUG=true npm run quest3
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --input <path>` | Input Korean PDF | `./pdfs/korean-sample.pdf` |
| `-o, --output <path>` | Output path | `../output/translated.pdf` |
| `--source <lang>` | Source language | `ko` |
| `--target <lang>` | Target language | `en` |
| `--font-size <size>` | Translation font size | `10` |
| `--preserve-layout` | Overlay on original PDF | `false` |

### Pipeline

1. **Extract** — Uses `pdf-parse` to pull text from each PDF page
2. **Translate** — Sends text to Google Translate (chunked for long pages, rate-limited)
3. **Reformat** — Creates a new PDF with translated text (word-wrapped, paginated)

---

## Quest 4: Linux Web Crawling

**Goal:** Production-grade web crawler for iros.go.kr running on Linux with automation support.

### Usage

```bash
# Default crawl
npm run quest4

# Custom settings
npm run quest4 -- --url http://www.iros.go.kr --depth 2 --max-pages 20

# CSV output
npm run quest4 -- --format csv

# Debug mode
npm run quest4:debug
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-u, --url <url>` | Target URL | `http://www.iros.go.kr` |
| `-d, --depth <n>` | Max crawl depth | `3` |
| `-p, --max-pages <n>` | Max pages to crawl | `50` |
| `-f, --format <fmt>` | Output format (json/csv) | `json` |
| `-o, --output <dir>` | Output directory | `../output/crawl-data` |
| `--headed` | Show browser | `false` |

### Automation (Cron)

```bash
# Interactive cron setup
./quest4-linux-crawling/setup-cron.sh

# Or manually (every 6 hours):
crontab -e
0 */6 * * * cd /path/to/backend-quest && node quest4-linux-crawling/index.js >> quest4-linux-crawling/logs/cron-$(date +\%Y\%m\%d).log 2>&1
```

### Features

- **Structured output**: JSON and CSV with page data, links, images, tables
- **Error handling**: Retry with exponential backoff, graceful shutdown (SIGINT/SIGTERM)
- **Logging**: Winston logger with console + file outputs, separate error logs
- **Rate limiting**: Configurable delay between requests
- **Anti-detection**: User-agent rotation, Korean language headers
- **Deduplication**: URL normalization and visited-set tracking
- **Same-domain filtering**: Only follows links within the target domain

---

## Project Structure

```
backend-quest/
├── package.json
├── README.md
├── .gitignore
├── quest1-crawling/
│   ├── index.js          # RPA script (Puppeteer)
│   └── config.js         # Target URL, browser options, performance targets
├── quest2-merge-pdf/
│   ├── index.js          # PDF merger (pdf-lib)
│   └── pdfs/             # Input PDFs (auto-generated if missing)
├── quest3-translate-pdf/
│   ├── index.js          # Korean→English translator
│   └── pdfs/             # Input PDFs (auto-generated if missing)
├── quest4-linux-crawling/
│   ├── index.js          # Linux web crawler
│   ├── config.js         # Crawl settings, selectors, user agents
│   ├── setup-cron.sh     # Cron automation setup
│   └── logs/             # Crawl and error logs
└── output/               # All generated output files
```

---

## Performance Notes

### Quest 1 Optimization Strategies

1. **Resource blocking** — Images, CSS, fonts, and tracking scripts are intercepted and blocked
2. **DOM-ready navigation** — Uses `domcontentloaded` instead of `load` (skips waiting for all resources)
3. **Minimal viewport** — Reduced viewport size to avoid rendering unnecessary content
4. **Connection reuse** — Single browser instance with optimized Chrome flags
5. **Zero typing delay** — Input text is typed with `delay: 0`
6. **Parallel initialization** — Browser launch and page setup happen concurrently

### Quest 4 Optimization Strategies

1. **Concurrent page processing** — Configurable concurrent request count
2. **URL deduplication** — Normalized URL tracking avoids re-crawling
3. **Resource blocking** — Only HTML/JS loaded; images, CSS, and fonts are blocked
4. **Depth limiting** — Prevents deep crawling beyond useful pages
5. **Graceful shutdown** — Saves partial results on interruption

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `puppeteer` | Headless Chrome for RPA and crawling |
| `pdf-lib` | PDF creation, merging, and manipulation |
| `pdf-parse` | PDF text extraction |
| `google-translate-api-x` | Free Google Translate API |
| `winston` | Structured logging (Quest 4) |
| `commander` | CLI argument parsing |
| `cli-progress` | Progress bars |
