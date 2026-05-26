# software:112

**Vom Rebstock bis zur Rechnung. Alles in einem System.**

Weinbau-Management-System für österreichische Weinbaubetriebe.  
Stack: Next.js 15 · Supabase · Tailwind CSS · Vercel

---

## Phase 0 – Setup-Checkliste

### 1. Repository & Dependencies

```bash
# Im Projektordner
npm install
```

### 2. Supabase-Projekt anlegen

1. → [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Region: **Frankfurt (eu-central-1)**
3. Nach der Erstellung: **Project Settings → API** öffnen
4. Folgende Werte kopieren:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` Key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` Key → `SUPABASE_SERVICE_ROLE_KEY`

### 3. Umgebungsvariablen

```bash
cp .env.local.example .env.local
# Dann .env.local mit den Supabase-Werten befüllen
```

### 4. Datenbank-Migrations ausführen

Im Supabase Dashboard → **SQL Editor**:

```sql
-- Schritt 1: Grundstruktur
-- Datei: supabase/migrations/001_initial_schema.sql  (komplett kopieren & ausführen)

-- Schritt 2: RLS-Policies
-- Datei: supabase/migrations/002_rls_policies.sql  (komplett kopieren & ausführen)
```

### 5. Lokale Entwicklung starten

```bash
npm run dev
# → http://localhost:3000
```

### 6. Vercel-Projekt anlegen

1. → [vercel.com](https://vercel.com) → **New Project** → GitHub-Repo `software112` importieren
2. Framework: **Next.js** (wird automatisch erkannt)
3. Environment Variables im Vercel-Dashboard eintragen (gleiche wie `.env.local`)
4. Deploy → CI/CD läuft ab jetzt automatisch bei jedem Push auf `main`

---

## Projektstruktur

```
software112/
├── src/
│   ├── app/
│   │   ├── (auth)/login/        # Login-Seite
│   │   ├── (dashboard)/         # Geschützter Bereich
│   │   ├── auth/callback/       # Supabase Auth Callback
│   │   ├── layout.tsx           # Root Layout
│   │   └── page.tsx             # Redirect-Handler
│   ├── components/
│   │   └── layout/Sidebar.tsx   # Navigation
│   ├── lib/
│   │   ├── supabase/            # Client & Server Helpers
│   │   └── types/               # TypeScript Typen
│   └── middleware.ts            # Auth-Schutz aller Routen
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql   # Tabellen + Trigger
│       └── 002_rls_policies.sql    # Rollenmodell + RLS
├── .env.local.example
└── package.json
```

## Rollenmodell

| Rolle           | Beschreibung                              | Lesen | Schreiben | Admin |
|-----------------|-------------------------------------------|-------|-----------|-------|
| `system_admin`  | Plattform-Administrator (IC&P)            | ✓     | ✓         | ✓     |
| `tenant_admin`  | Betriebsleiter / Geschäftsführer          | ✓     | ✓         | ✓     |
| `winzer`        | Kellermeister / Mitarbeiter               | ✓     | ✓         | ✗     |
| `leser`         | Nur-Lesen (z.B. Buchhalter, Steuerberater)| ✓     | ✗         | ✗     |

---

## Entwicklungs-Roadmap

| Phase | Inhalt                               | Status     |
|-------|--------------------------------------|------------|
| 0     | Fundament & Setup                    | ✅ Heute    |
| 1     | Weingarten, Kellerbuch, DAC          | Sprint 1–5 |
| 2     | Weinhandel, CRM, Buchhaltung         | Sprint 6+  |
| 3     | Reports, Behörden-Anbindung          | Q4 2026    |

---

*IC&P Consultants e.U. · software:112 · Projektstart 26. Mai 2026*
