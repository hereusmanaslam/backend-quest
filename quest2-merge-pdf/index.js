#!/usr/bin/env node

/**
 * Quest 2: Merge PDFs
 *
 * Combines two PDF files (A: 10 pages, B: 3 pages) into a single
 * 13-page document. Uses pdf-lib for efficient, dependency-free merging.
 */

const { PDFDocument } = require('pdf-lib');
const fs = require('node:fs');
const path = require('node:path');
const { program } = require('commander');

// ── CLI Setup ──────────────────────────────────────────────────────────────

program
  .name('quest2-merge-pdf')
  .description('Merge two PDF files into a single document')
  .option('-a, --pdf-a <path>', 'Path to first PDF (10 pages)', './pdfs/document-a.pdf')
  .option('-b, --pdf-b <path>', 'Path to second PDF (3 pages)', './pdfs/document-b.pdf')
  .option('-o, --output <path>', 'Output path for merged PDF', '../output/merged.pdf')
  .option('--order <order>', 'Merge order: "ab" or "ba"', 'ab')
  .option('--pages-a <range>', 'Page range for PDF A (e.g., "1-5" or "all")', 'all')
  .option('--pages-b <range>', 'Page range for PDF B (e.g., "1-3" or "all")', 'all')
  .parse(process.argv);

const opts = program.opts();

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveFilePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(__dirname, filePath);
}

function parsePageRange(range, totalPages) {
  if (range === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const pages = [];
  const parts = range.split(',');

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [start, end] = trimmed.split('-').map(Number);
      for (let i = start - 1; i < end && i < totalPages; i++) {
        pages.push(i);
      }
    } else {
      const pageNum = Number.parseInt(trimmed, 10) - 1;
      if (pageNum >= 0 && pageNum < totalPages) {
        pages.push(pageNum);
      }
    }
  }

  return pages;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Generate sample PDFs for testing ───────────────────────────────────────

async function generateSamplePDF(pageCount, title) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont('Helvetica');

  for (let i = 1; i <= pageCount; i++) {
    const page = pdf.addPage([595.28, 841.89]); // A4
    const { width, height } = page.getSize();

    // Title
    page.drawText(`${title}`, {
      x: 50,
      y: height - 80,
      size: 24,
      font,
    });

    // Page indicator
    page.drawText(`Page ${i} of ${pageCount}`, {
      x: 50,
      y: height - 120,
      size: 16,
      font,
    });

    // Border
    page.drawRectangle({
      x: 30,
      y: 30,
      width: width - 60,
      height: height - 60,
      borderWidth: 1,
      opacity: 0,
      borderOpacity: 0.3,
    });

    // Sample content
    const lines = [
      `This is a sample document for Quest 2: PDF Merging.`,
      `Document: ${title}`,
      `Current page: ${i} / ${pageCount}`,
      `Generated: ${new Date().toISOString()}`,
      '',
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
      'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
      'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    ];

    lines.forEach((line, idx) => {
      page.drawText(line, {
        x: 50,
        y: height - 180 - idx * 24,
        size: 12,
        font,
      });
    });

    // Footer
    page.drawText(`${title} - Page ${i}`, {
      x: width / 2 - 50,
      y: 50,
      size: 10,
      font,
    });
  }

  return pdf.save();
}

async function ensureSamplePDFs() {
  const pdfDir = resolveFilePath('./pdfs');

  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
  }

  const pathA = path.join(pdfDir, 'document-a.pdf');
  const pathB = path.join(pdfDir, 'document-b.pdf');

  if (!fs.existsSync(pathA)) {
    console.log('  Generating sample PDF A (10 pages)...');
    const bytes = await generateSamplePDF(10, 'Document A');
    fs.writeFileSync(pathA, bytes);
    console.log(`  Created: ${pathA} (${formatBytes(bytes.length)})`);
  }

  if (!fs.existsSync(pathB)) {
    console.log('  Generating sample PDF B (3 pages)...');
    const bytes = await generateSamplePDF(3, 'Document B');
    fs.writeFileSync(pathB, bytes);
    console.log(`  Created: ${pathB} (${formatBytes(bytes.length)})`);
  }
}

// ── Core: Merge PDFs ───────────────────────────────────────────────────────

async function mergePDFs(pdfPathA, pdfPathB, outputPath, order, pagesA, pagesB) {
  const startTime = Date.now();

  // Read input PDFs
  const bytesA = fs.readFileSync(pdfPathA);
  const bytesB = fs.readFileSync(pdfPathB);

  console.log(`  PDF A: ${pdfPathA} (${formatBytes(bytesA.length)})`);
  console.log(`  PDF B: ${pdfPathB} (${formatBytes(bytesB.length)})`);

  // Load PDFs
  const docA = await PDFDocument.load(bytesA);
  const docB = await PDFDocument.load(bytesB);

  const totalPagesA = docA.getPageCount();
  const totalPagesB = docB.getPageCount();

  console.log(`  PDF A pages: ${totalPagesA}`);
  console.log(`  PDF B pages: ${totalPagesB}`);

  // Determine page indices to copy
  const indicesA = parsePageRange(pagesA, totalPagesA);
  const indicesB = parsePageRange(pagesB, totalPagesB);

  // Create merged document
  const merged = await PDFDocument.create();

  // Copy metadata from first document
  merged.setTitle('Merged Document - Quest 2');
  merged.setCreator('backend-quest');
  merged.setProducer('pdf-lib');
  merged.setCreationDate(new Date());

  // Determine merge order
  const sources = order === 'ab'
    ? [{ doc: docA, indices: indicesA, label: 'A' }, { doc: docB, indices: indicesB, label: 'B' }]
    : [{ doc: docB, indices: indicesB, label: 'B' }, { doc: docA, indices: indicesA, label: 'A' }];

  for (const { doc, indices, label } of sources) {
    const copiedPages = await merged.copyPages(doc, indices);
    for (const page of copiedPages) {
      merged.addPage(page);
    }
    console.log(`  Copied ${copiedPages.length} pages from PDF ${label}`);
  }

  const mergedPageCount = merged.getPageCount();
  console.log(`  Total merged pages: ${mergedPageCount}`);

  // Save merged PDF
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const mergedBytes = await merged.save();
  fs.writeFileSync(outputPath, mergedBytes);

  const duration = Date.now() - startTime;

  return {
    outputPath,
    totalPages: mergedPageCount,
    fileSize: mergedBytes.length,
    duration,
    sourcePagesA: indicesA.length,
    sourcePagesB: indicesB.length,
  };
}

// ── Main Execution ─────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Quest 2: PDF Merging                                   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Ensure sample PDFs exist
    await ensureSamplePDFs();
    console.log('');

    const pdfPathA = resolveFilePath(opts.pdfA);
    const pdfPathB = resolveFilePath(opts.pdfB);
    const outputPath = resolveFilePath(opts.output);

    // Validate inputs
    if (!fs.existsSync(pdfPathA)) {
      throw new Error(`PDF A not found: ${pdfPathA}`);
    }
    if (!fs.existsSync(pdfPathB)) {
      throw new Error(`PDF B not found: ${pdfPathB}`);
    }

    console.log('  Merging PDFs...');
    console.log(`  Order: ${opts.order === 'ab' ? 'A then B' : 'B then A'}`);
    console.log('');

    const result = await mergePDFs(
      pdfPathA,
      pdfPathB,
      outputPath,
      opts.order,
      opts.pagesA,
      opts.pagesB,
    );

    console.log('');
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│  RESULT                                                  │');
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log(`│  Status:      SUCCESS${''.padEnd(36)}│`);
    console.log(`│  Output:      ${result.outputPath.slice(-42).padEnd(42)}│`);
    console.log(`│  Total pages: ${String(result.totalPages).padEnd(42)}│`);
    console.log(`│  File size:   ${formatBytes(result.fileSize).padEnd(42)}│`);
    console.log(`│  Duration:    ${(result.duration + 'ms').padEnd(42)}│`);
    console.log(`│  Pages from A: ${String(result.sourcePagesA).padEnd(41)}│`);
    console.log(`│  Pages from B: ${String(result.sourcePagesB).padEnd(41)}│`);
    console.log('└──────────────────────────────────────────────────────────┘');
    console.log('');

  } catch (err) {
    console.error(`\n[ERROR] ${err.message}\n`);
    if (process.env.DEBUG === 'true') console.error(err.stack);
    process.exit(1);
  }
}

main();
