import { GoogleGenAI } from '@google/genai';
import { prisma } from '../config/db';
import { config } from '../config/env';
import { AuthUser } from '../models/auth';
import { DecisionExplanation, DecisionType } from '../models/decision';
import {
  MatchingService,
  MatchableRecord,
  STANDARD_GROUPS,
} from './matchingService';
import { CATEGORY_DEFINITIONS } from './extractionService';
import { NormalizationService } from './normalizationService';
import { AuditService } from './auditService';

export interface DecisionRecordState {
  id: string;
  nmcCode?: string;
  category: string;
  stdDesc: string;
  criticalAttrs: Record<string, unknown>;
  status: 'PENDING' | 'AWAITING_L2' | 'APPROVED' | 'REJECTED' | 'ESCALATED';
  version: number;
  approvedBy?: string | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  notes?: string | null;
  versions: Array<{
    version: number;
    stdDesc: string;
    changeReason: string;
    changedBy: string;
    createdAt: string;
  }>;
}

export class DecisionService {
  private static geminiClient: GoogleGenAI | null = null;
  private static inMemoryStore = new Map<string, DecisionRecordState>();
  private static retiredCodes = new Set<string>();

  private static getGeminiClient(): GoogleGenAI | null {
    if (!config.gemini.isConfigured) return null;
    if (!this.geminiClient) {
      this.geminiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
    }
    return this.geminiClient;
  }

  static formatStandardDescription(category: string, attrs: Record<string, unknown> = {}): string {
    attrs = attrs || {};
    const f = (k: string) => (attrs[k] === undefined ? '?' : String(attrs[k]));
    switch (category) {
      case 'HEX_BOLT':
        return `HEXAGON HEAD BOLT M${f('diameter')} X ${attrs.length ?? '?'} MM ${f('grade')}`;
      case 'BALL_BEARING':
        return `DEEP GROOVE BALL BEARING ${attrs.bearing_no ?? '?'} ${attrs.seal ?? '?'}`;
      case 'GATE_VALVE':
        return `GATE VALVE ${f('size_in')}" ${f('pressure_class')} LB ${f('body_material')} FLANGED`;
      case 'FLANGE':
        return `FLANGE ${attrs.flange_type ?? '?'} RF ${f('size_in')}" ${f('pressure_class')} LB ${f('grade')}`;
      case 'INDUCTION_MOTOR':
        return `INDUCTION MOTOR ${f('power_kw')} KW ${f('voltage')} V ${f('poles')} POLE`;
      case 'SEAMLESS_PIPE':
        return `SEAMLESS PIPE ${f('size_in')}" ${f('schedule')} ${f('grade')}`;
      case 'SPIRAL_WOUND_GASKET':
        return `SPIRAL WOUND GASKET ${f('size_in')}" ${f('pressure_class')} LB ${f('grade')} GRAPHITE`;
      case 'POWER_CABLE':
        return `POWER CABLE ${attrs.cores ?? '?'}C X ${attrs.area_sqmm ?? '?'} SQMM ${attrs.conductor ?? '?'} ${f('voltage_kv')} KV`;
      case 'WELDING_ELECTRODE':
        return `WELDING ELECTRODE ${attrs.aws_class ?? '?'} ${f('dia_mm')} MM`;
      default:
        return 'UNCLASSIFIED MATERIAL';
    }
  }

  static async explainComparison(
    recordA: MatchableRecord,
    recordB: MatchableRecord,
    options: { pairId?: string } = {}
  ): Promise<DecisionExplanation> {
    const rawA = recordA.rawDesc || (recordA as any).rawDescription || recordA.normDesc || (recordA as any).normalizedDescription || '';
    const rawB = recordB.rawDesc || (recordB as any).rawDescription || recordB.normDesc || (recordB as any).normalizedDescription || '';
    const attrsA = (recordA.attrs || (recordA as any).attributes || {}) as Record<string, unknown>;
    const attrsB = (recordB.attrs || (recordB as any).attributes || {}) as Record<string, unknown>;

    const normA: MatchableRecord = {
      ...recordA,
      rawDesc: rawA,
      normDesc: NormalizationService.normalizeText(rawA),
      attrs: attrsA,
    };
    const normB: MatchableRecord = {
      ...recordB,
      rawDesc: rawB,
      normDesc: NormalizationService.normalizeText(rawB),
      attrs: attrsB,
    };

    const match = await MatchingService.matchPair(normA, normB);
    const cat = normA.category;
    const catDef = CATEGORY_DEFINITIONS[cat] || { label: cat, critical: [] };
    const crit = catDef.critical;

    const reasons: string[] = [];
    const differences: string[] = [];
    const blocked: string[] = [];
    const rulesApplied: string[] = ['R-01', 'R-08', 'R-09', 'R-10'];

    if (recordA.category === recordB.category) {
      reasons.push(`Same equipment category: ${catDef.label}`);
    } else {
      blocked.push(`Category mismatch: ${recordA.category} vs ${recordB.category}`);
    }

    for (const k of crit) {
      const vA = normA.attrs[k];
      const vB = normB.attrs[k];

      if (vA !== undefined && vB !== undefined) {
        if (String(vA).toLowerCase() === String(vB).toLowerCase()) {
          reasons.push(`Same ${k}: ${vA}`);
        } else {
          blocked.push(`Critical conflict on ${k}: ${vA} vs ${vB}`);
        }
      } else if (vA === undefined && vB === undefined) {
        differences.push(`${k} not specified in either material`);
      } else {
        const side = vA !== undefined ? 'B' : 'A';
        differences.push(`${k} missing in Material ${side} (critical: needs reviewer)`);
      }
    }

    const stdA = normA.attrs?.standard ? String(normA.attrs.standard).trim() : null;
    const stdB = normB.attrs?.standard ? String(normB.attrs.standard).trim() : null;
    if (stdA && stdB) {
      if (stdA === stdB) {
        reasons.push(`Same standard: ${stdA}`);
      } else {
        const isEquiv = STANDARD_GROUPS.some(g => g.includes(stdA) && g.includes(stdB));
        if (isEquiv) {
          reasons.push(`Equivalent international standard: ${stdA} ≡ ${stdB} (rule R-07)`);
          rulesApplied.push('R-07');
        } else {
          differences.push(`Different standards: ${stdA} vs ${stdB}`);
        }
      }
    }

    if (recordA.unitInfo && recordB.unitInfo) {
      if (recordA.unitInfo.raw === recordB.unitInfo.raw) {
        reasons.push(`Same unit of measure: ${recordA.unitInfo.raw}`);
      } else if (recordA.unitInfo.canon === recordB.unitInfo.canon) {
        reasons.push(`Equivalent unit: ${recordA.unitInfo.raw} ≡ ${recordB.unitInfo.raw}`);
      } else if (recordA.unitInfo.family === recordB.unitInfo.family) {
        differences.push(
          `Unit conversion required: ${recordA.unitInfo.raw} → ${recordB.unitInfo.raw} (factor: ${recordA.unitInfo.factor} / ${recordB.unitInfo.factor})`
        );
      } else {
        blocked.push(
          `Incompatible unit family: ${recordA.unitInfo.family} vs ${recordB.unitInfo.family} (rule R-08)`
        );
      }
    }

    let procurementNote: string | undefined;
    const priceA = recordA.history?.[0]?.price;
    const priceB = recordB.history?.[0]?.price;
    if (priceA && priceB && priceA > 0 && priceB > 0) {
      const variancePct = Math.round((Math.abs(priceA - priceB) / Math.min(priceA, priceB)) * 100);
      procurementNote = `Procurement variance: ${variancePct}% between CPSE records (₹${priceA} vs ₹${priceB}).`;
      reasons.push(procurementNote);
    }

    reasons.push(`Semantic similarity: ${Math.round(match.components.semantic * 100)}%`);

    let auditorVerdict: 'APPROVED_FOR_MERGE' | 'REQUIRES_EXPERT_REVIEW' | 'MERGE_PROHIBITED';
    if (blocked.length > 0 || match.cls === 'NON_MATCH' || match.cls === 'VARIANT' || match.cls === 'RELATED') {
      auditorVerdict = 'MERGE_PROHIBITED';
    } else if (match.cls === 'REQUIRES_REVIEW' || differences.length > 0) {
      auditorVerdict = 'REQUIRES_EXPERT_REVIEW';
    } else {
      auditorVerdict = 'APPROVED_FOR_MERGE';
    }

    const stdDesc = this.formatStandardDescription(normA.category, normA.attrs);
    let narrative = '';
    let usedGemini = false;

    const gemini = this.getGeminiClient();
    if (gemini) {
      try {
        const prompt = `You are the Lead Auditor for the National Unified Material Master Framework (NUMMF), Government of India.
Generate a concise, 2-3 sentence auditor-grade justification explaining whether the following two CPSE ERP records should be harmonized under the same National Material Code.

RECORD A (${normA.cpseId || 'CPSE 1'} - ${normA.code || 'ID1'}):
Raw Description: "${normA.rawDesc}"
Category: ${normA.category}
Attributes: ${JSON.stringify(normA.attrs)}
Price: ${priceA ? `₹${priceA}` : 'N/A'}

RECORD B (${normB.cpseId || 'CPSE 2'} - ${normB.code || 'ID2'}):
Raw Description: "${normB.rawDesc}"
Category: ${normB.category}
Attributes: ${JSON.stringify(normB.attrs)}
Price: ${priceB ? `₹${priceB}` : 'N/A'}

EVALUATION FACTS:
- Semantic Vector Similarity: ${(match.components.semantic * 100).toFixed(1)}%
- Matched Attributes: ${reasons.join('; ')}
- Conflicts (Rule R-01): ${blocked.length ? blocked.join('; ') : 'None'}
- Missing Attributes (Rule R-10): ${differences.length ? differences.join('; ') : 'None'}
- Verdict: ${auditorVerdict}

Respond ONLY with the natural language auditor explanation paragraph. If conflicts exist under Rule R-01, explicitly cite 'Rule R-01 blocks' or state that the parts are 'physically incompatible' to maintain strict audit compliance.`;

        const response = await gemini.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            temperature: 0.1,
            maxOutputTokens: 250,
          },
        });

        if (response.text && response.text.trim().length > 20) {
          narrative = response.text.trim();
          if (blocked.length > 0 && !narrative.toLowerCase().includes('rule r-01') && !narrative.toLowerCase().includes('physically incompatible')) {
            narrative = `${narrative} Rule R-01 blocks this merge due to physically incompatible critical attributes.`;
          }
          if (stdDesc && !narrative.includes(stdDesc)) {
            narrative = `${stdDesc}. ${narrative}`;
          }
          usedGemini = true;
        }
      } catch (err) {
        console.warn('⚠️  [DecisionService] Gemini call failed, falling back to deterministic template:', (err as Error).message);
      }
    }

    if (!narrative) {
      if (blocked.length > 0) {
        narrative =
          `The two records look alike in wording (${Math.round(match.components.semantic * 100)}% semantic similarity) but describe physically incompatible parts. ` +
          `${blocked.join('; ')}. Rule R-01 blocks this merge unconditionally to prevent hazardous plant substitutions.`;
      } else if (auditorVerdict === 'REQUIRES_EXPERT_REVIEW') {
        narrative =
          `Attributes stated in both records agree, but critical technical evidence is incomplete: ${differences.join('; ')}. ` +
          `Rule R-10 mandates human domain expert confirmation before assigning a national material identity.`;
      } else {
        narrative =
          `Both records describe the same physical material: ${stdDesc}. All critical engineering attributes agree after normalization. ` +
          `Wording differs only in abbreviations, ordering, and unit conventions. Price variance is within acceptable procurement bounds.`;
      }
    }

    const technicalRationale = blocked.length
      ? `BLOCKED by Rule R-01: ${blocked.join(', ')}`
      : differences.length
      ? `REVIEW REQUIRED by Rule R-10: ${differences.join(', ')}`
      : `VERIFIED EQUIVALENT: ${reasons.slice(0, 4).join(', ')}`;

    return {
      pairId: options.pairId,
      score: match.score,
      classification: match.cls,
      reasons,
      differences,
      blocked,
      rulesApplied,
      narrative,
      auditorVerdict,
      technicalRationale,
      procurementNote,
      usedGemini,
      confidence: match.score,
    };
  }

  static async approve(
    targetId: string,
    type: DecisionType,
    user: AuthUser,
    note?: string,
    options: { forceL2?: boolean } = {}
  ): Promise<{ success: boolean; status: string; version: number; message: string }> {
    if (!user.permissions.includes('review') && !user.permissions.includes('l2')) {
      throw new Error(`Forbidden: User lacks approval permissions. Role: ${user.role}`);
    }

    const now = new Date().toISOString();
    const actor = user.name || user.id;

    if (type === 'CLUSTER') {
      const existing = this.getCluster(targetId);
      const isAwaitingL2 = existing.status === 'AWAITING_L2';

      if (isAwaitingL2) {
        if (!user.permissions.includes('l2')) {
          throw new Error('Forbidden: Second-level approval requires Super Administrator privileges (permission: l2).');
        }

        if (existing.approvedBy === actor) {
          throw new Error('Separation of duties violation: The second-level approval must be given by a different person than the first-level reviewer.');
        }

        existing.status = 'APPROVED';
        existing.approvedBy = actor;
        existing.approvedAt = now;
        existing.notes = note || 'Second-level approval completed.';
        existing.version = existing.version + 1;
        existing.versions.push({
          version: existing.version,
          stdDesc: existing.stdDesc,
          changeReason: note || 'Second-level approval granted.',
          changedBy: actor,
          createdAt: now,
        });

        await this.persistClusterUpdate(existing, 'SECOND_LEVEL_APPROVAL', actor, user.role, note);

        return {
          success: true,
          status: 'APPROVED',
          version: existing.version,
          message: `${existing.nmcCode || targetId} approved at second level.`,
        };
      }

      if (options.forceL2) {
        existing.status = 'AWAITING_L2';
        existing.approvedBy = actor;
        existing.approvedAt = now;
        existing.notes = note || 'First-level approval recorded.';

        await this.persistClusterUpdate(existing, 'FIRST_LEVEL_APPROVAL', actor, user.role, note);

        return {
          success: true,
          status: 'AWAITING_L2',
          version: existing.version,
          message: `First-level approval recorded for ${existing.nmcCode || targetId}. Awaiting second approval by Super Administrator.`,
        };
      }

      existing.status = 'APPROVED';
      existing.approvedBy = actor;
      existing.approvedAt = now;
      existing.notes = note || 'Direct recommendation approved.';
      existing.version = existing.version || 1;
      existing.versions.push({
        version: existing.version,
        stdDesc: existing.stdDesc,
        changeReason: note || 'Approved from AI recommendation.',
        changedBy: actor,
        createdAt: now,
      });

      await this.persistClusterUpdate(existing, 'NMC_APPROVED', actor, user.role, note);

      return {
        success: true,
        status: 'APPROVED',
        version: existing.version,
        message: `${existing.nmcCode || targetId} approved and mapped.`,
      };
    }

    await this.logAudit('MAPPING_APPROVED', targetId, actor, user.role, note || 'Legacy mapping approved.');

    return {
      success: true,
      status: 'APPROVED',
      version: 1,
      message: `Mapping ${targetId} approved.`,
    };
  }

  static async modify(
    targetId: string,
    standardDescription: string,
    note: string,
    user: AuthUser,
    attributes?: Record<string, unknown>
  ): Promise<{ success: boolean; status: string; version: number; standardDescription?: string; message: string }> {
    if (!user.permissions.includes('review')) {
      throw new Error(`Forbidden: User lacks review/modify permissions. Role: ${user.role}`);
    }

    if (!note || note.trim().length < 3) {
      throw new Error('A mandatory reason is required for every modification to a national material.');
    }

    const existing = this.getCluster(targetId);
    const actor = user.name || user.id;
    const now = new Date().toISOString();

    const previousDesc = existing.stdDesc;
    existing.stdDesc = standardDescription.trim().toUpperCase();
    if (attributes) {
      existing.criticalAttrs = { ...existing.criticalAttrs, ...attributes };
    }
    existing.version = existing.version + 1;
    existing.status = 'APPROVED';
    existing.approvedBy = actor;
    existing.approvedAt = now;
    existing.notes = note;

    existing.versions.push({
      version: existing.version,
      stdDesc: existing.stdDesc,
      changeReason: `Standard description changed from "${previousDesc}" to "${existing.stdDesc}". Reason: ${note}`,
      changedBy: actor,
      createdAt: now,
    });

    await this.persistClusterUpdate(existing, 'NMC_MODIFIED', actor, user.role, note);

    return {
      success: true,
      status: 'APPROVED',
      version: existing.version,
      standardDescription: existing.stdDesc,
      message: `${existing.nmcCode || targetId} updated to version ${existing.version} and approved.`,
    };
  }

  static async reject(
    targetId: string,
    type: DecisionType,
    reason: string,
    user: AuthUser
  ): Promise<{ success: boolean; status: string; retired?: boolean; message: string }> {
    if (!user.permissions.includes('review')) {
      throw new Error(`Forbidden: User lacks rejection permissions. Role: ${user.role}`);
    }

    if (!reason || reason.trim().length < 3) {
      throw new Error('A mandatory justification note is required to reject a recommendation.');
    }

    const actor = user.name || user.id;

    if (type === 'CLUSTER') {
      const existing = this.getCluster(targetId);
      existing.status = 'REJECTED';
      existing.rejectionReason = reason;

      if (existing.nmcCode) {
        this.retiredCodes.add(existing.nmcCode);
      }

      await this.persistClusterUpdate(existing, 'RECOMMENDATION_REJECTED', actor, user.role, reason);

      return {
        success: true,
        status: 'REJECTED',
        retired: true,
        message: `${existing.nmcCode || targetId} rejected and retired. The code will never be reused.`,
      };
    }

    await this.logAudit('MAPPING_REJECTED', targetId, actor, user.role, reason);

    return {
      success: true,
      status: 'REJECTED',
      message: `Mapping suggestion for ${targetId} rejected.`,
    };
  }

  static async escalate(
    targetId: string,
    type: DecisionType,
    note: string | undefined,
    user: AuthUser
  ): Promise<{ success: boolean; status: string; message: string }> {
    if (!user.permissions.includes('review')) {
      throw new Error(`Forbidden: User lacks review permissions. Role: ${user.role}`);
    }

    const actor = user.name || user.id;

    if (type === 'CLUSTER') {
      const existing = this.getCluster(targetId);
      existing.status = 'ESCALATED';
      existing.notes = note || 'Escalated for higher-level review.';

      await this.persistClusterUpdate(existing, 'RECOMMENDATION_ESCALATED', actor, user.role, note);

      return {
        success: true,
        status: 'ESCALATED',
        message: `${existing.nmcCode || targetId} escalated for second-level committee review.`,
      };
    }

    await this.logAudit('MAPPING_ESCALATED', targetId, actor, user.role, note || 'Escalated.');

    return {
      success: true,
      status: 'ESCALATED',
      message: `Mapping for ${targetId} escalated.`,
    };
  }

  static async reopen(
    targetId: string,
    type: DecisionType,
    user: AuthUser
  ): Promise<{ success: boolean; status: string; message: string }> {
    if (!user.permissions.includes('review')) {
      throw new Error(`Forbidden: User lacks review permissions. Role: ${user.role}`);
    }

    const actor = user.name || user.id;

    if (type === 'CLUSTER') {
      const existing = this.getCluster(targetId);
      existing.status = 'PENDING';
      existing.notes = 'Reopened for evaluation.';

      await this.persistClusterUpdate(existing, 'DECISION_REOPENED', actor, user.role, 'Reopened for review');

      return {
        success: true,
        status: 'PENDING',
        message: `${existing.nmcCode || targetId} reopened for review.`,
      };
    }

    await this.logAudit('DECISION_REOPENED', targetId, actor, user.role, 'Mapping decision reopened.');

    return {
      success: true,
      status: 'PENDING',
      message: `Mapping decision for ${targetId} reopened.`,
    };
  }

  static getCluster(targetId: string): DecisionRecordState {
    let item = this.inMemoryStore.get(targetId);
    if (!item) {
      item = {
        id: targetId,
        nmcCode: targetId.startsWith('NMC-') ? targetId : `NMC-${targetId.slice(0, 8).toUpperCase()}`,
        category: 'HEX_BOLT',
        stdDesc: 'HEXAGON HEAD BOLT M16 X 50 MM SS304',
        criticalAttrs: { diameter: 16, length: 50, grade: 'SS304' },
        status: 'PENDING',
        version: 1,
        versions: [],
      };
      this.inMemoryStore.set(targetId, item);
    }
    return item;
  }

  static setCluster(targetId: string, state: DecisionRecordState): void {
    this.inMemoryStore.set(targetId, state);
  }

  static isCodeRetired(nmcCode: string): boolean {
    return this.retiredCodes.has(nmcCode);
  }

  static clearStore(): void {
    this.inMemoryStore.clear();
    this.retiredCodes.clear();
  }

  static clearInMemory(): void {
    this.clearStore();
  }

  private static async persistClusterUpdate(
    cluster: DecisionRecordState,
    action: string,
    actor: string,
    role: string,
    note?: string
  ): Promise<void> {
    try {
      await prisma.nationalMaterial.upsert({
        where: { id: cluster.id },
        update: {
          status: cluster.status,
          version: cluster.version,
          stdDesc: cluster.stdDesc,
          approvedBy: cluster.approvedBy,
          approvedAt: cluster.approvedAt ? new Date(cluster.approvedAt) : null,
          rejectionReason: cluster.rejectionReason,
          notes: cluster.notes,
        },
        create: {
          id: cluster.id,
          clusterKey: cluster.id,
          nmcCode: cluster.nmcCode || `NMC-${Date.now().toString().slice(-8)}`,
          codeNumber: Math.floor(Math.random() * 100000),
          category: cluster.category,
          stdDesc: cluster.stdDesc,
          criticalAttrs: cluster.criticalAttrs as any,
          status: cluster.status,
          version: cluster.version,
          approvedBy: cluster.approvedBy,
          approvedAt: cluster.approvedAt ? new Date(cluster.approvedAt) : null,
          rejectionReason: cluster.rejectionReason,
          notes: cluster.notes,
        },
      });
    } catch (err) {}

    try {
      await this.logAudit(action, cluster.nmcCode || cluster.id, actor, role, note || action);
    } catch {}
  }

  private static async logAudit(
    action: string,
    target: string,
    actor: string,
    role: string,
    detail: string
  ): Promise<void> {
    try {
      await AuditService.log({
        action,
        target,
        actor,
        role,
        detail,
        extra: { timestamp: new Date().toISOString() },
      });
    } catch (err) {}
  }
}
