/**
 * Re-render seller product tax invoices (TAX_INVOICE /
 * INVOICE_CUM_BILL_OF_SUPPLY) with the current HTML template and overwrite
 * the stored HTML under storage/tax-pdfs. Use after a template change to
 * refresh the on-disk artifacts the dev download links serve.
 *
 * Mirrors TaxDocumentPdfService.buildStoragePath:
 *   <FY>/<supplierGstin|PLATFORM>/<documentType>/<documentNumber>.html
 *
 * USAGE (from apps/api):
 *   npx ts-node prisma/scripts/regenerate-tax-invoices.ts
 *   npx ts-node prisma/scripts/regenerate-tax-invoices.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
import {
  renderHtmlForDocument,
  type TemplateInput,
} from '../../src/modules/tax/domain/tax-document-html-template';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const docs = await prisma.taxDocument.findMany({
    where: { documentType: { in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'] } },
    include: { lines: { orderBy: { lineNumber: 'asc' } } },
    orderBy: { documentNumber: 'asc' },
  });

  const rootDir = resolve(process.cwd(), 'storage', 'tax-pdfs');
  console.log(`Found ${docs.length} invoice document(s)${dryRun ? ' [DRY RUN]' : ''}.`);

  let written = 0;
  for (const doc of docs) {
    const html = renderHtmlForDocument({
      mode: 'OFF',
      document: doc,
      lines: doc.lines,
    } as TemplateInput);

    const supplier = doc.supplierGstin ?? 'PLATFORM';
    const safeNumber = doc.documentNumber.replace(/[/\\]/g, '-');
    const storagePath = `${doc.financialYear}/${supplier}/${doc.documentType}/${safeNumber}.html`;
    const absPath = join(rootDir, storagePath);
    const sha = createHash('sha256').update(html, 'utf-8').digest('hex');

    if (dryRun) {
      console.log(`  · would write ${storagePath} (${Buffer.byteLength(html)} bytes, ${doc.lines.length} lines)`);
      continue;
    }
    await fs.mkdir(dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, Buffer.from(html, 'utf-8'));
    written++;
    console.log(`  ✓ wrote ${storagePath} (${Buffer.byteLength(html)} bytes, ${doc.lines.length} lines, sha256=${sha.slice(0, 12)}…)`);
  }
  console.log(`\nDone. ${dryRun ? 'Dry run — nothing written.' : `Written: ${written}`}`);
}

main()
  .catch((err) => {
    console.error('regenerate-tax-invoices failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
