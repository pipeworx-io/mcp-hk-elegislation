# @pipeworx/hk-elegislation

Hong Kong Ordinances, subsidiary legislation and instruments — full text in
English and Traditional Chinese, both original and equally authentic —
searchable by title, resolvable by exact Cap. (chapter) citation, and
readable one section at a time.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1819+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `hk_law_search(query, limit?)` — find a law by title keyword, English or
  Traditional Chinese ("Personal Data", "個人資料", "Companies Ordinance"),
  or by a bare chapter number ("486").
- `hk_law_info(cap?, title?)` — a law's full metadata: English and Chinese
  titles, in-force status, the version date of the English text and of the
  Chinese text as SEPARATE fields, and whether it is a principal Ordinance,
  subsidiary legislation, or an instrument.
- `hk_law_toc(cap?, title?, offset?, limit?)` — a law's section numbers and
  headings, paged.
- `hk_law_section(cap?, title?, section)` — one section's full text, English
  AND Traditional Chinese side by side, plus its in-force status and
  version-valid-from date.

## Auth

Keyless.

## Data sources

- Hong Kong Department of Justice, e-Legislation — the current-version text
  of every Ordinance, subsidiary legislation instrument and other instrument,
  in English, Traditional Chinese and Simplified Chinese, published as bulk
  archives on DATA.GOV.HK (organisation "hk-doj").

The interactive e-Legislation website gates every page behind a JavaScript
client-capability check that a plain HTTP client cannot pass (verified
2026-10-16) and the DATA.GOV.HK catalog offers only whole-range bulk
downloads — there is no per-chapter or per-section live route. Per Bruce's
2026-09-23 local-copy ruling, this pack reads from a D1 copy loaded by
`scripts/hk-elegislation/load-data.mjs` (English and Traditional Chinese;
Simplified Chinese is also published by the source but not loaded in this
first pass), refreshed by re-running that script. `data_as_of` on every
response is when that load last ran.

**Licence:** DATA.GOV.HK's own Terms of Use grant free browsing, download,
distribution and reproduction of the Data for commercial or non-commercial
purposes, conditioned on identifying the source and acknowledging the HKSAR
Government's ownership of the underlying IP — an explicit reuse grant, not
merely a live-proxy allowance. Every response carries `source`. Only a PDF marked "Verified
Copy" from the e-Legislation website itself is presumed legally accurate as
at its stated date (Legislation Publication Ordinance, Cap. 614 s.5); this
pack, like the live site's own non-PDF views, is provided for information.

## Both languages are original — neither is a "translation"

Under the Official Languages Ordinance (Cap. 5) s.4B, the English and
Chinese texts of a Hong Kong Ordinance are **equally authentic** — this pack
never labels one a translation of the other. `hk_law_section` returns both
side by side, each carrying its own version-valid-from date, because one
language's text can be consolidated ahead of the other after an amendment.

## Notes

- `hk_law_search` is a TITLE search — it will not find a law by a phrase that
  appears only inside a section's text.
- `hk_law_section` answers BODY-section citations ("section 2"). A
  Schedule's own numbered provisions (e.g. PDPO Schedule 1's "section 1",
  the Data Protection Principles) restart their own numbering and are not
  yet separately retrievable — a known gap, not a silent collision: the
  loader explicitly excludes schedule/annex content from section matching so
  a schedule's "section 1" can never be confused with the body's section 1.
- A long section is returned as the section's own full text, which can
  itself be long for a definitions section (e.g. Cap. 486 s.2); `hk_law_toc`
  is how to browse a law's structure before reading one section at a time,
  and the whole law is never returned in one call.
- Subsidiary legislation is addressed with a letter suffix on the chapter
  number ("486A"), matching the source's own citation convention.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "hk-elegislation": {
      "url": "https://gateway.pipeworx.io/hk-elegislation/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/hk-elegislation/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1819+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/hk_law_search \
  -H 'Content-Type: application/json' \
  -d '{"query":"Personal Data"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/hk_law_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "hk-elegislation": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-hk-elegislation"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-hk-elegislation
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Hk Elegislation data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
