import crypto from 'crypto';
import { prisma } from '../config/db';
import { AuthUser } from '../models/auth';
import {
  CPSE_MAP,
  RawIntakeRow,
  ValidatedIntakeRow,
  EnrichedIntakeRow,
  IntakeRejection,
  IntakeWarning,
  IntakeValidationReport,
  QualityIssue,
} from '../models/intake';
import { NormalizationService } from './normalizationService';
import { ExtractionService } from './extractionService';

export class IntakeService {
  private static processedFileHashes = new Set<string>();

  private static recentBatches: Array<{
    id: string;
    action: string;
    target: string;
    actor: string;
    role: string;
    detail: string;
    createdAt: string;
    extra: Record<string, unknown>;
  }> = [];

  private static batchRecordsMap = new Map<string, EnrichedIntakeRow[]>();

  static getRecentBatches() {
    return [...this.recentBatches];
  }

  static getBatchRecords(batchId: string): EnrichedIntakeRow[] {
    return this.batchRecordsMap.get(batchId) || [];
  }

  static parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
          i++;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }

    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter(r => r.some(c => c.trim() !== ''));
  }

  static parseContent(
    text: string,
    filename: string
  ): {
    rawRows: Array<{ line: number; raw: string; data: RawIntakeRow }>;
    missingColumns: string[];
    rejections: IntakeRejection[];
  } {
    const rejections: IntakeRejection[] = [];
    const rawRows: Array<{ line: number; raw: string; data: RawIntakeRow }> = [];
    const isJSON = /\.json$/i.test(filename) || /^\s*[[{]/.test(text);

    if (isJSON) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        rejections.push({
          line: 0,
          raw: text.slice(0, 100),
          reason: `File is not valid JSON: ${(err as Error).message}`,
        });
        return { rawRows, missingColumns: [], rejections };
      }

      let arrayData: unknown[] = [];
      if (Array.isArray(parsed)) {
        arrayData = parsed;
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.records)) arrayData = obj.records;
        else if (Array.isArray(obj.materials)) arrayData = obj.materials;
        else if (Array.isArray(obj.items)) arrayData = obj.items;
        else arrayData = [obj];
      }

      const allKeys = new Set<string>();
      arrayData.forEach((item, idx) => {
        if (typeof item === 'object' && item !== null) {
          const normalizedObj: RawIntakeRow = {};
          for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
            const keyNorm = k.toLowerCase().trim();
            normalizedObj[keyNorm] = v;
            allKeys.add(keyNorm);
          }
          rawRows.push({
            line: idx + 1,
            raw: JSON.stringify(item).slice(0, 140),
            data: normalizedObj,
          });
        }
      });

      const missingColumns: string[] = [];
      if (!allKeys.has('cpse')) missingColumns.push('cpse');
      if (!allKeys.has('code')) missingColumns.push('code');
      if (!allKeys.has('description') && !allKeys.has('desc')) missingColumns.push('description');
      if (!allKeys.has('unit') && !allKeys.has('uom')) missingColumns.push('unit');

      return { rawRows, missingColumns, rejections };
    }

    const rows = this.parseCSV(text);
    if (rows.length === 0) {
      rejections.push({
        line: 0,
        raw: '',
        reason: 'File is empty.',
      });
      return { rawRows, missingColumns: [], rejections };
    }

    const header = rows[0].map(h => h.trim().toLowerCase());
    const missingColumns: string[] = [];
    if (!header.includes('cpse')) missingColumns.push('cpse');
    if (!header.includes('code')) missingColumns.push('code');
    if (!header.includes('description') && !header.includes('desc')) missingColumns.push('description');
    if (!header.includes('unit') && !header.includes('uom')) missingColumns.push('unit');

    if (missingColumns.length > 0) {
      return { rawRows, missingColumns, rejections };
    }

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 1;
      const rawText = row.join(',');

      if (row.length !== header.length) {
        rejections.push({
          line: lineNum,
          raw: rawText,
          reason: `Expected ${header.length} columns, found ${row.length}.`,
        });
        continue;
      }

      const rowObj: RawIntakeRow = {};
      for (let j = 0; j < header.length; j++) {
        rowObj[header[j]] = row[j];
      }

      rawRows.push({
        line: lineNum,
        raw: rawText,
        data: rowObj,
      });
    }

    return { rawRows, missingColumns, rejections };
  }

  static validateRows(
    rawRows: Array<{ line: number; raw: string; data: RawIntakeRow }>,
    user?: AuthUser | null,
    targetCpse?: string
  ): {
    validRows: ValidatedIntakeRow[];
    rejections: IntakeRejection[];
    warnings: IntakeWarning[];
  } {
    const validRows: ValidatedIntakeRow[] = [];
    const rejections: IntakeRejection[] = [];
    const warnings: IntakeWarning[] = [];
    const seenInBatch = new Set<string>();

    for (const { line, raw, data } of rawRows) {
      const rawCpse = String(data.cpse ?? targetCpse ?? '').trim().toUpperCase();
      const canonicalCpse = CPSE_MAP[rawCpse];

      if (!canonicalCpse) {
        rejections.push({
          line,
          raw,
          reason: `Unknown CPSE "${rawCpse}". Use A–E or PETRO, POWER, STEEL, MINES, HVENG.`,
        });
        continue;
      }

      if (user && user.role === 'CPSE_ADMIN' && user.tenantId) {
        if (canonicalCpse !== user.tenantId) {
          rejections.push({
            line,
            raw,
            reason: `Row belongs to CPSE ${canonicalCpse}. A CPSE administrator can only upload for CPSE ${user.tenantId}.`,
          });
          continue;
        }
      }

      const code = String(data.code ?? '').trim();
      if (!code) {
        rejections.push({
          line,
          raw,
          reason: 'Legacy material code is empty.',
        });
        continue;
      }

      const desc = String(data.description ?? data.desc ?? '').trim();
      if (!desc) {
        rejections.push({
          line,
          raw,
          reason: 'Description is empty.',
        });
        continue;
      }

      const unitRaw = String(data.unit ?? data.uom ?? '').trim();
      if (!unitRaw) {
        rejections.push({
          line,
          raw,
          reason: 'Unit of measure is missing.',
        });
        continue;
      }

      const batchKey = `${canonicalCpse}|${code}`;
      if (seenInBatch.has(batchKey)) {
        warnings.push({
          line,
          raw,
          reason: `Duplicate legacy code "${code}" within this upload. Row accepted with flag INTRA_DUP.`,
        });
      } else {
        seenInBatch.add(batchKey);
      }

      let price: number | undefined;
      let qty: number | undefined;
      if (data.price !== undefined && data.price !== null && data.price !== '') {
        const parsedPrice = parseFloat(String(data.price));
        if (Number.isFinite(parsedPrice) && parsedPrice >= 0) {
          price = parsedPrice;
        }
      }

      if (data.qty !== undefined && data.qty !== null && data.qty !== '') {
        const parsedQty = parseFloat(String(data.qty));
        if (Number.isFinite(parsedQty) && parsedQty >= 0) {
          qty = parsedQty;
        }
      }

      let year: number | undefined;
      if (data.year !== undefined && data.year !== null && data.year !== '') {
        const parsedYear = parseInt(String(data.year), 10);
        if (Number.isFinite(parsedYear)) year = parsedYear;
      }

      if (price === undefined || qty === undefined) {
        warnings.push({
          line,
          raw,
          reason: 'No valid price or quantity: procurement context will be neutral for this record.',
        });
      }

      validRows.push({
        line,
        raw,
        cpseId: canonicalCpse,
        code,
        rawDesc: desc,
        unit: unitRaw,
        price,
        qty,
        supplier: data.supplier ? String(data.supplier).trim() : undefined,
        year: year || 2026,
        plant: data.plant ? String(data.plant).trim() : undefined,
      });
    }

    return { validRows, rejections, warnings };
  }

  static async enrichBatch(
    validRows: ValidatedIntakeRow[],
    batchId: string
  ): Promise<EnrichedIntakeRow[]> {
    const results: EnrichedIntakeRow[] = [];

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const recordId = `u${batchId.slice(-6)}_${i + 1}`;

      const normDesc = NormalizationService.normalizeText(row.rawDesc);
      const unitInfo = NormalizationService.normalizeUnit(row.unit);

      const extraction = await ExtractionService.extract(row.rawDesc);

      const qualityIssues: QualityIssue[] = [];

      if (!unitInfo) {
        qualityIssues.push({
          type: 'INVALID_UNIT',
          msg: `Unrecognized unit symbol "${row.unit}". Defaulting to unscaled count.`,
        });
      }

      if (extraction.missingCritical.length > 0) {
        qualityIssues.push({
          type: 'MISSING_ATTR',
          msg: `Missing critical attributes: ${extraction.missingCritical.join(', ')}`,
        });
      }

      if (extraction.category === 'UNCLASSIFIED') {
        qualityIssues.push({
          type: 'UNCLASSIFIED',
          msg: 'Insufficient information to identify material equipment category.',
        });
      }

      if (row.price === undefined || row.qty === undefined) {
        qualityIssues.push({
          type: 'NO_PRICE',
          msg: 'Missing price or quantity history.',
        });
      }

      let outcomeStatus: 'MATCHED' | 'PROPOSED_NEW' | 'NEEDS_REVIEW' | 'UNCLASSIFIED';
      let outcomeSummary: string;
      let badgeClass: 'p-ok' | 'p-acc' | 'p-warn' | 'p-mute';

      if (extraction.category === 'UNCLASSIFIED') {
        outcomeStatus = 'UNCLASSIFIED';
        outcomeSummary = 'Insufficient information. Not matched. Needs a more specific engineering description.';
        badgeClass = 'p-mute';
      } else if (extraction.missingCritical.length > 0) {
        outcomeStatus = 'NEEDS_REVIEW';
        outcomeSummary = `Incomplete attributes. Missing ${extraction.missingCritical.join(', ')}. Routed to human review.`;
        badgeClass = 'p-warn';
      } else {
        outcomeStatus = 'PROPOSED_NEW';
        outcomeSummary = `Complete specification for ${extraction.category}. Ready for national catalog matching.`;
        badgeClass = 'p-acc';
      }

      const history =
        row.price !== undefined && row.qty !== undefined
          ? [
              {
                price: row.price,
                qty: row.qty,
                supplier: row.supplier || 'Standard Supplier',
                year: row.year || 2026,
              },
            ]
          : [];

      results.push({
        id: recordId,
        line: row.line,
        cpseId: row.cpseId,
        code: row.code,
        rawDesc: row.rawDesc,
        normDesc,
        category: extraction.category,
        attrs: extraction.attrs,
        unit: row.unit,
        unitInfo,
        history,
        missingCritical: extraction.missingCritical,
        qualityIssues,
        usedGemini: extraction.usedGemini,
        outcome: {
          status: outcomeStatus,
          summary: outcomeSummary,
          badgeClass,
        },
      });
    }

    return results;
  }

  static async processIntake(
    text: string,
    filename: string,
    options: {
      dryRun?: boolean;
      user?: AuthUser | null;
      targetCpse?: string;
    } = {}
  ): Promise<IntakeValidationReport> {
    const now = new Date().toISOString();
    const dryRun = options.dryRun ?? false;
    const fileHash = crypto.createHash('sha256').update(text.trim()).digest('hex');

    const isDuplicate = this.processedFileHashes.has(fileHash);
    if (isDuplicate) {
      return {
        success: true,
        batchId: `dup_${fileHash.slice(0, 8)}`,
        file: filename,
        fileHash,
        duplicateUpload: true,
        totalRows: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        warningCount: 0,
        accepted: [],
        rejected: [],
        warnings: [
          {
            line: '–',
            raw: filename,
            reason: 'This exact file has already been ingested. Duplicate upload ignored.',
          },
        ],
        dryRun,
        createdAt: now,
      };
    }

    const { rawRows, missingColumns, rejections: parseRejections } = this.parseContent(text, filename);

    if (missingColumns.length > 0) {
      parseRejections.push({
        line: 1,
        raw: '',
        reason: `Missing required column(s): ${missingColumns.join(', ')}. No rows were ingested.`,
      });

      return {
        success: false,
        batchId: `rej_${fileHash.slice(0, 8)}`,
        file: filename,
        fileHash,
        duplicateUpload: false,
        totalRows: rawRows.length,
        acceptedCount: 0,
        rejectedCount: parseRejections.length,
        warningCount: 0,
        accepted: [],
        rejected: parseRejections,
        warnings: [],
        dryRun,
        createdAt: now,
      };
    }

    const { validRows, rejections: valRejections, warnings } = this.validateRows(
      rawRows,
      options.user,
      options.targetCpse
    );

    const allRejections = [...parseRejections, ...valRejections];
    const totalRows = rawRows.length + parseRejections.length;

    const batchId = `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const enriched = await this.enrichBatch(validRows, batchId);

    if (!dryRun && enriched.length > 0) {
      try {
        const legacyData = enriched.map(r => ({
          id: r.id,
          cpseId: r.cpseId,
          code: r.code,
          rawDesc: r.rawDesc,
          normDesc: r.normDesc,
          category: r.category,
          attrs: r.attrs as any,
          unit: r.unit,
          unitFamily: r.unitInfo?.family || null,
          unitFactor: r.unitInfo?.factor || null,
          unitCanon: r.unitInfo?.canon || null,
          source: `Upload: ${filename}`,
          batchId,
          status: r.outcome.status === 'NEEDS_REVIEW' ? 'PENDING_REVIEW' : 'INGESTED',
        }));

        await prisma.legacyRecord.createMany({
          data: legacyData,
          skipDuplicates: true,
        });

        const poData = enriched.flatMap(r =>
          r.history.map(h => ({
            legacyRecordId: r.id,
            poNumber: `PO-${batchId.slice(-4)}-${r.code}`,
            price: h.price,
            qty: h.qty,
            unit: r.unit,
            supplier: h.supplier,
            poDate: new Date(),
          }))
        );

        if (poData.length > 0) {
          await prisma.procurementHistory.createMany({
            data: poData,
          });
        }

        await prisma.auditLog.create({
          data: {
            id: `AUD-${Date.now().toString().slice(-6)}`,
            action: 'DATASET_UPLOADED',
            target: filename,
            actor: options.user?.name || options.user?.id || 'sys-intake',
            role: options.user?.role || 'SYSTEM',
            detail: `${enriched.length} records ingested, ${allRejections.length} rejected, ${warnings.length} warnings.`,
            extra: {
              batchId,
              fileHash,
              totalRows,
              acceptedCount: enriched.length,
              rejectedCount: allRejections.length,
              warningCount: warnings.length,
              geminiEnrichedCount: enriched.filter(e => e.usedGemini).length,
            },
          },
        });

        this.processedFileHashes.add(fileHash);
      } catch (dbErr) {
        this.processedFileHashes.add(fileHash);
        console.warn('⚠️  [IntakeService] Database write deferred or offline:', (dbErr as Error).message);
      }

      this.batchRecordsMap.set(batchId, enriched);
      this.recentBatches.unshift({
        id: `AUD-${Date.now().toString().slice(-6)}`,
        action: 'DATASET_UPLOADED',
        target: filename,
        actor: options.user?.name || options.user?.id || 'sys-intake',
        role: options.user?.role || 'SYSTEM',
        detail: `${enriched.length} records ingested, ${allRejections.length} rejected, ${warnings.length} warnings.`,
        createdAt: now,
        extra: {
          batchId,
          fileHash,
          totalRows,
          acceptedCount: enriched.length,
          rejectedCount: allRejections.length,
          warningCount: warnings.length,
          geminiEnrichedCount: enriched.filter(e => e.usedGemini).length,
        },
      });
    }

    return {
      success: true,
      batchId,
      file: filename,
      fileHash,
      duplicateUpload: false,
      totalRows,
      acceptedCount: enriched.length,
      rejectedCount: allRejections.length,
      warningCount: warnings.length,
      accepted: enriched,
      rejected: allRejections,
      warnings,
      dryRun,
      createdAt: now,
    };
  }

  static clearCache(): void {
    this.processedFileHashes.clear();
    this.recentBatches = [];
    this.batchRecordsMap.clear();
  }
}
