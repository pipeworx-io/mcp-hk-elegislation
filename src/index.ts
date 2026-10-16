interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * hk-elegislation — Hong Kong Ordinances, subsidiary legislation and
 * instruments, bilingually (English and Traditional Chinese, equally
 * authentic), from Hong Kong e-Legislation (Department of Justice), via the
 * bulk archives catalogued on DATA.GOV.HK. Fleet #3130.
 *
 * The source publishes the whole current-version statute book only as bulk
 * XML archives (no per-chapter or per-section live route — verified
 * 2026-10-16), so this pack reads from a D1 copy loaded and refreshed by
 * scripts/hk-elegislation/load-data.mjs, per Bruce's 2026-09-23 local-copy
 * ruling. See src/store.ts for the licence and the full load path.
 *
 * Every response carries `source` and `data_as_of` (when the load last ran).
 * English and Traditional Chinese text are both ORIGINAL — under the
 * Official Languages Ordinance (Cap. 5) s.4B both language texts of an
 * Ordinance are equally authentic — so neither is labelled a translation.
 */
import {
  type D1Like,
  dataAsOf,
  getCap,
  getSection,
  getToc,
  normalizeCapRef,
  requireDb,
  searchCaps,
  shapeCap,
  SOURCE,
} from './store.js';

const tools: McpToolExport['tools'] = [
  {
    name: 'hk_law_search',
    description:
      'Search Hong Kong Ordinances, subsidiary legislation and instruments by TITLE keyword, English or Traditional Chinese — "Personal Data", "個人資料", "Companies Ordinance", "公司條例". This is a title search, not full-text; it will not find a chapter by a phrase appearing only inside a section. Also accepts a bare chapter number ("486") for an exact match. Returns each match\'s Cap. number (for hk_law_info/hk_law_section), English and Traditional Chinese titles, in-force status, and whether it is a principal Ordinance, subsidiary legislation, or an instrument. Source: Hong Kong Department of Justice, e-Legislation.',
    summary: 'Find a Hong Kong law by title (English or Traditional Chinese) or Cap. number.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Title keyword (English or Traditional Chinese) or a bare chapter number, e.g. "Personal Data", "個人資料", or "486".' },
        limit: { type: 'number', description: 'Max chapters to return (1-50, default 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hk_law_info',
    description:
      'Resolve a Hong Kong Ordinance/subsidiary legislation/instrument to its full metadata by Cap. number ("486", "Cap. 486", "486A" for subsidiary legislation) or an exact/partial English or Chinese title — the exact-citation step before reading a section. Returns the English and Traditional Chinese titles (both original-language, equally authentic under Cap. 5 s.4B — neither is a translation), the in-force status, the VERSION DATE of the English text and of the Chinese text as SEPARATE fields (one language can be consolidated ahead of the other), whether it is a principal Ordinance / subsidiary legislation / instrument, and the section count. Source: Hong Kong Department of Justice, e-Legislation.',
    summary: 'One Hong Kong law\'s metadata: titles, in-force status, per-language version dates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cap: { type: 'string', description: 'Chapter number, e.g. "486", "Cap. 486", or "486A" for a subsidiary legislation suffix.' },
        title: { type: 'string', description: 'English or Traditional Chinese title, exact or partial, used when cap is not known.' },
      },
    },
  },
  {
    name: 'hk_law_toc',
    description:
      'Table of contents for one Hong Kong law: every section number and heading, in order, paged. Use to browse a law\'s structure before reading a specific section with hk_law_section, or to enumerate every section number a long Ordinance has. Returns has_more and next_offset when the law has more sections than the page size.',
    summary: 'A Hong Kong law\'s section numbers and headings, paged.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cap: { type: 'string', description: 'Chapter number (from hk_law_search or hk_law_info), e.g. "486" or "486A".' },
        title: { type: 'string', description: 'English or Traditional Chinese title, used when cap is not known.' },
        offset: { type: 'number', description: 'Pagination offset (default 0).' },
        limit: { type: 'number', description: 'Max entries to return (1-500, default 200).' },
      },
    },
  },
  {
    name: 'hk_law_section',
    description:
      'Full text of ONE section of a Hong Kong law, by Cap. number or title plus section number in any common spelling — "2", "s2", "section 2", "14A". Returns the English text AND the Traditional Chinese text of that SAME section side by side — both original-language and equally authentic (Official Languages Ordinance, Cap. 5 s.4B), never one a "translation" of the other — plus the section\'s in-force status and version-valid-from date. A long law is never returned whole; use hk_law_toc to find section numbers, and call this once per section.',
    summary: 'One section of a Hong Kong law, English and Traditional Chinese side by side.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cap: { type: 'string', description: 'Chapter number (from hk_law_search or hk_law_info), e.g. "486" or "486A".' },
        title: { type: 'string', description: 'English or Traditional Chinese title, used when cap is not known.' },
        section: { type: 'string', description: 'Section number, any common spelling: "2", "s2", "section 2", "14A".' },
      },
      required: ['section'],
    },
  },
];

function clamp(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : d;
}

async function resolveCap(db: D1Like, args: Record<string, unknown>): Promise<{ cap: string; capSuffix: string | null }> {
  const cap = args.cap != null ? String(args.cap).trim() : '';
  const title = args.title != null ? String(args.title).trim() : '';
  if (!cap && !title) throw new Error('Provide either "cap" (from hk_law_search) or "title" (an English or Traditional Chinese law title).');
  const law = await getCap(db, { cap: cap || undefined, title: title || undefined });
  if (!law) throw new Error(`No Hong Kong law found for ${cap ? `cap "${cap}"` : `title "${title}"`}. Try hk_law_search first.`);
  return { cap: law.cap, capSuffix: law.cap_suffix };
}

async function searchTool(db: D1Like, args: Record<string, unknown>) {
  const query = String(args.query ?? '').trim();
  if (!query) throw new Error('Required argument "query" is missing (an English or Traditional Chinese title keyword, or a chapter number).');
  const limit = clamp(args.limit, 1, 50, 10);
  const rows = await searchCaps(db, { query, limit });
  return {
    query,
    returned: rows.length,
    laws: rows.map((r) => ({ ...shapeCap(r), matched_on: r.matched_on })),
    note: rows.length === 0 ? 'No title or chapter number matched. This is a title search — try hk_law_search with a different keyword, not a section phrase.' : undefined,
    source: SOURCE,
    data_as_of: await dataAsOf(db),
  };
}

async function infoTool(db: D1Like, args: Record<string, unknown>) {
  const cap = args.cap != null ? String(args.cap).trim() : '';
  const title = args.title != null ? String(args.title).trim() : '';
  if (!cap && !title) throw new Error('Provide either "cap" (from hk_law_search) or "title" (an English or Traditional Chinese law title).');
  const law = await getCap(db, { cap: cap || undefined, title: title || undefined });
  if (!law) throw new Error(`No Hong Kong law found for ${cap ? `cap "${cap}"` : `title "${title}"`}. Try hk_law_search first.`);
  return { ...shapeCap(law), data_as_of: await dataAsOf(db) };
}

async function tocTool(db: D1Like, args: Record<string, unknown>) {
  const { cap, capSuffix } = await resolveCap(db, args);
  const offset = clamp(args.offset, 0, 1_000_000, 0);
  const limit = clamp(args.limit, 1, 500, 200);
  const { rows, total } = await getToc(db, { cap, capSuffix, offset, limit });
  return {
    cap,
    cap_suffix: capSuffix,
    total_sections: total,
    returned: rows.length,
    offset,
    sections: rows.map((r) => ({
      section_no: r.section_no,
      heading_en: r.heading_en,
      heading_zh_hant: r.heading_zh_hant,
      status: r.status,
    })),
    has_more: offset + rows.length < total,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    source: SOURCE,
    data_as_of: await dataAsOf(db),
  };
}

async function sectionTool(db: D1Like, args: Record<string, unknown>) {
  const sectionArg = args.section != null ? String(args.section).trim() : '';
  if (!sectionArg) throw new Error('Required argument "section" is missing, e.g. "2" or "section 2".');
  const { cap, capSuffix } = await resolveCap(db, args);
  const row = await getSection(db, { cap, capSuffix, sectionNo: sectionArg });
  if (!row) {
    throw new Error(
      `No section "${sectionArg}" found for this law. Use hk_law_toc to list its real section numbers — some Ordinances skip numbers or use "A"/"B" sub-sections.`,
    );
  }
  const law = await getCap(db, { cap: capSuffix ? `${cap}${capSuffix}` : cap });
  return {
    cap,
    cap_suffix: capSuffix,
    citation: capSuffix ? `Cap. ${cap}${capSuffix}` : `Cap. ${cap}`,
    title_en: law?.title_en ?? null,
    title_zh_hant: law?.title_zh_hant ?? null,
    section_no: row.section_no,
    heading_en: row.heading_en,
    heading_zh_hant: row.heading_zh_hant,
    content_en: row.content_en,
    content_zh_hant: row.content_zh_hant,
    language_note: 'English and Traditional Chinese text are both original and equally authentic (Official Languages Ordinance, Cap. 5 s.4B) — neither is a translation of the other.',
    status: row.status,
    version_date: row.version_date,
    source: SOURCE,
    data_as_of: await dataAsOf(db),
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = requireDb(args._d1);
  switch (name) {
    case 'hk_law_search':
      return searchTool(db, args);
    case 'hk_law_info':
      return infoTool(db, args);
    case 'hk_law_toc':
      return tocTool(db, args);
    case 'hk_law_section':
      return sectionTool(db, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export { normalizeCapRef };
export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
