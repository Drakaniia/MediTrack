# MediTract — Medical Supply Expiry Tracking

A web-based, role-based system that registers medical supplies by batch, tracks expiry, classifies each batch (Safe / Near Expiry / Urgent / Expired), prioritizes dispensing by FEFO (First-Expiry, First-Out), and raises alerts. Deployed to Cloudflare Pages with Pages Functions as the API and D1 as the database.

## Features

- **Inventory Management** — Register supplies by batch with expiry dates, quantities and barcodes
- **Expiry Classification** — Every batch is classified automatically and surfaced in alerts
- **FEFO Dispensing** — Deductions always come off the batch that expires first
- **Request Queue** — Staff requests move through an approval workflow (Ctrl+N / ⌘N to create one)
- **Alerts** — In-app, web push and email digest notifications from a scheduled Worker
- **Analytics & Reports** — Usage trends, stock and expiry reports with PDF / XLSX export

## Tech Stack

- **Frontend:** React 19, TanStack Router and Query, Tailwind CSS 4, Vite
- **UI:** Base UI, shadcn/ui, Lucide icons
- **Charts:** Visx (D3-based)
- **Backend:** Cloudflare Pages Functions, Cloudflare D1, a scheduled Worker for alerts
- **Language:** TypeScript

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24.0.0
- [pnpm](https://pnpm.io/) >= 12.3.4

## Getting Started

```bash
# Install dependencies
pnpm install

# Start the web app (API + local D1 + Vite)
pnpm web:dev
```

Open `http://localhost:3002`. See [`apps/web/README.md`](apps/web/README.md) for seeding,
migrations, production setup and CI/CD.

## Development

```bash
# Lint
pnpm lint

# Type checking
pnpm check-types

# Tests
pnpm test
pnpm test:web
pnpm test:cron

# Build
pnpm build
```

## Project Structure

```
meditract/
├── apps/
│   └── web/              # React SPA + Pages Functions API + D1 migrations
├── packages/
│   ├── config/           # Shared TypeScript configurations
│   └── ui/               # Shared UI components and design system
├── workers/
│   └── cron/             # Scheduled Worker: alerts, web push, email digest
├── scripts/              # Dev, migration and seed scripts for apps/web
├── pnpm-workspace.yaml   # pnpm workspace configuration
└── package.json          # Root package.json
```

## Privacy

See the [Privacy Statement](docs/privacy-web.md).

## License

[MIT](LICENSE)
