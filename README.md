# Convertly

Convertly is a self-hosted web application for converting, combining, and packaging common document formats. Most tools run entirely in the browser; Office-to-PDF and OCR use an isolated server-side conversion service.

## Features

- Office documents to PDF with LibreOffice
- PDF merge, split, page extraction, and rotation
- JPG, PNG, and WebP conversion
- Multiple images to PDF
- JSON, CSV, XML, and YAML conversion
- Markdown, HTML, and plain text publishing
- JSON or CSV to ICS
- ICS calendar merging
- On-device comparison of two ICS calendars by event identity and properties
- Preservation of embedded iCalendar events, recurring rules, exceptions, alarms, attendees, and timezone definitions
- JSON or CSV contacts to a multi-contact VCF 3.0 address book
- Normalized contact CSV export for contact-management imports
- OCR to searchable PDF or plain text
- Browser-side ZIP creation

Adobe PSD, PSB, AI, EPS, and native INDD conversion are intentionally outside the project scope.

## Local development

Requirements: Node.js 22 or later.

```sh
npm install
npm run dev
```

Run the automated tests and production build with:

```sh
npm test
npm run build
```

## Docker deployment

### Prebuilt release images

Public, versioned multi-platform images are published to GitHub Container Registry for AMD64 and ARM64:

- `ghcr.io/martythedev-tech/convertly-web`
- `ghcr.io/martythedev-tech/convertly-api`

```sh
cp .env.example .env
docker compose pull
docker compose up -d
```

Set `CONVERTLY_VERSION` in `.env` to a numbered release instead of `latest` for repeatable deployments. For the strongest pinning, replace the image tags in `docker-compose.yml` with the published SHA-256 digests.

Release images include BuildKit provenance and SBOM attestations. Image tags include the semantic version, major/minor version, commit SHA, and `latest`.

### Build from source

Docker Compose builds both the frontend and conversion API. The web application defaults to port `8080`; set `CONVERTLY_PORT` to use another host port.

```sh
CONVERTLY_PORT=8080 docker compose -f docker-compose.dev.yml up -d --build
```

The API is available only to the frontend container and is not published directly to the host.

## Privacy and security

- Browser-capable conversions stay on the user’s device.
- Office conversion and OCR use temporary files that are removed after the response completes.
- The API container uses a read-only root filesystem, temporary in-memory storage, process and memory limits, and `no-new-privileges`.
- Files are limited to 100 MB each.
- Do not expose the application to the public internet without adding TLS, authentication, request throttling, and appropriate network controls.

## Calendar conversion

For JSON exports containing complete iCalendar data, Convertly preserves the embedded `VEVENT` and `VTIMEZONE` components instead of reducing each record to a basic title and date. Generic JSON and CSV event lists are also supported.

Basic JSON example:

```json
[
  {
    "title": "Project kickoff",
    "start": "2026-10-20T09:00:00-05:00",
    "end": "2026-10-20T10:00:00-05:00",
    "location": "Conference room"
  }
]
```

CSV columns: `title`, `start`, `end`, `description`, `location`, and `url`.

## ICS comparison

The ICS comparer accepts exactly two calendar files and treats the first as the baseline. Events are matched by `UID` plus `RECURRENCE-ID`, so recurring exceptions are compared independently from their parent series. The report identifies events that are only in the first calendar, only in the second calendar, changed, or unchanged. Separate category tabs keep large result sets navigable.

When a calendar has suspicious recurrence structures, the comparer displays a warning and provides a secondary UID-only probable-match analysis. This helps identify logically related records without misrepresenting them as exact calendar matches. Timezone-definition changes and complete downloadable CSV and JSON results are also included.

Generated metadata such as `DTSTAMP`, `CREATED`, and `LAST-MODIFIED`, line folding, and property order are normalized so they do not create misleading differences. Calendar comparison runs entirely in the browser.

## Contact conversion

The Contact exporter accepts JSON or CSV data and creates either a multi-contact VCF 3.0 file or a normalized CSV. It recognizes common field variants for names, email addresses, phone numbers, organizations, job titles, postal addresses, birthdays, websites, notes, and contact IDs. Nested JSON contact collections are supported, and all processing stays in the browser.

Basic JSON example:

```json
[
  {
    "first_name": "Ada",
    "last_name": "Lovelace",
    "email": "ada@example.com",
    "phone": "+1 555 0100",
    "company": "Analytical Engines"
  }
]
```

## Project structure

- `src/main.js` — interface and conversion orchestration
- `src/calendar.js` — calendar detection and iCalendar preservation
- `src/ics-compare.js` — structured ICS event and timezone comparison
- `src/contacts.js` — contact detection, normalization, VCF generation, and contact CSV export
- `src/style.css` — responsive styling
- `test/calendar.test.js` — calendar regression tests
- `test/ics-compare.test.js` — ICS comparison regression tests
- `test/contacts.test.js` — contact conversion regression tests
- `server/index.js` — Office and OCR endpoints
- `server/Dockerfile` — LibreOffice and OCR runtime
- `deploy/nginx.conf` — frontend server and API proxy
- `docker-compose.yml` — deployment using published images
- `docker-compose.dev.yml` — deployment built from source
- `.github/workflows/publish-images.yml` — tested multi-platform release publishing

## License

Convertly is available under the [MIT License](LICENSE).

