import 'server-only'
import { definiereMeldung, istParameterFehler, parameterFehler, type MeldungenZu } from '../typen'
import { KATALOG_BUCHHALTUNG } from '../katalog/buchhaltung'
import { istUuid, jahrAus, zeitraumAus } from '../buchhaltung-gemeinsam'
import { ladeUva, SPALTEN_UVA, uvaZeitraumAus } from '../uva'
import { eaFilterAus, ladeEaJournal, SPALTEN_EA_JOURNAL } from '../ea-journal'
import { ladeKassabuch, SPALTEN_KASSABUCH } from '../kassabuch'
import { ladeRechnungsjournal, SPALTEN_RECHNUNGSJOURNAL } from '../rechnungsausgang'
import { ladeBelegverzeichnis, SPALTEN_BELEGVERZEICHNIS } from '../belege'
import { ladeAnlagenverzeichnis, SPALTEN_ANLAGENVERZEICHNIS } from '../anlagen'
import { ladeSvsEinheitswerte, SPALTEN_SVS_EINHEITSWERTE } from '../svs'

// Register der Behördenmeldungen – Gruppe „Buchhaltung & Steuer“ (24.09.2026).
// Je Katalog-Eintrag aus katalog/buchhaltung.ts genau ein Eintrag mit CSV (laden + spalten).
// Parameter 1:1 wie die searchParams der Druckseiten; Ladefunktionen in lib/behoerden/
// <meldung>.ts – dieselben, die die Druckseiten verwenden.

export const MELDUNGEN_BUCHHALTUNG = {
  uva: definiereMeldung(KATALOG_BUCHHALTUNG.uva, {
    parameter: sp => {
      const jahr = jahrAus(sp)
      if (istParameterFehler(jahr)) return jahr
      const zeitraum = uvaZeitraumAus(sp)
      if (istParameterFehler(zeitraum)) return zeitraum
      return { jahr, zeitraum }
    },
    laden: (ctx, p) => ladeUva(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_UVA,
    dateiteile: (p, betrieb) => ['UVA', betrieb.betriebsnummer, p.zeitraum ? `${p.jahr}-${p.zeitraum}` : p.jahr],
  }),

  'ea-journal': definiereMeldung(KATALOG_BUCHHALTUNG['ea-journal'], {
    parameter: sp => {
      const jahr = jahrAus(sp)
      if (istParameterFehler(jahr)) return jahr
      const filter = eaFilterAus(sp)
      if (istParameterFehler(filter)) return filter
      return { jahr, ...filter }
    },
    laden: (ctx, p) => ladeEaJournal(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_EA_JOURNAL,
    dateiteile: (p, betrieb) => [
      'EA-Journal', betrieb.betriebsnummer, p.jahr,
      p.typ === 'einnahme' ? 'Einnahmen' : p.typ === 'ausgabe' ? 'Ausgaben' : null,
      p.q ? 'Auszug' : null,
    ],
  }),

  kassabuch: definiereMeldung(KATALOG_BUCHHALTUNG.kassabuch, {
    parameter: sp => {
      const konto = (sp.get('konto') ?? '').trim()
      if (!istUuid(konto)) return parameterFehler('Das Kassa-Konto fehlt oder ist ungültig (?konto=…).')
      const zeitraum = zeitraumAus(sp)
      if (istParameterFehler(zeitraum)) return zeitraum
      return { konto, ...zeitraum }
    },
    laden: (ctx, p) => ladeKassabuch(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_KASSABUCH,
    dateiteile: (p, betrieb) => ['Kassabuch', betrieb.betriebsnummer, p.von, p.bis],
  }),

  rechnungsausgangsjournal: definiereMeldung(KATALOG_BUCHHALTUNG.rechnungsausgangsjournal, {
    parameter: sp => zeitraumAus(sp),
    laden: (ctx, p) => ladeRechnungsjournal(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_RECHNUNGSJOURNAL,
    dateiteile: (p, betrieb) => ['Rechnungsausgangsjournal', betrieb.betriebsnummer, p.von, p.bis],
  }),

  belegverzeichnis: definiereMeldung(KATALOG_BUCHHALTUNG.belegverzeichnis, {
    parameter: sp => {
      const jahr = jahrAus(sp)
      return istParameterFehler(jahr) ? jahr : { jahr }
    },
    laden: (ctx, p) => ladeBelegverzeichnis(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_BELEGVERZEICHNIS,
    dateiteile: (p, betrieb) => ['Belegverzeichnis', betrieb.betriebsnummer, p.jahr],
  }),

  anlagenverzeichnis: definiereMeldung(KATALOG_BUCHHALTUNG.anlagenverzeichnis, {
    parameter: sp => {
      const jahr = jahrAus(sp)
      return istParameterFehler(jahr) ? jahr : { jahr }
    },
    laden: (ctx, p) => ladeAnlagenverzeichnis(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_ANLAGENVERZEICHNIS,
    dateiteile: (p, betrieb) => ['Anlagenverzeichnis', betrieb.betriebsnummer, p.jahr],
  }),

  'svs-einheitswerte': definiereMeldung(KATALOG_BUCHHALTUNG['svs-einheitswerte'], {
    parameter: () => ({}),
    laden: ctx => ladeSvsEinheitswerte(ctx.supabase, ctx.tenantId),
    spalten: SPALTEN_SVS_EINHEITSWERTE,
    dateiteile: (_p, betrieb) => ['SVS-Einheitswerte', betrieb.betriebsnummer],
  }),
} satisfies MeldungenZu<typeof KATALOG_BUCHHALTUNG>
