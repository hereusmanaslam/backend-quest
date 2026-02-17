#!/usr/bin/env node

/**
 * Quest 3: Translate PDF from Korean to English
 *
 * Extracts text from a Korean PDF, translates it via Google Translate,
 * and produces a new PDF with the English translation overlaid.
 */

const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const fs = require('node:fs');
const path = require('node:path');
const pdfParse = require('pdf-parse');
const translate = require('google-translate-api-x');
const puppeteer = require('puppeteer');
const { program } = require('commander');

// ── CLI Setup ──────────────────────────────────────────────────────────────

program
  .name('quest3-translate-pdf')
  .description('Translate a Korean PDF to English')
  .option('-i, --input <path>', 'Path to Korean PDF', './pdfs/korean-sample.pdf')
  .option('-o, --output <path>', 'Output path for translated PDF', '../output/translated.pdf')
  .option('--source <lang>', 'Source language', 'ko')
  .option('--target <lang>', 'Target language', 'en')
  .option('--font-size <size>', 'Font size for translated text', '10')
  .option('--preserve-layout', 'Attempt to preserve original layout', false)
  .parse(process.argv);

const opts = program.opts();
const DEBUG = process.env.DEBUG === 'true';
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// ── Helpers ────────────────────────────────────────────────────────────────

function resolveFilePath(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(__dirname, filePath);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Generate sample Korean PDF using Puppeteer (supports Korean chars) ─────

async function generateKoreanSamplePDF() {
  const koreanPages = [
    {
      title: '부동산 등기부등본',
      lines: [
        '등기부등본 (전부사항증명서)',
        '부동산의 표시',
        '서울특별시 강남구 역삼동 123-45',
        '대지면적: 330.5 제곱미터',
        '건물면적: 198.3 제곱미터',
        '용도: 주거용',
        '구조: 철근콘크리트조',
        '소유자: 홍길동',
        '등기원인: 매매',
        '접수일자: 2024년 1월 15일',
      ],
    },
    {
      title: '갑구 (소유권에 관한 사항)',
      lines: [
        '순위번호: 1',
        '등기목적: 소유권이전',
        '접수: 2024년 1월 15일 제12345호',
        '등기원인: 2024년 1월 10일 매매',
        '권리자 및 기타사항',
        '소유자 홍길동 서울특별시 강남구',
        '주민등록번호: 800101-*******',
        '',
        '순위번호: 2',
        '등기목적: 소유권이전등기신청',
      ],
    },
    {
      title: '을구 (소유권 이외의 권리에 관한 사항)',
      lines: [
        '순위번호: 1',
        '등기목적: 근저당권설정',
        '접수: 2024년 2월 1일 제23456호',
        '등기원인: 2024년 1월 30일 설정계약',
        '권리자 및 기타사항',
        '채권최고액: 금 500,000,000원',
        '근저당권자: 한국은행',
        '서울특별시 중구 남대문로 39',
        '채무자: 홍길동',
        '서울특별시 강남구 역삼동 123-45',
      ],
    },
  ];

  // Use Puppeteer to render Korean text into a PDF (Chrome handles CJK natively)
  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: 'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; font-size: 12px; line-height: 1.8; }
    .page { page-break-after: always; padding: 20px; }
    .page:last-child { page-break-after: auto; }
    h2 { font-size: 18px; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 16px; }
    p { margin: 4px 0; }
  </style>
</head>
<body>
${koreanPages
  .map(
    (pg) => `<div class="page">
  <h2>${pg.title}</h2>
  ${pg.lines.map((l) => `<p>${l || '&nbsp;'}</p>`).join('\n  ')}
</div>`,
  )
  .join('\n')}
</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
    });
    return { pdfBytes, koreanPages };
  } finally {
    await browser.close();
  }
}

// ── Step 1: Extract text from PDF ──────────────────────────────────────────

async function extractText(pdfPath) {
  log('Step 1: Extracting text from PDF...');

  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(dataBuffer);

  log(`  Extracted ${data.numpages} pages`);
  log(`  Total characters: ${data.text.length}`);

  // Split text by pages (pdf-parse uses form feed characters)
  const pageTexts = data.text
    .split(/\f/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (pageTexts.length === 0) {
    pageTexts.push(data.text);
  }

  log(`  Parsed ${pageTexts.length} text blocks`);
  return { pageTexts, totalPages: data.numpages, metadata: data.info };
}

// ── Step 2: Translate text ─────────────────────────────────────────────────

async function translateText(pageTexts, sourceLang, targetLang) {
  log(`Step 2: Translating from ${sourceLang} to ${targetLang}...`);

  const translatedPages = [];
  const CHUNK_SIZE = 4000; // Google Translate character limit per request

  for (let i = 0; i < pageTexts.length; i++) {
    const pageText = pageTexts[i];
    log(`  Translating page ${i + 1}/${pageTexts.length} (${pageText.length} chars)...`);

    if (pageText.length === 0) {
      translatedPages.push('');
      continue;
    }

    // Split long text into chunks
    const chunks = [];
    const lines = pageText.split('\n');
    let currentChunk = '';

    for (const line of lines) {
      if ((currentChunk + '\n' + line).length > CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk = currentChunk ? currentChunk + '\n' + line : line;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    // Translate each chunk
    const translatedChunks = [];

    for (const chunk of chunks) {
      try {
        const result = await translate(chunk, {
          from: sourceLang,
          to: targetLang,
        });
        translatedChunks.push(result.text);
      } catch (err) {
        log(`  [WARN] Translation failed for chunk, using original: ${err.message}`);
        translatedChunks.push(chunk);
      }

      // Rate limit: small delay between requests
      if (chunks.length > 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    translatedPages.push(translatedChunks.join('\n'));
    log(`  Page ${i + 1} translated successfully`);
  }

  return translatedPages;
}

// ── Step 3: Create translated PDF ──────────────────────────────────────────

async function createTranslatedPDF(translatedPages, originalPdfPath, outputPath) {
  log('Step 3: Creating translated PDF...');

  const fontSize = Number.parseInt(opts.fontSize, 10);
  const lineHeight = fontSize * 1.5;
  const margin = { top: 60, bottom: 50, left: 50, right: 50 };
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const maxWidth = pageWidth - margin.left - margin.right;

  let outputDoc;

  if (opts.preserveLayout) {
    // Load original PDF and overlay translated text
    log('  Mode: Overlay on original PDF');
    const originalBytes = fs.readFileSync(originalPdfPath);
    outputDoc = await PDFDocument.load(originalBytes);
    const font = await outputDoc.embedFont(StandardFonts.Helvetica);

    const pages = outputDoc.getPages();

    for (let i = 0; i < Math.min(pages.length, translatedPages.length); i++) {
      const page = pages[i];
      const { height } = page.getSize();
      const lines = translatedPages[i].split('\n');

      // Draw semi-transparent white background for readability
      page.drawRectangle({
        x: margin.left - 5,
        y: 30,
        width: maxWidth + 10,
        height: height - 60,
        color: rgb(1, 1, 1),
        opacity: 0.85,
      });

      // Draw translated text
      let yPos = height - margin.top;
      for (const line of lines) {
        if (yPos < margin.bottom) break;

        // Word wrap long lines
        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = font.widthOfTextAtSize(testLine, fontSize);

          if (testWidth > maxWidth && currentLine) {
            page.drawText(currentLine, {
              x: margin.left,
              y: yPos,
              size: fontSize,
              font,
              color: rgb(0, 0, 0.2),
            });
            yPos -= lineHeight;
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine && yPos >= margin.bottom) {
          page.drawText(currentLine, {
            x: margin.left,
            y: yPos,
            size: fontSize,
            font,
            color: rgb(0, 0, 0.2),
          });
          yPos -= lineHeight;
        }
      }
    }
  } else {
    // Create new PDF with only translated text
    log('  Mode: New document with translated text');
    outputDoc = await PDFDocument.create();
    const font = await outputDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await outputDoc.embedFont(StandardFonts.HelveticaBold);

    outputDoc.setTitle('Translated Document - Korean to English');
    outputDoc.setCreator('backend-quest');

    for (let i = 0; i < translatedPages.length; i++) {
      const lines = translatedPages[i].split('\n');
      let page = outputDoc.addPage([pageWidth, pageHeight]);
      let yPos = pageHeight - margin.top;

      // Page header
      page.drawText(`Translated Page ${i + 1}`, {
        x: margin.left,
        y: yPos,
        size: 14,
        font: boldFont,
        color: rgb(0.2, 0.2, 0.2),
      });
      yPos -= 30;

      // Separator line
      page.drawLine({
        start: { x: margin.left, y: yPos + 5 },
        end: { x: pageWidth - margin.right, y: yPos + 5 },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
      });
      yPos -= 15;

      for (const line of lines) {
        // Check if we need a new page
        if (yPos < margin.bottom) {
          page = outputDoc.addPage([pageWidth, pageHeight]);
          yPos = pageHeight - margin.top;

          page.drawText(`Translated Page ${i + 1} (cont.)`, {
            x: margin.left,
            y: yPos,
            size: 12,
            font: boldFont,
            color: rgb(0.4, 0.4, 0.4),
          });
          yPos -= 25;
        }

        if (line.trim().length === 0) {
          yPos -= lineHeight * 0.5;
          continue;
        }

        // Word wrap
        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const testWidth = font.widthOfTextAtSize(testLine, fontSize);

          if (testWidth > maxWidth && currentLine) {
            page.drawText(currentLine, {
              x: margin.left,
              y: yPos,
              size: fontSize,
              font,
            });
            yPos -= lineHeight;
            currentLine = word;

            if (yPos < margin.bottom) {
              page = outputDoc.addPage([pageWidth, pageHeight]);
              yPos = pageHeight - margin.top;
            }
          } else {
            currentLine = testLine;
          }
        }

        if (currentLine) {
          page.drawText(currentLine, {
            x: margin.left,
            y: yPos,
            size: fontSize,
            font,
          });
          yPos -= lineHeight;
        }
      }

      // Footer
      const lastPage = outputDoc.getPages()[outputDoc.getPageCount() - 1];
      lastPage.drawText(
        `Source: Korean | Target: English | Generated: ${new Date().toISOString()}`,
        {
          x: margin.left,
          y: 25,
          size: 7,
          font,
          color: rgb(0.5, 0.5, 0.5),
        },
      );
    }
  }

  // Save output
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputBytes = await outputDoc.save();
  fs.writeFileSync(outputPath, outputBytes);

  log(`  Output saved: ${outputPath} (${formatBytes(outputBytes.length)})`);
  return {
    outputPath,
    pageCount: outputDoc.getPageCount(),
    fileSize: outputBytes.length,
  };
}

// ── Ensure sample Korean PDF exists ────────────────────────────────────────

async function ensureSamplePDF() {
  const pdfDir = resolveFilePath('./pdfs');
  const samplePath = path.join(pdfDir, 'korean-sample.pdf');

  if (!fs.existsSync(pdfDir)) {
    fs.mkdirSync(pdfDir, { recursive: true });
  }

  if (!fs.existsSync(samplePath)) {
    log('Generating sample Korean PDF...');
    const { pdfBytes } = await generateKoreanSamplePDF();
    fs.writeFileSync(samplePath, pdfBytes);
    log(`  Created: ${samplePath} (${formatBytes(pdfBytes.length)})`);
  }

  return samplePath;
}

// ── Main Execution ─────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Quest 3: Translate PDF (Korean → English)              ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // Ensure sample PDF exists
    await ensureSamplePDF();

    const inputPath = resolveFilePath(opts.input);
    const outputPath = resolveFilePath(opts.output);

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input PDF not found: ${inputPath}`);
    }

    // Step 1: Extract text
    const { pageTexts, totalPages } = await extractText(inputPath);

    if (DEBUG) {
      console.log('\n  --- Extracted Text Preview ---');
      pageTexts.forEach((text, i) => {
        console.log(`  Page ${i + 1}: ${text.substring(0, 100)}...`);
      });
      console.log('  ---\n');
    }

    // Step 2: Translate
    const translatedPages = await translateText(pageTexts, opts.source, opts.target);

    if (DEBUG) {
      console.log('\n  --- Translated Text Preview ---');
      translatedPages.forEach((text, i) => {
        console.log(`  Page ${i + 1}: ${text.substring(0, 100)}...`);
      });
      console.log('  ---\n');
    }

    // Step 3: Create translated PDF
    const result = await createTranslatedPDF(translatedPages, inputPath, outputPath);

    const totalDuration = Date.now() - startTime;

    console.log('');
    console.log('┌──────────────────────────────────────────────────────────┐');
    console.log('│  RESULT                                                  │');
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log(`│  Status:        SUCCESS${''.padEnd(34)}│`);
    console.log(`│  Input pages:   ${String(totalPages).padEnd(40)}│`);
    console.log(`│  Output pages:  ${String(result.pageCount).padEnd(40)}│`);
    console.log(`│  Output size:   ${formatBytes(result.fileSize).padEnd(40)}│`);
    console.log(`│  Total time:    ${((totalDuration / 1000).toFixed(2) + 's').padEnd(40)}│`);
    console.log(`│  Output:        ${result.outputPath.slice(-40).padEnd(40)}│`);
    console.log('└──────────────────────────────────────────────────────────┘');
    console.log('');

  } catch (err) {
    console.error(`\n[ERROR] ${err.message}\n`);
    if (DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();
