import 'server-only'
import { definiereMeldung, istParameterFehler, parameterFehler, type MeldungenZu, type ParameterFehler } from '../typen'
import { KATALOG_PFLANZENSCHUTZ } from '../katalog/pflanzenschutz'
import {
  ART_LABEL, artAus, jahrAus, ladePsmAufzeichnung, ladePsmMittelverbrauch, riedFilterAus,
  SPALTEN_PSM_AUFZEICHNUNG, SPALTEN_PSM_MITTELVERBRAUCH, type PsmAufzeichnungParameter,
} from '../psm'
import { ladeCuBilanz, SPALTEN_CU_BEHANDLUNGEN, SPALTEN_CU_BILANZ, type CuBilanzParameter } from '../cu'
import { ladeNaehrstoffbilanz, SPALTEN_NAEHRSTOFFBILANZ } from '../naehrstoff'
import { MeldungsFehler } from '../typen'
import { jahrgangOptional, uuidOptional } from '../kellerbuch-hilfen'
import { einstiegFehler, ladeRvWeingarten, rvZeilen, SPALTEN_RV_WEINGARTEN, type RvEinstieg } from '../rv-weingarten'

// Register der Behördenmeldungen – Gruppe „Pflanzenschutz & Düngung“ (Pflanzenschutz-Aufzeichnungen,
// Mittelverbrauch, Kupfer-Bilanz, Nährstoffbilanz). Parameter 1:1 wie die searchParams der Druckseiten:
//   ?jahr=2026            Jahr; leer oder „all“ = alle Jahre (Berichte-Tab „Alle Jahre“)
//   ?art=spritzung        nur psm-aufzeichnung: Maßnahmenart (leer = alle)
//   ?ried=<lage-id>|_none nur psm-aufzeichnung: Ried-Filter wie im Berichte-Tab „Ried“
// Ladefunktionen = dieselben wie auf den Druckseiten (lib/behoerden/psm.ts, cu.ts, naehrstoff.ts).

function jahrParameter(sp: URLSearchParams): { jahr: number | null } | ParameterFehler {
  const jahr = jahrAus(sp.get('jahr'))
  return jahr === undefined ? parameterFehler('Jahr ist ungültig (vierstellig, z. B. 2026).') : { jahr }
}

function jahrTeil(jahr: number | null): string | number {
  return jahr ?? 'alle-Jahre'
}

export const MELDUNGEN_PFLANZENSCHUTZ = {
  'psm-aufzeichnung': definiereMeldung(KATALOG_PFLANZENSCHUTZ['psm-aufzeichnung'], {
    parameter: (sp): PsmAufzeichnungParameter | ParameterFehler => {
      const j = jahrParameter(sp)
      if (istParameterFehler(j)) return j
      const art = artAus(sp.get('art'))
      if (art === undefined) return parameterFehler(`Unbekannte Maßnahmenart – erlaubt: ${Object.keys(ART_LABEL).join(', ')}.`)
      const ried = riedFilterAus(sp.get('ried'))
      if (ried === undefined) return parameterFehler('Ried-Filter ist ungültig.')
      return { jahr: j.jahr, art, ried }
    },
    laden: (ctx, p) => ladePsmAufzeichnung(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_PSM_AUFZEICHNUNG,
    dateiteile: (p, betrieb) => ['Pflanzenschutz-Aufzeichnung', betrieb.betriebsnummer, jahrTeil(p.jahr), p.art ? ART_LABEL[p.art] : null],
  }),

  'psm-mittelverbrauch': definiereMeldung(KATALOG_PFLANZENSCHUTZ['psm-mittelverbrauch'], {
    parameter: jahrParameter,
    laden: (ctx, p) => ladePsmMittelverbrauch(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_PSM_MITTELVERBRAUCH,
    dateiteile: (p, betrieb) => ['PSM-Mittelverbrauch', betrieb.betriebsnummer, jahrTeil(p.jahr)],
  }),

  'cu-bilanz': definiereMeldung(KATALOG_PFLANZENSCHUTZ['cu-bilanz'], {
    parameter: (sp): CuBilanzParameter | ParameterFehler => jahrParameter(sp),
    laden: (ctx, p) => ladeCuBilanz(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_CU_BILANZ,
    dateiteile: (p, betrieb) => ['Kupfer-Bilanz', betrieb.betriebsnummer, jahrTeil(p.jahr)],
  }),

  'cu-bilanz-behandlungen': definiereMeldung(KATALOG_PFLANZENSCHUTZ['cu-bilanz-behandlungen'], {
    parameter: (sp): CuBilanzParameter | ParameterFehler => jahrParameter(sp),
    laden: async (ctx, p) => {
      const e = await ladeCuBilanz(ctx.supabase, ctx.tenantId, p)
      return { zeilen: e.behandlungsZeilen, warnungen: e.warnungen }
    },
    spalten: SPALTEN_CU_BEHANDLUNGEN,
    dateiteile: (p, betrieb) => ['Kupfer-Bilanz-Behandlungen', betrieb.betriebsnummer, jahrTeil(p.jahr)],
  }),

  naehrstoffbilanz: definiereMeldung(KATALOG_PFLANZENSCHUTZ.naehrstoffbilanz, {
    parameter: jahrParameter,
    laden: (ctx, p) => ladeNaehrstoffbilanz(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_NAEHRSTOFFBILANZ,
    dateiteile: (p, betrieb) => ['Nährstoffbilanz', betrieb.betriebsnummer, jahrTeil(p.jahr)],
  }),

  // KAN-108: Parameter wie die Seite /weingarten/rueckverfolgung (lese | charge | fuellung | jahrgang [+ gst | weingarten] | gst)
  'rueckverfolgung-weingarten': definiereMeldung(KATALOG_PFLANZENSCHUTZ['rueckverfolgung-weingarten'], {
    parameter: (sp): (RvEinstieg & { anzeige: { titel: string | null } }) | ParameterFehler => {
      const e: Partial<RvEinstieg> = {}
      for (const [k, name] of [['lese', 'Lese'], ['charge', 'Charge'], ['fuellung', 'Füllung'], ['gst', 'Grundstück'], ['weingarten', 'Weingarten']] as const) {
        const v = uuidOptional(sp, k, name)
        if (istParameterFehler(v)) return v
        e[k] = v
      }
      const jahrgang = jahrgangOptional(sp)
      if (istParameterFehler(jahrgang)) return jahrgang
      const einstieg = { ...e, jahrgang } as RvEinstieg
      const fehler = einstiegFehler(einstieg)
      return fehler ? parameterFehler(fehler) : { ...einstieg, anzeige: { titel: null } }
    },
    laden: async (ctx, p) => {
      const r = await ladeRvWeingarten(ctx.supabase, ctx.tenantId, p)
      if (!r) throw new MeldungsFehler(404, 'Lese, Charge oder Füllung nicht gefunden.')
      p.anzeige.titel = r.titel
      return { zeilen: rvZeilen(r.lesen), warnungen: r.warnungen }
    },
    spalten: SPALTEN_RV_WEINGARTEN,
    dateiteile: (p, betrieb) => ['Rückverfolgung-Weingarten', betrieb.betriebsnummer, p.anzeige.titel ?? p.jahrgang],
  }),
} satisfies MeldungenZu<typeof KATALOG_PFLANZENSCHUTZ>
