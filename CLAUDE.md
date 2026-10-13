# Solar Customer File Generator: Project Brief

Read this whole file before writing any code. It holds every decision already made with the user.
**Do not start building until the user confirms.** Ask about anything listed under "Open questions".

## Who / what
- Company: **Petlad Sojitra Taluka Saurarja Utpadak Sahkari Mandali Ltd.** (solar EPC vendor, Gujarat, PM Surya Ghar scheme).
- 1,200+ rooftop solar customers. For each customer, the office must print **one complete physical file**.
- Today this is done by hand: copy data from Excel into Word templates, print, collect PDFs, and so on. Slow.
- Goal: a **web app** (runs locally on the user's Windows PC) that shows every customer, which documents are ready or missing, and prints customer files in **batches of 20–30**.
- User is not a programmer. Keep the UI simple. Gujarati text must display and print correctly.

## Documents in each customer file

| # | Document | Source | How the app handles it |
|---|---|---|---|
| 1 | Detail Payee Certificate (cover page, Gujarati) | Excel data | Auto-generate from Word template |
| 2 | Inverter Warranty Card (English) | Excel (name, model) + serial number | Auto-generate from Word template |
| 3 | Model Agreement | PM Surya Ghar vendor portal (already signed and uploaded, **must use the original, never regenerate**: date/signature must match) | User uploads PDF per customer |
| 4 | FL (Feasibility Letter / "Approval of Feasibility") | PM Surya Ghar vendor portal | User uploads PDF per customer |
| 5 | DCR certificate | PM Surya Ghar vendor portal / DCR portal | User uploads PDF per customer |
| 6 | Panel datasheet | Same PDF per panel model (folder of datasheets) | Auto-pick by panel type (rules below) |
| 7 | Bill | Already printed physically | Checkbox "attached" only |
| 8 | Insurance policy | Already printed physically | Checkbox "attached" only |

**Print order (confirmed by user):** Payee → Panel datasheet → Inverter warranty card (SOLARYAAN) or inverter datasheet (other brands) → DCR → Model Agreement → FL. Bill + insurance are added by hand.

The ERP (TheSolarCoop) "Download all (ZIP)" gives a 500 error, so documents 3–5 come from the PM Surya Ghar vendor portal for now.
If the ERP works later, its file names are: `approval-of-feasibility-v1-*.pdf` (FL), `solar-panel-dcr-verification-v1-*.pdf` (DCR); the agreement is uploaded as `other-document-*.pdf` (ambiguous, detect by PDF text).

## Excel: `SOLAR_ROOFTOP_01042026_TO_31032027.xlsx`
- Row 1 = title, **row 2 = headers, data from row 3**. Headers are in Gujarati. Numbers in text use **Gujarati digits** (૦૧૨૩૪૫૬૭૮૯) → normalize to ASCII when parsing.
- Sheets to use: **Residential** (~1,234 rows), **PASHUPALAK** (~195), **commercial** (~53). Ignore the other sheets (installer lists, cleaning schedule, scratch sheets).
- Residential columns: અં.નંબર (sr no) | નામ (name) | ગામ (village) | તાલુકા (taluka) | મોબાઈલ નંબર (mobile) | કિલો વોટ (kW) | પેનલ નંગ (panel count) | પેનલ (panel type) | ઇન્વટર (inverter) | લોન/રોકડા/ચેક | પેમેન્ટની તારીખ | પેમેન્ટની રકમ | પેનલ રેટ | ઇન્સ્ટોલર | નોંધ
- PASHUPALAK and commercial have similar first 9 columns but different later columns. **Map columns by header name, not position.**
- **Customer key = mobile number.** Names are in Gujarati here but in English on the ERP/portal, so never match by name.

## Template 1: Detail Payee Certificate (Gujarati)
Letterhead: Petlad Sojitra Taluka Saurarja Utpadak Sahkari Mandali Ltd., Sayaji Day Workers Compound, Station Road, Petlad, Dist. Anand 388450, Reg No REG/AND/SA(V)/18601/2018, GSTIN 24AAGAP8392R1ZL.
Table fields: નામ (name) · સરનામું (address = village, taluka) · મોબાઇલ નંબર · સિસ્ટમ સાઇઝ (kW) · પેનલ કંપની (e.g. "અદાણી ૫૫૫ વોટ") · ઇન્વેટર કંપની (e.g. "સોલારયાન ૩.૬"),
then a fixed list of enclosed documents. The user will provide the .docx template; use docxtpl-style placeholders.

## Template 2: Warranty Card (English, SOLARYAAN / HowD Innovations Pvt. Ltd.)
Fixed text plus 3 variable fields: **CUSTOMER NAME** (English, uppercase), **MODEL No.** (e.g. "SYS- 3.6", derived from the inverter column "સોલારયાન ૩.૬" → `SYS- 3.6`), **SERIAL NO.** (e.g. 119116126G02064).
- Serial numbers are NOT in the Excel. They are in the ERP or must be typed/pasted in the app (bulk paste: mobile + serial).
- The English name is not in the Excel either. It comes from the ERP/portal or is typed in the app. (Open question.)
- Only applies to SOLARYAAN inverters. Other inverter brands (e.g. APS 3.6) need a different card or none. Ask.

## Panel datasheet rules (folder `D:\DATASHEET`, one subfolder per datasheet)
Parse the પેનલ column: brand (અદાણી=Adani, વારી=Waaree, APS, ટાટા=Tata), TOPCon (ટોપકોન / "ટોપ કોન"), watt(s). The cell may hold **mixed panels**, e.g. `અદાણી ૫૩૫(૪) ૫૫૫(૨)` or `APS ૬૦૦(૫) વારી ૬૧૫ નોન DCR(૩)` (count in brackets) → include **every distinct datasheet needed**. If brand or watt is missing (e.g. just `વારી`), flag "choose datasheet" so the user picks one manually.

| Brand / type | Watt | Datasheet |
|---|---|---|
| Adani PERC | 520–555 | `Adani datasheet/` (have) |
| Adani TOPCon | 605–640 | `adani topcon/` (have) |
| Waaree PERC | 515–545 | `waaree penel datasheet/` (have) |
| Waaree TOPCon (incl. Non-DCR 615) | 615–650 | `Waaree topcon/` (have) |
| Waaree TOPCon | 565–600 (580/585) | https://www.waaree.com/upload/media/elite_series_bin_08_565_600_wel_epd_565_600_144_bin_hc_09_03012025_1756378918.pdf |
| Waaree TOPCon | 600–635 (610) | https://www.waaree.com/upload/media/elite_r_series_bin_21_600_635_wel_epd_600_635_132_bin_hc_03_16102024_1758688896.pdf |
| APS TOPCon | 560–600 | https://australianpremiumsolar.co.in/wp-content/uploads/2025/04/Topcon-560W-to-600w_144C-1.pdf |
| APS 550 (variant TBD) | 530–560 | Mono Facial: https://australianpremiumsolar.co.in/wp-content/uploads/2025/03/Mono-Facial_530W-to-560W_144C.pdf · Mono 990 Facial: https://australianpremiumsolar.co.in/wp-content/uploads/2025/03/Mono_990_Facial_530W-to-560W_144C.pdf · 990 Bifacial: https://australianpremiumsolar.co.in/wp-content/uploads/2025/03/Mono-990-Bifacial-530W-to-555W_144C.pdf |
| APS 600 (variant TBD) | 580–600 | Mono: https://australianpremiumsolar.co.in/wp-content/uploads/2025/03/Mono_580W-to-600W_156C.pdf · Mono 990: https://australianpremiumsolar.co.in/wp-content/uploads/2025/03/Mono_990_580W-to-600W_156C.pdf |
| Tata (variant TBD) | 570–600 | Glass-Glass TP600LG10B: https://www.tatapowersolar.com/wp-content/themes/tpsolar/assets/pdf/TP600LG10B(Glass-Glass).pdf · Backsheet TP600LG10TB: https://www.tatapowersolar.com/wp-content/themes/tpsolar/assets/pdf/TP600LG10TB(Glass-Transparent-Backsheet).pdf |

Store the mapping in an editable config (JSON/UI), not hard-coded, so new panel models can be added later.

## App features
1. **Import Excel** → customer list with tabs per sheet; search by name, village, mobile.
2. **Status table**: one ✅/❌ column per document + overall "Ready".
3. **Customer page**: details, enter English name + inverter serial, upload Agreement/FL/DCR PDFs (drag and drop), preview generated docs.
4. **Bulk upload**: drop many PDFs at once; match to customers by mobile/application number in file name or PDF text, with a manual-fix screen for unmatched files.
5. **Bulk paste** of serial numbers / English names (mobile → value).
6. **Batch print**: filter Ready → select 20–30 → one merged PDF in the right order. Mark them "printed".
7. Data persists (SQLite or similar) so progress across 1,200 customers is never lost.

## Stack (decided: MERN, because the user may host it later)
- `server/`: Node + Express + Mongoose (MongoDB Atlas; URI in `server/.env`). exceljs (Excel), Puppeteer (HTML → PDF, bundled Noto Sans Gujarati font), pdf-lib (merge). `npm test` runs the parser tests.
- `client/`: React + Vite. Built into `client/dist`, which the Express server serves. **Run `npm run build` in `client/` after changing the UI.**
- `start.bat` in the project root installs on first run, starts the server and opens http://localhost:4000.
- The two documents are **HTML templates** in `server/src/lib/templates.js` (not Word). The Payee certificate copies the wording, fonts and measurements of the user's Word file (`payeee.docx`); its letterhead image is `server/assets/letterhead.jpg`. The warranty card is rebuilt from a screenshot and still needs its logo/badge/stamp images in `server/assets/` (see README.txt there).
- UI: standard admin-panel look chosen by the user (side menu, white panels, status pills), bilingual labels (English + Gujarati via the `T` component in `client/src/ui.jsx`), Hind Vadodara font, lucide-react icons. Product context is in `PRODUCT.md`. Users are 2–5 non-technical office staff.
- Datasheet rules are stored in MongoDB (seeded from `server/config/datasheets.default.json`) and edited on the Settings page.
- Optional login: set `APP_PASSWORD` in `server/.env` (required before hosting).

## Status
- **Phase 1 is built**: Excel import, customer list, customer page, Payee certificate, Warranty card, datasheet auto-pick, bulk paste, datasheet settings.
- **Phase 2 is built**: per-customer upload of DCR / Model Agreement / FL (drag and drop, preview, replace, remove), bulk upload with automatic matching (`server/src/lib/uploads.js`: type from file name or PDF text, customer from mobile number or typed English name), a "Waiting for you" queue for PDFs that could not be placed, and bill / insurance tick boxes. Uploaded PDFs are stored on disk in `data/uploads/<customerId>/<type>.pdf`; replaced or removed files are moved to `data/removed/`, never deleted. "Ready" now needs all six printable documents; the bill and insurance ticks do not block it.
- The automatic matching was tested only with dummy PDFs: no real portal PDF has been seen yet. Tune `detectType` / `findCustomers` once the user provides real samples.
- **Phase 3 is built**: Print files page. Pick customers (button selects the next 10/20/25/30 unprinted), make one merged PDF (`POST /api/batches`, stored in `data/batches/`), then mark the batch as printed, which stamps `printedAt` / `printBatch` on its customers; Undo un-marks. Two modes: "Complete files" (needs Ready) and "App documents only" (Payee + datasheet + warranty/inverter sheet, needs `status.generated`). "Printing on both sides" pads odd-page documents with a blank page.
- **Auto English name**: when no English name is typed, the warranty card uses a transliteration of the Gujarati name (`server/src/lib/transliterate.js`, tests in `server/test/transliterate.test.js`; add wrong spellings to its `FIXED` list). A typed name always wins. So SOLARYAAN customers now only need the inverter serial number.
- All four phases in the original plan are built; remaining work is tuning with real portal PDFs and hosting.
- **Leftovers pass**: every panel datasheet now resolves (1,438 of 1,438) and every inverter brand has a datasheet; only the 29 customers with a blank inverter in Excel are blocked. Datasheet rules can carry `pages` (e.g. `2-3`) so only the relevant pages of a long PDF are printed (VELOX 2–3 or 4–5, Polycab catalogue 6–7, Waaree brochure 6, Havells 8); editable on the Datasheets page. `englishNameShown` (typed or automatic) is returned for every customer and used by search. Assumptions made here that the user has not confirmed: "સોલેક્ષ" inverter = SolaX X1-MINI; Waaree 550 W = Ahnay bifacial 520–550.

## Things learned from the real Excel
- 1,438 customers: Residential 1,217 · PASHUPALAK 194 · commercial 27. Each sheet ends with a કુલ (total) row that must be skipped.
- **Mobile is not unique**: 29 numbers are shared by 2–3 customers. Customer key is `sheet|mobile|name`; bulk paste reports shared numbers as "ambiguous".
- Some cells hold two mobile numbers, 9- or 11-digit numbers, or malformed kW like `૪..૦૯`.
- The commercial sheet has two `ઇન્વટર` columns; the first is the inverter, the second an amount.
- Inverter brands: SOLARYAAN (~1,005), VELOX (~238), APS (100), Polycab (57), Waaree, Solex, GoodWe, Havells; ~29 blank.

## Build in phases (user can start using after Phase 1)
1. Excel import + customer list + Payee certificate + Warranty card + datasheet auto-pick
2. Upload Agreement/FL/DCR per customer + status ✅/❌
3. Batch print with correct order + "printed" tracking
4. Later: bulk matching improvements, portal download helper

## Open questions (ask the user)
- Datasheet choices were made by Claude at the user's request and need the user's confirmation: APS 550 → Mono-Facial 530–560; APS 600 without ટોપકોન → APS TOPCon 560–600; Tata → TP600LG10B (Glass-Glass).
- 29 customers have a blank inverter in Excel (the user must fix the Excel and re-import). No datasheet is missing any more.
- The matching was checked (read-only) on one customer's real portal PDFs on 2026-10-13: FL (`approval-of-feasibility-v1-*.pdf`, has the mobile number), Model Agreement and DCR (UUID file names, no mobile number, matched by English name). All three resolved to the right customer and type. More customers are needed to know how often the automatic English name differs from the portal's spelling.
- The user runs the app with `npm run dev` (server under `node --watch`, client under Vite on :5173). Under `--watch`, pdf.js's lazy worker import restarted the server mid-upload (Vite then showed 500s); fixed by loading the worker at startup in `server/src/lib/uploads.js`. Do not remove that import.
- SOLARYAAN model text for whole sizes: app prints `SYS- 6.0` for ૬.૦૦; confirm.
- English name + serial: typed or bulk-pasted in the app (no other source confirmed).

## Bulk-upload matching (rewritten 2026-10-13 after seeing real portal PDFs)
What the real PDFs contain: **FL** = mobile number + application number (`NP-GJMG26-…`) + "Name of Applicant"; **DCR** = application number + name; **Model Agreement** = name only (no number, no mobile).
- `matchCustomer` in `server/src/lib/uploads.js` tries: known application number → mobile number → English name. If two of these point at different customers the PDF goes to "Waiting for you" (never filed automatically).
- When an FL is matched for certain (by mobile), the app learns the customer's `applicationNumber` and, if no English name was typed, sets `englishName` to the portal's spelling from the FL. That name is then used to match the Agreement and is printed on the warranty card.
- After anything is learned, `resolvePending` re-matches every waiting PDF, so the three documents can be dropped in any order.
- `applicationNumber` can also be typed on the customer page or bulk-pasted (Names & serials page).

## Hosting (prepared 2026-10-13, not deployed yet)
- Chosen host: **Render free plan** (web service from `Dockerfile`, blueprint in `render.yaml`) + **Cloudinary free plan** for the uploaded PDFs; the user wants zero cost. Vercel was ruled out: the app needs Chromium (Puppeteer) and long-running requests.
- Storage is switchable in `server/src/lib/storage.js`: no `CLOUDINARY_URL` → `data/` on disk (local, as before); Cloudinary account in `.env` (`CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`, or one `CLOUDINARY_URL`) → Cloudinary, as authenticated raw files under `solar-customer-files/` (no public links; the server downloads with a signed link and serves logged-in staff). Tested against the user's real account on 2026-10-13 (upload, download, replace, set aside, remove, public link refused). The user's local `.env` now has the Cloudinary values, so **the local app also uses Cloudinary**; the PDFs that were in `data/uploads` were copied there.
- Code is on GitHub at `shyamdev001/filemanagement`. Real customer phone numbers must never be used as examples in code or tests (they were replaced with made-up ones before the first commit).
- Print batch PDFs are not stored in the cloud: they are cached in `DATA_DIR/batches` and rebuilt from the batch record when the file is gone (a free host loses its disk on every restart).
- Known limits of the free plan: 512 MB RAM (Chromium + a 30-customer batch may run out; use smaller batches), the server sleeps after about 15 idle minutes and takes about a minute to wake.
- Hosted mode = `NODE_ENV=production`: the server refuses to start unless `APP_PASSWORD` has 8+ characters, and the login cookie is `Secure`. Secrets (`MONGODB_URI`, `APP_PASSWORD`) are typed in the Render dashboard.
- Datasheets for hosting are the `datasheets/` folder in the project (a copy of `D:\DATASHEET`, which the local `.env` still points at). A PDF added to one must be copied to the other.
- Free stand-in fonts are embedded in the templates (Carlito, Arimo, Archivo Black, Archivo Narrow, Noto Sans Gujarati) and used only where the Windows fonts are missing, so hosted documents look slightly different from local ones.
- Hosted mode was tested locally on port 4100 (password guard, login, customers, datasheets, a warranty PDF). The Docker image itself has never been built: Docker is not installed on the user's PC.
- The project is not a git repository yet; Render deploys from a (private) GitHub repo. PDFs already uploaded locally (`data/uploads`) are not on the host and must be uploaded again there.

## Notes added after Phase 1
- The warranty certificate stays landscape (SOLARYAAN's own format). In merged PDFs (customer file and print batches) `mergePdfs` turns every landscape page 270° so the whole file is upright A4 and prints full size with any printer setting; the single-document Preview is left upright. The user was offered a portrait redesign instead and has not asked for it.
- Payee certificate letterhead was replaced on 2026-10-13 with the user's new letterpad (`NEW LETTERPAD.docx`): `server/assets/letterpad.jpg` is a full A4 background (new address B-22 Sardar Patel Anaj Market Yard, APMC Petlad; "THE SOLAR COOP" logo), text starts 62 mm from the top with 20.3 mm side margins. The old `letterhead.jpg` is kept only as a fallback.
- Database is MongoDB Atlas (URI in `server/.env`, never commit it).
- Warranty card follows the user's Word file (`WARRANTY CARD SOLARYAN.docx`); its logo, badge and stamp are in `server/assets/`.
- Inverter datasheets live in `D:\DATASHEET\Inverters\<brand>\`, downloaded from the manufacturers' sites. Inverter rules can be split by size with `minKw` / `maxKw`.
- When the panel cell has a brand but no watt, the watt is worked out from kW ÷ panel count.
