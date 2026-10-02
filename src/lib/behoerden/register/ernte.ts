import 'server-only'
import { PROFIL_BKI } from '@/lib/csv'
import { definiereMeldung, type MeldungenZu } from '../typen'
import { KATALOG_ERNTE } from '../katalog/ernte'
import { jahrgangOptional, jahrgangParameter } from '../ernte_hilfen'
import { jahrgangFinden, ladeErntemeldung, ladeLesedaten, SPALTEN_ERNTEMELDUNG, SPALTEN_LESEDATEN } from '../erntemeldung'
import { bestandKennzeichnung, ladeBestandsmeldung, SPALTEN_BESTANDSMELDUNG, stichtagParameter } from '../bestandsmeldung'
import { ladeBkiTraubenverkauf, SPALTEN_BKI_TRAUBENVERKAUF } from '../traubenverkauf'

// Register der Behördenmeldungen – Gruppe „Ernte & Lese“ (Weinerntemeldung, Lesedaten, BKI-Datenblatt Traubenverkauf, Weinbestandsmeldung (KAN-43)).
// Je Katalog-Eintrag aus katalog/ernte.ts genau ein Eintrag mit CSV (laden + spalten).
// Druckseiten und CSV nutzen dieselben Ladefunktionen (lib/behoerden/erntemeldung.ts,
// bestandsmeldung.ts, traubenverkauf.ts). Parameter wie die searchParams der Druckseite.
//
// Leermeldung: Erntemeldung und Lesedaten eines im Betrieb nicht angelegten (aber plausiblen,
// 1900–2100) Jahrgangs ergeben eine gültige Datei nur mit Kopfzeile plus Hinweis – eine
// Nullmeldung (z. B. Totalausfall durch Hagel) kann amtlich verlangt sein, und ohne Ernte
// legt ein Betrieb meist keinen Jahrgang an. Nur das BKI-Datenblatt antwortet mit HTTP 400.

const leermeldung = (jahrgang: number) => ({
  zeilen: [],
  warnungen: [`Den Jahrgang ${jahrgang} gibt es in diesem Betrieb nicht (keine Lesedaten) – Leermeldung nur mit Kopfzeile.`],
})

export const MELDUNGEN_ERNTE = {
  erntemeldung: definiereMeldung(KATALOG_ERNTE.erntemeldung, {
    parameter: jahrgangParameter,
    laden: async (ctx, p) => {
      const jg = await jahrgangFinden(ctx.supabase, ctx.tenantId, p.jahrgang)
      if (!jg) return leermeldung(p.jahrgang)
      const daten = await ladeErntemeldung(ctx.supabase, ctx.tenantId, jg)
      return { zeilen: daten.zeilen, warnungen: daten.warnungen }
    },
    spalten: SPALTEN_ERNTEMELDUNG,
    dateiteile: (p, betrieb) => ['Erntemeldung', betrieb.betriebsnummer, p.jahrgang],
    // KAN-95: Jahr = Stichtag der Erntemeldung (30.11. des Jahrgangs), auch bei Export im Folgejahr
    bki: p => ({ bericht: 'Erntemeldung', jahr: p.jahrgang }),
  }),

  lesedaten: definiereMeldung(KATALOG_ERNTE.lesedaten, {
    parameter: jahrgangParameter,
    laden: async (ctx, p) => {
      const jg = await jahrgangFinden(ctx.supabase, ctx.tenantId, p.jahrgang)
      if (!jg) return leermeldung(p.jahrgang)
      return ladeLesedaten(ctx.supabase, jg.id, { mitStornierten: true })   // KAN-148: stornierte gekennzeichnet
    },
    spalten: SPALTEN_LESEDATEN,
    dateiteile: (p, betrieb) => ['Lesedaten', betrieb.betriebsnummer, p.jahrgang],
    // KAN-95 (Nachtrag 02.10.2026, Jörgen): Jahr = Jahrgang wie bei der Erntemeldung, auch bei Export im Folgejahr
    bki: p => ({ bericht: 'Lesedaten', jahr: p.jahrgang }),
  }),

  // KAN-43: Bestand zum Stichtag (?stichtag=JJJJ-MM-TT, Standard 31.07. des laufenden Weinwirtschaftsjahres,
  // „heute“ = Ist-Bestand, Zukunft → 400). Der Stichtag gilt für Dateiname, Spalte „Bestand am“ und BKI-Jahr.
  bestandsmeldung: definiereMeldung(KATALOG_ERNTE.bestandsmeldung, {
    parameter: sp => stichtagParameter(sp),
    laden: async (ctx, p) => {
      const daten = await ladeBestandsmeldung(ctx.supabase, ctx.tenantId, { stichtag: p.stichtag })
      return { zeilen: daten.zeilen, warnungen: daten.warnungen }
    },
    spalten: SPALTEN_BESTANDSMELDUNG,
    dateiteile: (p, betrieb) => ['Weinbestand', betrieb.betriebsnummer, bestandKennzeichnung(p.stichtag)],
    // KAN-95: Jahr = Jahr des Stichtags
    bki: p => ({ bericht: ['Weinbestand', bestandKennzeichnung(p.stichtag)], jahr: Number(p.stichtag.slice(0, 4)) }),
  }),

  // Maschinen-Upload in die Weindatenbank: PROFIL_BKI (Vorspann, kein Formelschutz)
  'bki-traubenverkauf': definiereMeldung(KATALOG_ERNTE['bki-traubenverkauf'], {
    profil: PROFIL_BKI,
    parameter: jahrgangOptional,
    laden: (ctx, p) => ladeBkiTraubenverkauf(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_BKI_TRAUBENVERKAUF,
    dateiteile: (p, betrieb) => ['BKI_Traubenverkauf', betrieb.betriebsnummer, p.jahrgang ?? 'alle Jahrgänge'],
    bki: p => ({ bericht: ['Traubenverkauf', p.jahrgang ?? 'alle Jahrgänge'] }),
  }),
} satisfies MeldungenZu<typeof KATALOG_ERNTE>
