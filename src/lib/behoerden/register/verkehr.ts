import 'server-only'
import { definiereMeldung, MeldungsFehler, parameterFehler, type MeldungenZu } from '../typen'
import { KATALOG_VERKEHR } from '../katalog/verkehr'
import { UUID_RE, dateiParameter, istDatum } from '../verkehr-hilfen'
import { ladeTransportbescheinigung, ladeTransportbescheinigungen, SPALTEN_TRANSPORTBESCHEINIGUNG } from '../transportbescheinigung'
import { ladePruefnummernantrag, SPALTEN_PRUEFNUMMERNANTRAG } from '../pruefnummernantrag'
import { ladeDacAntraege, SPALTEN_DAC_ANTRAEGE } from '../dac'
import { ladeExportauftrag, ladeExportauftraege, SPALTEN_EXPORTAUFTRAG, SPALTEN_EXPORTAUFTRAEGE } from '../exportauftrag'
import { ladeZm, SPALTEN_ZM } from '../zm'
import { ladeEmcsDatenblatt, SPALTEN_EMCS_DATENBLATT } from '../emcsDatenblatt'
import { jahrAus } from '../buchhaltung-gemeinsam'
import { uvaZeitraumAus } from '../uva'
import { istParameterFehler } from '../typen'

// Register der Behördenmeldungen – Gruppe „Weinverkehr & Export“ (Transportbescheinigung (TBS), Prüfnummernantrag (PNA), DAC-Anträge, Weinexport/EMCS).
// Je Katalog-Eintrag aus katalog/verkehr.ts genau ein Eintrag mit CSV (laden + spalten).
// Die Druckseiten nutzen dieselben Ladefunktionen (lib/behoerden/<meldung>.ts).
//
// Parameter wie die Druckseite: id = Verkaufsposten bzw. DAC-Antrag bzw. Exportauftrag.
// beleg/bez/referenz sind optional und gehen nur in den Dateinamen (die Druckseite kennt sie).

/** id (UUID) aus den Query-Parametern */
function idParameter(sp: URLSearchParams, was: string): { id: string } | ReturnType<typeof parameterFehler> {
  const id = (sp.get('id') ?? '').trim()
  return UUID_RE.test(id) ? { id } : parameterFehler(`${was} fehlt oder ist ungültig (Parameter id).`)
}

export const MELDUNGEN_VERKEHR = {
  transportbescheinigung: definiereMeldung(KATALOG_VERKEHR.transportbescheinigung, {
    parameter: sp => {
      const p = idParameter(sp, 'Verkaufsposten')
      return 'id' in p ? { id: p.id, beleg: dateiParameter(sp, 'beleg') } : p
    },
    laden: async (ctx, p) => {
      const r = await ladeTransportbescheinigung(ctx.supabase, ctx.tenantId, { id: p.id })
      if (!r) throw new MeldungsFehler(404, 'Verkaufsposten nicht gefunden.')
      return { zeilen: r.zeilen, warnungen: r.warnungen }
    },
    spalten: SPALTEN_TRANSPORTBESCHEINIGUNG,
    dateiteile: (p, betrieb) => ['Transportbescheinigung', betrieb.betriebsnummer, p.beleg ?? p.id.slice(0, 8)],
    bki: p => ({ bericht: ['Transportbescheinigung', p.beleg ?? p.id.slice(0, 8)] }),
  }),

  transportbescheinigungen: definiereMeldung(KATALOG_VERKEHR.transportbescheinigungen, {
    parameter: sp => {
      const von = (sp.get('von') ?? '').trim()
      const bis = (sp.get('bis') ?? '').trim()
      if (!istDatum(von) || !istDatum(bis)) return parameterFehler('Zeitraum fehlt oder ist ungültig (Parameter von und bis im Format JJJJ-MM-TT).')
      if (von > bis) return parameterFehler('Der Zeitraum ist ungültig: „von“ liegt nach „bis“.')
      // nur=gespeichert: nur gespeicherte Transportbescheinigungen (wie der Filter der Druckseite)
      return { von, bis, nurGespeichert: sp.get('nur') === 'gespeichert' }
    },
    laden: (ctx, p) => ladeTransportbescheinigungen(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_TRANSPORTBESCHEINIGUNG,
    dateiteile: (p, betrieb) => ['Transportbescheinigungen', betrieb.betriebsnummer, `${p.von}_bis_${p.bis}`, p.nurGespeichert ? 'gespeichert' : null],
    bki: p => ({ bericht: ['Transportbescheinigungen', p.nurGespeichert ? 'gespeichert' : null], von: p.von, bis: p.bis }),
  }),

  pruefnummernantrag: definiereMeldung(KATALOG_VERKEHR.pruefnummernantrag, {
    parameter: sp => {
      const p = idParameter(sp, 'DAC-Antrag')
      return 'id' in p ? { id: p.id, bez: dateiParameter(sp, 'bez') } : p
    },
    laden: async (ctx, p) => {
      const r = await ladePruefnummernantrag(ctx.supabase, ctx.tenantId, { id: p.id })
      if (!r) throw new MeldungsFehler(404, 'DAC-Antrag nicht gefunden.')
      return { zeilen: r.zeilen, warnungen: r.warnungen }
    },
    spalten: SPALTEN_PRUEFNUMMERNANTRAG,
    dateiteile: (p, betrieb) => ['Prüfnummernantrag', betrieb.betriebsnummer, p.bez ?? p.id.slice(0, 8)],
  }),

  'dac-antraege': definiereMeldung(KATALOG_VERKEHR['dac-antraege'], {
    parameter: () => ({}),
    laden: ctx => ladeDacAntraege(ctx.supabase, ctx.tenantId),
    spalten: SPALTEN_DAC_ANTRAEGE,
    dateiteile: (_p, betrieb) => ['DAC-Anträge', betrieb.betriebsnummer],
  }),

  exportauftrag: definiereMeldung(KATALOG_VERKEHR.exportauftrag, {
    parameter: sp => {
      const p = idParameter(sp, 'Exportauftrag')
      return 'id' in p ? { id: p.id, referenz: dateiParameter(sp, 'referenz') } : p
    },
    laden: async (ctx, p) => {
      const r = await ladeExportauftrag(ctx.supabase, ctx.tenantId, { id: p.id })
      if (!r) throw new MeldungsFehler(404, 'Exportauftrag nicht gefunden.')
      return { zeilen: r.zeilen, warnungen: r.warnungen }
    },
    spalten: SPALTEN_EXPORTAUFTRAG,
    dateiteile: (p, betrieb) => ['Exportauftrag', betrieb.betriebsnummer, p.referenz ?? p.id.slice(0, 8)],
  }),

  // KAN-435 D1: Datenblatt zum Erfassen in EMCS (ersetzt die e-AD-XML-Datei)
  'emcs-datenblatt': definiereMeldung(KATALOG_VERKEHR['emcs-datenblatt'], {
    parameter: sp => {
      const p = idParameter(sp, 'Exportauftrag')
      return 'id' in p ? { id: p.id, referenz: dateiParameter(sp, 'referenz') } : p
    },
    laden: async (ctx, p) => {
      const r = await ladeEmcsDatenblatt(ctx.supabase, ctx.tenantId, { id: p.id })
      if (!r) throw new MeldungsFehler(404, 'Exportauftrag nicht gefunden.')
      return { zeilen: r.zeilen, warnungen: [...r.warnungen, ...r.fehlt] }
    },
    spalten: SPALTEN_EMCS_DATENBLATT,
    dateiteile: (p, betrieb) => ['EMCS-Datenblatt', betrieb.betriebsnummer, p.referenz ?? p.id.slice(0, 8)],
  }),

  // KAN-439: ?jahr=JJJJ, optional &zeitraum=Q1–Q4 bzw. 01–12 (ohne Zeitraum das ganze Jahr)
  'zusammenfassende-meldung': definiereMeldung(KATALOG_VERKEHR['zusammenfassende-meldung'], {
    parameter: sp => {
      const jahr = jahrAus(sp)
      if (istParameterFehler(jahr)) return jahr
      const zeitraum = uvaZeitraumAus(sp)
      if (istParameterFehler(zeitraum)) return zeitraum
      return { jahr, zeitraum }
    },
    laden: (ctx, p) => ladeZm(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_ZM,
    dateiteile: (p, betrieb) => ['Zusammenfassende-Meldung', betrieb.betriebsnummer, p.zeitraum ? `${p.jahr}-${p.zeitraum}` : p.jahr],
  }),

  exportauftraege: definiereMeldung(KATALOG_VERKEHR.exportauftraege, {
    parameter: () => ({}),
    laden: ctx => ladeExportauftraege(ctx.supabase, ctx.tenantId),
    spalten: SPALTEN_EXPORTAUFTRAEGE,
    dateiteile: (_p, betrieb) => ['Exportaufträge', betrieb.betriebsnummer],
  }),
} satisfies MeldungenZu<typeof KATALOG_VERKEHR>
