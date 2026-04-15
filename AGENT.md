# Agent Context

## Goal

Add a dictionary of technological terms (术语) to help with better translation in the paper reading web application. The dictionary should:
- Be saved into the database
- Auto-collect terms as papers are processed
- Support human verification
- Use verified terms to improve LLM translation quality
- Support import/export in JSON format

## Instructions

- Verified terms should only be appended to LLM context when the term appears in the input text
- Human verification is required - auto-checkup can flag inconsistencies but only humans can verify
- Multiple translations per English term allowed (with context field)
- Server should not crash on network errors

## Discoveries

- The same English term can have different Chinese translations in different contexts, so a `context` field was added to allow multiple translations per term
- PDF URLs from arXiv were causing timeout errors - resolved by redirecting to abstract pages
- Original background workers shared state causing conflicts - consolidated into single framework with task registry

## Accomplished

1. **Database**: Added `tech_terms` table with fields: `term_en`, `term_zh`, `context`, `verified`, `use_count`, `source_paper_id`
2. **Backend Routes** (`src/routes/techterms.js`):
   - GET/POST/PUT/DELETE `/api/tech-terms`
   - POST `/api/tech-terms/verify/:id`
   - GET `/api/tech-terms/stats`
   - GET `/api/tech-terms/export`
   - POST `/api/tech-terms/import`
3. **Auto-collection**: Modified `bgSummarizeWorker` to extract tech terms from paper abstracts after processing
4. **LLM Integration**: Modified `callLlm` to accept glossary parameter, `buildGlossary()` filters verified terms that appear in input
5. **Frontend**: Added "📖 术语" button, term management panel with table, filter, sort, verify/edit/delete actions, import/export
6. **Bug fixes**:
   - Null safety in stats query
   - "返回论文" button was calling `show()` instead of `hide()`
   - Wrapped workers to prevent server crash on network errors
   - Consolidated duplicate worker code into single framework
   - Redirect arxiv.org/pdf/ URLs to abstract pages

## Relevant files / directories

- `/home/aliy/GitHub/paper_reading_webui/server.js` - Added routes registration, error handlers
- `/home/aliy/GitHub/paper_reading_webui/src/db/database.js` - Added tech_terms table migration
- `/home/aliy/GitHub/paper_reading_webui/src/routes/techterms.js` - New file: API routes and helper functions
- `/home/aliy/GitHub/paper_reading_webui/src/routes/worker.js` - Consolidated worker framework, auto-term extraction
- `/home/aliy/GitHub/paper_reading_webui/src/routes/papers.js` - Added glossary usage in import-url
- `/home/aliy/GitHub/paper_reading_webui/src/services/llm.js` - Added glossary parameter to callLlm
- `/home/aliy/GitHub/paper_reading_webui/src/services/web.js` - PDF URL redirect, error handling
- `/home/aliy/GitHub/paper_reading_webui/src/web/app.js` - TechTermsApp frontend component
- `/home/aliy/GitHub/paper_reading_webui/src/web/api.js` - API methods for tech terms
- `/home/aliy/GitHub/paper_reading_webui/index.html` - Terms panel UI

## Known Issues / TODO

- [ ] Add more test coverage for edge cases
- [ ] Consider adding term frequency analysis
- [ ] Add bulk verify feature
- [ ] Consider fuzzy matching for term lookup

## Bug Fixes

7. **Email sync**: Fixed "UID/seqno must be an integer" error by adding null checks for `uid` in email fetch callback and filtering invalid UIDs before calling `setFlags`