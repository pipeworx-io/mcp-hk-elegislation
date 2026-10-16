/**
 * Reads for hk-elegislation (fleet #3130).
 *
 * Hong Kong e-Legislation (維護 by the Department of Justice, DOJ) publishes
 * the full current-version statute book as bulk XML archives catalogued on
 * DATA.GOV.HK (organisation "hk-doj") — there is no per-chapter or
 * per-section live route: the interactive elegislation.gov.hk site gates
 * every page behind a JavaScript client-capability check
 * (checkconfig/checkClientConfig.jsp) that a plain HTTP client cannot pass,
 * confirmed from both a laptop and Cloudflare egress on 2026-10-16, and the
 * DATA.GOV.HK catalog (hk-doj-hkel-legislation-current /
 * hk-doj-hkel-legislation-past) offers only whole-range ZIP downloads
 * (Caps. 1-300 / 301-600 / 601+ / Instruments, times English, Traditional
 * Chinese and Simplified Chinese). Per Bruce's 2026-09-23 local-copy ruling
 * (build a copy when the data's not available live or is overly rate
 * limited), scripts/hk-elegislation/load-data.mjs
 * downloads the archives and writes the result into a D1 database the
 * gateway hands this pack as `_d1` (pack-manifest "d1Binding": "HK_ELEG_DB").
 * Table/column names here must match that script's buildSchemaSql().
 *
 * Hong Kong Ordinances are enacted BILINGUALLY: under the Official Languages
 * Ordinance (Cap. 5) s.4B, the English and Chinese texts of an Ordinance are
 * EQUALLY AUTHENTIC — neither is a translation of the other, so this pack
 * never labels one "official" and the other not; both are original-language
 * text, stored side by side. Traditional Chinese (zh-Hant) is loaded; the
 * also-published Simplified Chinese (zh-Hans) export is a known future
 * addition, not loaded in the first pass (see load-data.mjs header).
 *
 * Licence: DATA.GOV.HK's own Terms of Use (data.gov.hk/en/terms-and-conditions,
 * captured 2026-10-16 — the live page itself sits behind the same JS gate as
 * elegislation.gov.hk, confirmed via a Wayback Machine capture of the
 * rendered text) grant free browsing, downloading, DISTRIBUTION and
 * REPRODUCTION of the Data "for both commercial and non-commercial purposes
 * on a free-of-charge basis", conditioned only on identifying the source and
 * acknowledging the Government's ownership of the underlying IP — an
 * explicit reuse grant, not merely a live-proxy allowance, so a local mirror
 * is within bounds (CLAUDE.md "mirror-needs-grant-proxy-does-not"). The
 * elegislation.gov.hk site's own Terms of Use additionally note that only a
 * PDF marked "Verified Copy" is presumed accurate as at its stated date
 * (Legislation Publication Ordinance, Cap. 614 s.5); the bulk XML, like the
 * HTML/XML views on the live site itself, is provided for information and is
 * what this pack serves, each row carrying the publisher, dataset and
 * version date so a caller can tell what they are looking at.
 */

/** The slice of Cloudflare's D1Database this pack uses, declared here so the
 *  pack needs no workers-types and a test can pass a node:sqlite stub. */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

// Provenance is publisher + dataset + data_as_of (CLAUDE.md step 9b) — never
// the download route.
export const SOURCE = 'Hong Kong Department of Justice, e-Legislation (via DATA.GOV.HK)';
export const LICENSE =
  'DATA.GOV.HK Terms of Use — free browsing, download, distribution and reproduction, commercial or ' +
  'non-commercial, conditioned on identifying the source and acknowledging the HKSAR Government\'s IP ownership. ' +
  'Only a "Verified Copy" PDF from elegislation.gov.hk itself is presumed legally accurate as at its stated date ' +
  '(Legislation Publication Ordinance, Cap. 614 s.5); this pack, like the live site\'s own non-PDF views, is for ' +
  'information.';

export class StoreUnavailableError extends Error {
  constructor() {
    super(
      'hk-elegislation: the legislation store is not bound in this runtime (no _d1). These tools only answer through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'StoreUnavailableError';
  }
}
export function requireDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new StoreUnavailableError();
  return d1 as D1Like;
}

export interface CapRow {
  cap: string;
  cap_suffix: string | null;
  doc_type: string;
  title_en: string | null;
  title_zh_hant: string | null;
  long_title_en: string | null;
  status: string;
  version_date_en: string | null;
  version_date_zh_hant: string | null;
  section_count: number;
}
const CAP_COLS =
  'cap, cap_suffix, doc_type, title_en, title_zh_hant, long_title_en, status, version_date_en, version_date_zh_hant, section_count';

export function shapeCap(r: CapRow) {
  const citation = r.cap_suffix ? `Cap. ${r.cap}${r.cap_suffix}` : `Cap. ${r.cap}`;
  return {
    cap: r.cap,
    cap_suffix: r.cap_suffix,
    citation,
    doc_type: r.doc_type === 'cap' ? (r.cap_suffix ? 'subsidiary_legislation' : 'ordinance') : 'instrument',
    title_en: r.title_en,
    title_zh_hant: r.title_zh_hant,
    long_title_en: r.long_title_en,
    // Separate fields per the legal-pack contract: in-force status vs. the
    // two version dates (English and Chinese texts can be consolidated on
    // different dates when only one language's amendment has been
    // incorporated yet).
    status: r.status,
    version_date_en: r.version_date_en,
    version_date_zh_hant: r.version_date_zh_hant,
    section_count: r.section_count,
    source: SOURCE,
  };
}

export async function dataAsOf(db: D1Like): Promise<string | null> {
  const r = await db.prepare(`SELECT value FROM hk_leg_meta WHERE key = 'loaded_at'`).first<{ value: string }>();
  return r?.value ?? null;
}

/** ~700 current Ordinances plus subsidiary legislation and instruments — a
 *  LIKE scan over that is trivial, so title search skips FTS5 entirely (and
 *  the chunked-import trap that comes with it; see
 *  reference_d1_fts5_import_trap) in favor of a plain substring match on
 *  both the English and Traditional Chinese titles. */
export async function searchCaps(
  db: D1Like,
  opts: { query: string; limit: number },
): Promise<Array<CapRow & { matched_on: 'title_en' | 'title_zh_hant' }>> {
  const q = opts.query.trim();
  if (!q) return [];
  const cols = CAP_COLS.split(',').map((c) => `l.${c.trim()}`).join(', ');
  const r = await db
    .prepare(
      `SELECT ${cols},
         CASE WHEN l.title_en LIKE ? THEN 'title_en' ELSE 'title_zh_hant' END AS matched_on
       FROM hk_legislation l WHERE l.title_en LIKE ? OR l.title_zh_hant LIKE ? OR l.cap = ?
       ORDER BY (l.cap_suffix IS NOT NULL), length(coalesce(l.title_en, l.title_zh_hant, '')) LIMIT ?`,
    )
    .bind(`%${q}%`, `%${q}%`, `%${q}%`, q, opts.limit)
    .all<CapRow & { matched_on: 'title_en' | 'title_zh_hant' }>();
  return r.results;
}

/** Exact citation resolution: by chapter number (and optional subsidiary
 *  suffix) or by an exact/partial title match. "486" / "Cap 486" / "Cap. 486"
 *  all resolve to the same principal Ordinance. */
export function normalizeCapRef(v: string): { cap: string; suffix: string | null } {
  const m = /^\s*(?:cap\.?\s*)?(\d+)\s*([A-Za-z]{0,2})\s*$/i.exec(String(v));
  if (!m) return { cap: String(v).trim(), suffix: null };
  return { cap: m[1], suffix: m[2] ? m[2].toUpperCase() : null };
}

export async function getCap(db: D1Like, opts: { cap?: string; title?: string }): Promise<CapRow | null> {
  if (opts.cap) {
    const { cap, suffix } = normalizeCapRef(opts.cap);
    if (suffix) {
      return db
        .prepare(`SELECT ${CAP_COLS} FROM hk_legislation WHERE cap = ? AND cap_suffix = ?`)
        .bind(cap, suffix)
        .first<CapRow>();
    }
    return db
      .prepare(`SELECT ${CAP_COLS} FROM hk_legislation WHERE cap = ? AND cap_suffix IS NULL`)
      .bind(cap)
      .first<CapRow>();
  }
  if (opts.title) {
    const exact = await db
      .prepare(`SELECT ${CAP_COLS} FROM hk_legislation WHERE title_en = ? OR title_zh_hant = ?`)
      .bind(opts.title, opts.title)
      .first<CapRow>();
    if (exact) return exact;
    return db
      .prepare(
        `SELECT ${CAP_COLS} FROM hk_legislation WHERE title_en LIKE ? OR title_zh_hant LIKE ?
         ORDER BY (cap_suffix IS NOT NULL), length(coalesce(title_en, title_zh_hant, '')) LIMIT 1`,
      )
      .bind(`%${opts.title}%`, `%${opts.title}%`)
      .first<CapRow>();
  }
  return null;
}

export interface SectionRow {
  seq: number;
  section_no: string | null;
  section_no_norm: string | null;
  heading_en: string | null;
  heading_zh_hant: string | null;
  content_en: string | null;
  content_zh_hant: string | null;
  status: string | null;
  version_date: string | null;
}
const SECTION_COLS =
  'seq, section_no, section_no_norm, heading_en, heading_zh_hant, content_en, content_zh_hant, status, version_date';

export async function getToc(
  db: D1Like,
  opts: { cap: string; capSuffix: string | null; offset: number; limit: number },
): Promise<{ rows: SectionRow[]; total: number }> {
  const where = opts.capSuffix ? `cap = ? AND cap_suffix = ?` : `cap = ? AND cap_suffix IS NULL`;
  const bindArgs = opts.capSuffix ? [opts.cap, opts.capSuffix] : [opts.cap];
  const total = await db
    .prepare(`SELECT count(*) AS n FROM hk_sections WHERE ${where}`)
    .bind(...bindArgs)
    .first<{ n: number }>();
  const r = await db
    .prepare(`SELECT ${SECTION_COLS} FROM hk_sections WHERE ${where} ORDER BY seq LIMIT ? OFFSET ?`)
    .bind(...bindArgs, opts.limit, opts.offset)
    .all<SectionRow>();
  return { rows: r.results, total: total?.n ?? 0 };
}

/** "2" / "s2" / "section 2" / "2A" all normalize to the same key the loader
 *  stored, so any common spelling resolves a provision. */
export function normalizeSectionNo(v: string): string {
  const cleaned = String(v).trim().replace(/^s(?:ec(?:tion)?)?\.?\s*/i, '');
  const m = /^(\d+)([A-Za-z]{0,2})$/.exec(cleaned);
  if (!m) return cleaned.toUpperCase();
  return m[2] ? `${m[1]}${m[2].toUpperCase()}` : m[1];
}

export async function getSection(
  db: D1Like,
  opts: { cap: string; capSuffix: string | null; sectionNo: string },
): Promise<SectionRow | null> {
  const norm = normalizeSectionNo(opts.sectionNo);
  const where = opts.capSuffix ? `cap = ? AND cap_suffix = ?` : `cap = ? AND cap_suffix IS NULL`;
  const bindArgs = opts.capSuffix ? [opts.cap, opts.capSuffix] : [opts.cap];
  return db
    .prepare(`SELECT ${SECTION_COLS} FROM hk_sections WHERE ${where} AND section_no_norm = ? LIMIT 1`)
    .bind(...bindArgs, norm)
    .first<SectionRow>();
}
