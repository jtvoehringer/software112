# Lock entfernen falls vorhanden
if (Test-Path ".git\index.lock") { Remove-Item ".git\index.lock" -Force }
if (Test-Path ".git\HEAD.lock") { Remove-Item ".git\HEAD.lock" -Force }

# ── Session: Behandlungen Edit + Berichte-Fix + Mehrfacherfassung + Rieden ──────
git add `
  "supabase/migrations/079_profiles_fix_full_name.sql" `
  "supabase/migrations/080_zukauf_einstandspreis.sql" `
  "supabase/migrations/081_view_fuellstand_zukauf.sql" `
  "supabase/migrations/082_weingarten_lage_id_sync.sql" `
  "src/app/api/profil/route.ts" `
  "src/app/(dashboard)/layout.tsx" `
  "src/app/(dashboard)/reports/page.tsx" `
  "src/app/(dashboard)/erntemeldung/actions.ts" `
  "src/app/(dashboard)/erntemeldung/page.tsx" `
  "src/app/(dashboard)/erntemeldung/JahrgaengeClient.tsx" `
  "src/app/(dashboard)/erntemeldung/[id]/page.tsx" `
  "src/app/(dashboard)/erntemeldung/[id]/ErnteDetailClient.tsx" `
  "src/app/(dashboard)/erntemeldung/[id]/page.tsx" `
  "src/app/(dashboard)/erntemeldung/[id]/PressungSection.tsx" `
  "src/app/(dashboard)/behandlungen/actions.ts" `
  "src/app/(dashboard)/behandlungen/BehandlungenClient.tsx" `
  "src/app/(dashboard)/behandlungen/page.tsx" `
  "src/app/(dashboard)/behandlungen/[id]/edit/page.tsx" `
  "src/app/(dashboard)/behandlungen/[id]/edit/BehandlungEditForm.tsx" `
  "src/app/(dashboard)/behandlungen/berichte/page.tsx" `
  "src/app/(dashboard)/behandlungen/berichte/BerichteClient.tsx" `
  "src/app/(dashboard)/behandlungen/lager/LagerClient.tsx" `
  "src/app/(dashboard)/behandlungen/neu/NeueBehandlungForm.tsx" `
  "src/app/(dashboard)/weinhandel/zukauf/actions.ts" `
  "src/app/(dashboard)/weinhandel/zukauf/neu/page.tsx" `
  "src/app/(dashboard)/weinhandel/zukauf/[id]/edit/ZukaufEditForm.tsx" `
  "src/app/(dashboard)/weinhandel/zukauf/[id]/edit/page.tsx" `
  "src/app/(dashboard)/weinhandel/preisliste/[id]/page.tsx" `
  "src/app/(dashboard)/weinhandel/verkauf/neu/page.tsx" `
  "src/app/(dashboard)/weinexport/[id]/WeinexportDetailClient.tsx" `
  "src/app/(dashboard)/weinexport/neu/WeinexportFormClient.tsx" `
  "src/app/(dashboard)/weingarten/actions.ts" `
  "src/app/(dashboard)/weingarten/neu/page.tsx" `
  "src/app/(dashboard)/weingarten/[id]/page.tsx" `
  "src/app/(dashboard)/weingarten/page.tsx" `
  "src/app/(dashboard)/weingarten/WeingartenBaum.tsx" `
  "src/app/(dashboard)/weingarten/WeingartenTable.tsx" `
  "src/app/(dashboard)/weingarten/GrundstueckePanel.tsx" `
  "src/app/(dashboard)/lagen/LagenClient.tsx" `
  "src/app/(dashboard)/lagen/actions.ts" `
  "src/app/(dashboard)/kellerbuch/behaelter/[id]/behandlungen/page.tsx" `
  "src/app/(dashboard)/reports/keller/KellerAuswertungenClient.tsx" `
  "src/app/(dashboard)/controlling/kostenrechnung/page.tsx" `
  "src/app/(dashboard)/dashboard/page.tsx" `
  "src/components/layout/Sidebar.tsx" `
  "src/components/weingarten/WeingartenForm.tsx" `
  "src/lib/format.ts"

# ── Migration 083 ─────────────────────────────────────────────────────────────
git add "supabase/migrations/083_ernte_parzellen_weinbezeichnung.sql"

# Status prüfen
git status --short

# Commit
git commit -m "feat: Pressung auto-erstellt Weinausbau-Charge im Kellerbuch + Kellerbehandlung °C + KMW Übersicht"

# Push
git push

Write-Host "`n✅ Fertig! Build startet auf Vercel." -ForegroundColor Green
Write-Host "Migration 083 danach in Supabase SQL Editor ausführen!" -ForegroundColor Yellow
