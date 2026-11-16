<div align="center">
  <h1>ATS Resume Studio (Personal Local-First Edition)</h1>

  <p>
    A specialized, local-first AI ATS Resume Studio built on top of
    <a href="https://github.com/reactive-resume/reactive-resume"><strong>Reactive Resume</strong></a>
    by <a href="https://github.com/AmruthPillai"><strong>Amruth Pillai</strong></a>.
  </p>

  <p>
    <a href="./LICENSE"><strong>MIT License</strong></a>
    ·
    <a href="#attribution--license"><strong>Attribution &amp; License</strong></a>
    ·
    <a href="#quick-start"><strong>Quick Start</strong></a>
  </p>
</div>

---

## Attribution & License

This repository is a personal, local-first fork of **[Reactive Resume](https://github.com/reactive-resume/reactive-resume)**, created and maintained by **[Amruth Pillai (`@AmruthPillai`)](https://github.com/AmruthPillai)**.

- Original Copyright: `Copyright (c) 2026 Amruth Pillai`
- License: **[MIT License](./LICENSE)** (preserved verbatim)

All original UI, PDF rendering engine integration, editor architecture, and core resume builder functionality belong to Reactive Resume and its contributors under the MIT License.

---

## Overview

ATS Resume Studio customizes Reactive Resume for single-user, local-first ATS tailoring workflows:

- **Live Editor & PDF Rendering**: Write, Design, Check, and Export modes with live Forme-powered PDF rendering (no headless browser dependency).
- **Local-First Architecture**: Designed to run locally with PostgreSQL, local filesystem storage, and OpenAI-compatible local LLM endpoints (Ollama / Bionic).
- **Rich Formats**: Export resumes as PDF, Word (DOCX), Markdown, or JSON, and import existing resumes cleanly.
- **Templates**: Includes 18 built-in templates (`Azurill`, `Bronzor`, `Chikorita`, `Ditgar`, `Ditto`, `Gengar`, `Glalie`, `Kakuna`, `Lapras`, `Leafish`, `Meowth`, `Onyx`, `Persian`, `Pikachu`, `Porygon`, `Rhyhorn`, `Scizor`, `Smeargle`).

## Quick Start

```bash
# Create your local environment file
cp .env.example .env

# Start local backing services (PostgreSQL)
docker compose -f compose.dev.yml up -d postgres

# Install dependencies and start dev servers
pnpm install
pnpm db:migrate
pnpm dev
```

## Tech Stack

| Category         | Technology                              |
| ---------------- | --------------------------------------- |
| Web app          | React 19 SPA, TanStack Router, and Vite |
| Server           | Hono on Node.js 26                      |
| Language         | TypeScript                              |
| Monorepo         | pnpm and Turborepo                      |
| Database         | PostgreSQL with Drizzle ORM             |
| API              | oRPC and OpenAPI REST                   |
| Styling          | Tailwind CSS                            |
| UI Components    | Base UI + shared UI package             |
| State Management | Zustand + TanStack Query                |
| PDF rendering    | Forme, with PDF.js for the viewer       |
| Rich text        | TipTap                                  |
| Localization     | Lingui                                  |

---

## Attribution & License

Based on **[Reactive Resume](https://github.com/reactive-resume/reactive-resume)** by **[Amruth Pillai](https://github.com/AmruthPillai)**.
Licensed under the **[MIT License](./LICENSE)** — `Copyright (c) 2026 Amruth Pillai`.
