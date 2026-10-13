# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Office staff of Petlad Sojitra Taluka Saurarja Utpadak Sahkari Mandali Ltd. (a solar cooperative in Petlad, Gujarat): 2–5 people, not technical, working on Windows PCs at the office during the day. They read Gujarati first and English second. Their job is to assemble one complete printed file per rooftop-solar customer and to know, for any customer, what is still missing. (Confirmed by the owner on 2026-10-12.)

## Product Purpose

Replace hand-copying from Excel into Word. The app imports the cooperative's customer workbook (about 1,440 customers), generates the Payee certificate and inverter warranty card, picks the right panel datasheet, tracks which documents each customer has, and (later phases) merges everything into print batches of 20–30 files. Success: a staff member can see at a glance who is ready, fix what is missing, and print complete files without opening Word.

## Positioning

Built around this cooperative's own workbook, document set and print order under the PM Surya Ghar scheme; it is not a general document tool.

## Operating Context

- Source of truth for customer data is the Excel workbook; the app is re-imported from it whenever it changes.
- Customer names, villages and panel/inverter descriptions are in Gujarati script, with Gujarati digits.
- Work happens in long sessions over a list of ~1,440 rows: search, open a customer, type an English name and serial number, check, move on.
- Output is paper: PDFs printed and put in a physical file, in a fixed order.

## Capabilities and Constraints

- Screens: customer list with per-document status, customer page, bulk paste of names/serials, Excel import report, datasheet settings, optional login.
- Interface labels are bilingual: English with Gujarati beside main headings, navigation and buttons. (Confirmed 2026-10-12.)
- Gujarati text must render and print correctly everywhere.
- Runs locally from `start.bat` today; may be hosted later.

## Brand Commitments

- The cooperative's letterhead (orange lettering, sun-and-solar-panel mark) from its own Word file: `server/assets/letterhead.jpg`. It belongs to the printed documents.

## Evidence on Hand

- The real workbook, the cooperative's Payee certificate Word file, and a screenshot of the SOLARYAAN warranty certificate.
- No app logo, screenshots, testimonials or marketing material exist; do not invent any.

## Product Principles

1. The list answers "who is ready and what is missing" before anything else.
2. Staff should never need to guess: every "not ready" says exactly what to do.
3. Excel stays the source of truth; the app never silently changes or drops a customer.
4. Gujarati is first-class, not a fallback.
5. Familiar over clever: it should feel as plain to use as the Excel sheet it replaces.

## Visual direction (chosen by the owner, 2026-10-12)

Standard modern admin panel, played straight: side menu, white panels, coloured status pills. Conventional on purpose; do not make it quirky.
