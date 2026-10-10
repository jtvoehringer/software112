import 'server-only'
import { definiereMeldung, istParameterFehler, MeldungsFehler, parameterFehler, type MeldungenZu } from '../typen'
import { KATALOG_KELLERBUCH } from '../katalog/kellerbuch'
import { jahrgangOptional, textOptional, uuidAus, uuidOptional, zeitraumAus, zeitraumTeil, type Zeitraum } from '../kellerbuch-hilfen'
import { bewegungsbuchZeilen, ladeBewegungsbuch, SPALTEN_BEWEGUNGSBUCH } from '../bewegungsbuch'
import { ladeKellerBehandlungen, SPALTEN_KELLER_BEHANDLUNGEN } from '../keller-behandlungen'
import { ladeGebindeverzeichnis, SPALTEN_GEBINDEVERZEICHNIS } from '../gebindeverzeichnis'
import { ladeWeinbuch, ladeWeinbuchSammlung, SPALTEN_WEINBUCH } from '../weinbuch'
import { ladeRueckverfolgung, SPALTEN_RUECKVERFOLGUNG } from '../rueckverfolgung'
import { ladeBesondereKonten, SPALTEN_BESONDERE_KONTEN } from '../besondereKonten'
import { ladeRueckruf, SPALTEN_RUECKRUF, type RueckrufStart } from '../rueckruf'
import { ladeBlendProtokoll, SPALTEN_BLEND, type BlendArt } from '../blend'
import { ladeKellerUmzuege, SPALTEN_KELLER_UMZUEGE } from '../keller-auswertungen'
import { ladeAenderungsprotokoll, SPALTEN_AENDERUNGSPROTOKOLL } from '../aenderungsprotokoll'
import { ladeLagerbewegungen, ladeLagerstand, lagerstandStichtag, SPALTEN_LAGERBEWEGUNGEN, SPALTEN_LAGERSTAND } from '../lagerstand'
import { ladeBetriebsdaten, ladeBkiGebindeverzeichnis, SPALTEN_BETRIEBSDATEN, SPALTEN_BKI_GEBINDE } from '../bki-stammdaten'
import { ladeBkiWeingaerten, SPALTEN_BKI_WEINGAERTEN } from '../bki-weingaerten'
import { buchungsartZeilen, erzeugnisZeilen, KATALOG_HINWEIS, qualitaetsstufenZeilen, SPALTEN_BKI_KATALOG } from '../bki-kataloge'

// Register der Behördenmeldungen – Gruppe „Kellerbuch“ (24.09.2026).
// Je Katalog-Eintrag aus katalog/kellerbuch.ts genau ein Eintrag mit CSV (laden + spalten).
// Die Parameter entsprechen den searchParams der jeweiligen Seite (Gebinde, Charge,
// Füllung, Zeitraum von/bis, Filter). Den Namen für den Dateinamen (Gebinde, Charge,
// Füllung) kennt erst die Ladefunktion: sie legt ihn in p.anzeige ab – die Route ruft
// dateiteile() nach laden() auf.

type Anzeige = { anzeige: { name: string | null } }
const anzeige = (): Anzeige['anzeige'] => ({ name: null })

export const MELDUNGEN_KELLERBUCH = {
  bewegungsbuch: definiereMeldung<{ behaelterId: string } & Zeitraum & Anzeige, ReturnType<typeof bewegungsbuchZeilen>[number]>(KATALOG_KELLERBUCH.bewegungsbuch, {
    parameter: sp => {
      const behaelterId = uuidAus(sp, 'behaelter', 'Gebinde')
      if (istParameterFehler(behaelterId)) return behaelterId
      const z = zeitraumAus(sp)
      if (istParameterFehler(z)) return z
      return { behaelterId, ...z, anzeige: anzeige() }
    },
    laden: async (ctx, p) => {
      const bb = await ladeBewegungsbuch(ctx.supabase, ctx.tenantId, p)
      if (!bb) throw new MeldungsFehler(404, 'Gebinde nicht gefunden.')
      p.anzeige.name = bb.behaelter.name
      return { zeilen: bewegungsbuchZeilen(bb), warnungen: bb.warnungen }
    },
    spalten: SPALTEN_BEWEGUNGSBUCH,
    dateiteile: (p, betrieb) => ['Bewegungsbuch', betrieb.betriebsnummer, p.anzeige.name, zeitraumTeil(p)],
    bki: p => ({ bericht: ['Bewegungsbuch', p.anzeige.name], von: p.von, bis: p.bis }),
  }),

  // je Gebinde (Pflicht-Parameter behaelter) – jedes Mitglied, wie die Gebinde-Seite
  'keller-behandlungen': definiereMeldung(KATALOG_KELLERBUCH['keller-behandlungen'], {
    parameter: sp => {
      const behaelterId = uuidAus(sp, 'behaelter', 'Gebinde')
      if (istParameterFehler(behaelterId)) return behaelterId
      const z = zeitraumAus(sp)
      if (istParameterFehler(z)) return z
      return { behaelterId, ...z, anzeige: anzeige() } as { behaelterId: string } & Zeitraum & Anzeige
    },
    laden: async (ctx, p) => {
      const kb = await ladeKellerBehandlungen(ctx.supabase, ctx.tenantId, p)
      if (!kb) throw new MeldungsFehler(404, 'Gebinde nicht gefunden.')
      p.anzeige.name = kb.gebinde?.name ?? null
      return { zeilen: kb.zeilen, warnungen: kb.warnungen }
    },
    spalten: SPALTEN_KELLER_BEHANDLUNGEN,
    dateiteile: (p, betrieb) => ['Kellerbehandlungen', betrieb.betriebsnummer, p.anzeige.name, zeitraumTeil(p)],
    bki: p => ({ bericht: ['Kellerbehandlungen', p.anzeige.name], von: p.von, bis: p.bis }),
  }),

  // alle Gebinde im Zeitraum – Modul Controlling + Auswertungsrecht (/reports/keller)
  'keller-behandlungen-alle': definiereMeldung(KATALOG_KELLERBUCH['keller-behandlungen-alle'], {
    parameter: sp => zeitraumAus(sp),
    laden: async (ctx, p) => {
      const kb = await ladeKellerBehandlungen(ctx.supabase, ctx.tenantId, { behaelterId: null, von: p.von, bis: p.bis })
      return { zeilen: kb?.zeilen ?? [], warnungen: kb?.warnungen ?? [] }
    },
    spalten: SPALTEN_KELLER_BEHANDLUNGEN,
    dateiteile: (p, betrieb) => ['Kellerbehandlungen', betrieb.betriebsnummer, 'alle-Gebinde', zeitraumTeil(p)],
    bki: p => ({ bericht: ['Kellerbehandlungen', 'alle-Gebinde'], von: p.von, bis: p.bis }),
  }),

  gebindeverzeichnis: definiereMeldung(KATALOG_KELLERBUCH.gebindeverzeichnis, {
    parameter: sp => {
      const aktiv = sp.get('aktiv')?.trim() ?? ''
      if (aktiv && aktiv !== '1' && aktiv !== '0') return parameterFehler('Parameter „aktiv“ nur 1 oder 0.')
      return { nurAktiv: aktiv === '1' }
    },
    laden: async (ctx, p) => {
      const g = await ladeGebindeverzeichnis(ctx.supabase, ctx.tenantId, p)
      return { zeilen: g.zeilen, warnungen: g.warnungen }
    },
    spalten: SPALTEN_GEBINDEVERZEICHNIS,
    dateiteile: (p, betrieb) => ['Gebindeverzeichnis', betrieb.betriebsnummer, p.nurAktiv ? 'aktive' : null],
    bki: p => ({ bericht: ['Gebindeverzeichnis', p.nurAktiv ? 'aktive' : null] }),
  }),

  weinbuch: definiereMeldung(KATALOG_KELLERBUCH.weinbuch, {
    parameter: sp => {
      const chargeId = uuidAus(sp, 'charge', 'Charge')
      if (istParameterFehler(chargeId)) return chargeId
      return { chargeId, anzeige: anzeige() } as { chargeId: string } & Anzeige
    },
    laden: async (ctx, p) => {
      const wb = await ladeWeinbuch(ctx.supabase, ctx.tenantId, p)
      if (!wb) throw new MeldungsFehler(404, 'Charge nicht gefunden.')
      p.anzeige.name = wb.weinbuch.wa.name
      return { zeilen: wb.zeilen, warnungen: wb.warnungen }
    },
    spalten: SPALTEN_WEINBUCH,
    dateiteile: (p, betrieb) => ['Weinbuch', betrieb.betriebsnummer, p.anzeige.name],
    bki: p => ({ bericht: ['Weinbuch', p.anzeige.name] }),
  }),

  'weinbuch-sammlung': definiereMeldung(KATALOG_KELLERBUCH['weinbuch-sammlung'], {
    parameter: sp => {
      const jahrgang = jahrgangOptional(sp)
      if (istParameterFehler(jahrgang)) return jahrgang
      const sorte = textOptional(sp, 'sorte')
      if (istParameterFehler(sorte)) return sorte
      const bezeichnung = textOptional(sp, 'bezeichnung')
      if (istParameterFehler(bezeichnung)) return bezeichnung
      return { jahrgang, sorte, bezeichnung }
    },
    laden: async (ctx, p) => {
      const s = await ladeWeinbuchSammlung(ctx.supabase, ctx.tenantId, p)
      return { zeilen: s.zeilen, warnungen: s.warnungen }
    },
    spalten: SPALTEN_WEINBUCH,
    dateiteile: (p, betrieb) => ['Weinbuch-Sammlung', betrieb.betriebsnummer, p.jahrgang, p.sorte, p.bezeichnung],
    bki: p => ({ bericht: ['Weinbuch-Sammlung', p.jahrgang, p.sorte, p.bezeichnung] }),
  }),

  rueckverfolgung: definiereMeldung(KATALOG_KELLERBUCH.rueckverfolgung, {
    parameter: sp => {
      const fuellungId = uuidOptional(sp, 'fuellung_id', 'Füllung')
      if (istParameterFehler(fuellungId)) return fuellungId
      const jahrgang = jahrgangOptional(sp)
      if (istParameterFehler(jahrgang)) return jahrgang
      const sorte = textOptional(sp, 'sorte')
      if (istParameterFehler(sorte)) return sorte
      const bezeichnung = textOptional(sp, 'bezeichnung')
      if (istParameterFehler(bezeichnung)) return bezeichnung
      return { fuellungId, jahrgang, sorte, bezeichnung, anzeige: anzeige() } as {
        fuellungId: string | null; jahrgang: number | null; sorte: string | null; bezeichnung: string | null
      } & Anzeige
    },
    laden: async (ctx, p) => {
      const r = await ladeRueckverfolgung(ctx.supabase, ctx.tenantId, p)
      if (!r) throw new MeldungsFehler(404, 'Füllung nicht gefunden.')
      p.anzeige.name = r.fuellung ? (r.fuellung.chargennummer ?? r.fuellung.name ?? null) : null
      return { zeilen: r.zeilen, warnungen: r.warnungen }
    },
    spalten: SPALTEN_RUECKVERFOLGUNG,
    dateiteile: (p, betrieb) => p.fuellungId
      ? ['Rückverfolgung', betrieb.betriebsnummer, p.anzeige.name]
      : ['Rückverfolgung', betrieb.betriebsnummer, p.jahrgang, p.sorte, p.bezeichnung],
    bki: p => ({ bericht: p.fuellungId ? ['Rückverfolgung', p.anzeige.name] : ['Rückverfolgung', p.jahrgang, p.sorte, p.bezeichnung] }),
  }),

  // KAN-107: Weinwirtschaftsjahr ab dem 01.08. des Jahres „jahr“
  'besondere-konten': definiereMeldung(KATALOG_KELLERBUCH['besondere-konten'], {
    parameter: sp => {
      const j = (sp.get('jahr') ?? '').trim()
      if (!/^\d{4}$/.test(j)) return parameterFehler('Bitte das Weinwirtschaftsjahr angeben (jahr=JJJJ, Beginn 01.08.).')
      return { jahr: Number(j) }
    },
    laden: async (ctx, p) => ladeBesondereKonten(ctx.supabase, ctx.tenantId, p.jahr),
    spalten: SPALTEN_BESONDERE_KONTEN,
    dateiteile: (p, betrieb) => ['Besondere Konten', betrieb.betriebsnummer, `${p.jahr}-${String((p.jahr + 1) % 100).padStart(2, '0')}`],
    bki: p => ({ bericht: ['Besondere Konten', `${p.jahr}/${String((p.jahr + 1) % 100).padStart(2, '0')}`] }),
  }),

  // KAN-109: genau ein Startpunkt (fuellung | charge | pressung) – wie die Seite /kellerbuch/rueckverfolgung/vorwaerts
  'rueckverfolgung-vorwaerts': definiereMeldung(KATALOG_KELLERBUCH['rueckverfolgung-vorwaerts'], {
    parameter: sp => {
      const fuellung = uuidOptional(sp, 'fuellung', 'Füllung')
      if (istParameterFehler(fuellung)) return fuellung
      const charge = uuidOptional(sp, 'charge', 'Charge')
      if (istParameterFehler(charge)) return charge
      const pressung = uuidOptional(sp, 'pressung', 'Pressung')
      if (istParameterFehler(pressung)) return pressung
      if ((fuellung ? 1 : 0) + (charge ? 1 : 0) + (pressung ? 1 : 0) !== 1) return parameterFehler('Bitte genau einen Startpunkt angeben: Füllung (fuellung), Charge (charge) oder Pressung (pressung).')
      const start: RueckrufStart = fuellung ? { art: 'fuellung', id: fuellung } : charge ? { art: 'charge', id: charge } : { art: 'pressung', id: pressung as string }
      return { start, anzeige: anzeige() } as { start: RueckrufStart } & Anzeige
    },
    laden: async (ctx, p) => {
      const r = await ladeRueckruf(ctx.supabase, ctx.tenantId, p.start)
      if (!r) throw new MeldungsFehler(404, 'Startpunkt nicht gefunden.')
      p.anzeige.name = r.start.name
      return { zeilen: r.zeilen, warnungen: r.warnungen }
    },
    spalten: SPALTEN_RUECKRUF,
    dateiteile: (p, betrieb) => ['Rückruf-Liste', betrieb.betriebsnummer, p.anzeige.name],
  }),

  'blend-protokoll': definiereMeldung(KATALOG_KELLERBUCH['blend-protokoll'], {
    parameter: sp => {
      const fuellung = uuidOptional(sp, 'fuellung', 'Füllung')
      if (istParameterFehler(fuellung)) return fuellung
      const charge = uuidOptional(sp, 'charge', 'Charge')
      if (istParameterFehler(charge)) return charge
      if ((fuellung ? 1 : 0) + (charge ? 1 : 0) !== 1) return parameterFehler('Bitte genau eine Füllung (fuellung) oder eine Charge (charge) angeben.')
      // KAN-76: Charge optional zu einem Stichtag (JJJJ-MM-TT)
      const st = sp.get('stichtag')?.trim() || null
      if (st && (!/^\d{4}-\d{2}-\d{2}$/.test(st) || Number.isNaN(Date.parse(st)))) return parameterFehler('Stichtag bitte als JJJJ-MM-TT angeben.')
      if (st && fuellung) return parameterFehler('Ein Stichtag gilt nur für eine Charge – die Füllung zeigt immer die Zusammensetzung bei der Abfüllung.')
      const art: BlendArt = fuellung ? 'fuellung' : 'charge'
      return { art, id: (fuellung ?? charge) as string, stichtag: st, anzeige: anzeige() } as { art: BlendArt; id: string; stichtag: string | null } & Anzeige
    },
    laden: async (ctx, p) => {
      const b = await ladeBlendProtokoll(ctx.supabase, ctx.tenantId, p)
      if (!b) throw new MeldungsFehler(404, p.art === 'fuellung' ? 'Füllung nicht gefunden.' : 'Charge nicht gefunden.')
      // KAN-72: keine Prüfnummer im Dateinamen – eine Datei „…_N 10716-26_…“ sah amtlich
      // bestätigt aus, auch wenn die Nummer für den Bestand nicht (mehr) galt
      p.anzeige.name = b.kopf.chargennummer ?? b.kopf.name
      return { zeilen: b.zeilen, warnungen: b.warnungen }
    },
    spalten: SPALTEN_BLEND,
    dateiteile: (p, betrieb) => ['Blend-Protokoll', betrieb.betriebsnummer, p.anzeige.name, (p as { stichtag?: string | null }).stichtag ?? null],
    bki: p => ({ bericht: ['Blend-Protokoll', p.anzeige.name, p.stichtag ? `Stand-${p.stichtag.replace(/-/g, '')}` : null] }),
  }),

  // KAN-44 Teil 1: BKI-Schnittstelle aus dem Bewegungsjournal
  'bki-lagerstand': definiereMeldung(KATALOG_KELLERBUCH['bki-lagerstand'], {
    parameter: sp => lagerstandStichtag(sp),
    laden: async (ctx, p) => {
      const l = await ladeLagerstand(ctx.supabase, ctx.tenantId, p)
      return { zeilen: l.zeilen, warnungen: l.warnungen }
    },
    spalten: SPALTEN_LAGERSTAND,
    dateiteile: (p, betrieb) => ['Lagerstand', betrieb.betriebsnummer, p.stichtag.replace(/-/g, '')],
    bki: p => ({ bericht: ['Lagerstand', `Stand-${p.stichtag.replace(/-/g, '')}`] }),
  }),

  'bki-lagerbewegungen': definiereMeldung(KATALOG_KELLERBUCH['bki-lagerbewegungen'], {
    parameter: sp => zeitraumAus(sp),
    laden: (ctx, p) => ladeLagerbewegungen(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_LAGERBEWEGUNGEN,
    dateiteile: (p, betrieb) => ['Lagerbewegungen', betrieb.betriebsnummer, zeitraumTeil(p)],
    bki: p => ({ bericht: 'Lagerbewegungen', von: p.von, bis: p.bis }),
  }),

  'bki-betriebsdaten': definiereMeldung(KATALOG_KELLERBUCH['bki-betriebsdaten'], {
    parameter: () => ({}),
    laden: (ctx) => ladeBetriebsdaten(ctx.supabase, ctx.tenantId),
    spalten: SPALTEN_BETRIEBSDATEN,
    dateiteile: (_p, betrieb) => ['Betriebsdaten', betrieb.betriebsnummer],
    bki: () => ({ bericht: 'Betriebsdaten' }),
  }),

  'bki-gebindeverzeichnis': definiereMeldung(KATALOG_KELLERBUCH['bki-gebindeverzeichnis'], {
    parameter: sp => {
      const aktiv = sp.get('aktiv')?.trim() ?? ''
      if (aktiv && aktiv !== '1' && aktiv !== '0') return parameterFehler('Parameter „aktiv“ nur 1 oder 0.')
      return { nurAktiv: aktiv === '1' }
    },
    laden: (ctx, p) => ladeBkiGebindeverzeichnis(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_BKI_GEBINDE,
    dateiteile: (p, betrieb) => ['GebindeVerzeichnis', betrieb.betriebsnummer, p.nurAktiv ? 'aktive' : null],
    bki: p => ({ bericht: ['GebindeVerzeichnis', p.nurAktiv ? 'aktive' : null] }),
  }),

  'bki-weingaerten': definiereMeldung(KATALOG_KELLERBUCH['bki-weingaerten'], {
    parameter: sp => {
      const aktiv = sp.get('aktiv')?.trim() ?? ''
      if (aktiv && aktiv !== '1' && aktiv !== '0') return parameterFehler('Parameter „aktiv“ nur 1 oder 0.')
      return { nurAktiv: aktiv === '1' }
    },
    laden: (ctx, p) => ladeBkiWeingaerten(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_BKI_WEINGAERTEN,
    dateiteile: (p, betrieb) => ['Weingaerten', betrieb.betriebsnummer, p.nurAktiv ? 'aktive' : null],
    bki: p => ({ bericht: ['Weingaerten', p.nurAktiv ? 'aktive' : null] }),
  }),

  // KAN-50: Katalogblätter
  'bki-qualitaetsstufen': definiereMeldung(KATALOG_KELLERBUCH['bki-qualitaetsstufen'], {
    parameter: () => ({}),
    laden: async () => ({ zeilen: qualitaetsstufenZeilen(), warnungen: [KATALOG_HINWEIS] }),
    spalten: SPALTEN_BKI_KATALOG,
    dateiteile: (_p, betrieb) => ['Qualitaetsstufen', betrieb.betriebsnummer],
    bki: () => ({ bericht: 'Qualitaetsstufen' }),
  }),

  'bki-erzeugnisse': definiereMeldung(KATALOG_KELLERBUCH['bki-erzeugnisse'], {
    parameter: () => ({}),
    laden: async () => ({ zeilen: erzeugnisZeilen(), warnungen: [KATALOG_HINWEIS] }),
    spalten: SPALTEN_BKI_KATALOG,
    dateiteile: (_p, betrieb) => ['Erzeugnisse', betrieb.betriebsnummer],
    bki: () => ({ bericht: 'Erzeugnisse' }),
  }),

  'bki-buchungsarten': definiereMeldung(KATALOG_KELLERBUCH['bki-buchungsarten'], {
    parameter: () => ({}),
    laden: async () => ({ zeilen: buchungsartZeilen(), warnungen: [KATALOG_HINWEIS] }),
    spalten: SPALTEN_BKI_KATALOG,
    dateiteile: (_p, betrieb) => ['Buchungsarten', betrieb.betriebsnummer],
    bki: () => ({ bericht: 'Buchungsarten' }),
  }),

  'keller-auswertungen': definiereMeldung(KATALOG_KELLERBUCH['keller-auswertungen'], {
    parameter: sp => zeitraumAus(sp),
    laden: (ctx, p) => ladeKellerUmzuege(ctx.supabase, ctx.tenantId, p),
    spalten: SPALTEN_KELLER_UMZUEGE,
    dateiteile: (p, betrieb) => ['Keller-Umzüge', betrieb.betriebsnummer, zeitraumTeil(p)],
    bki: p => ({ bericht: 'Keller-Umzüge', von: p.von, bis: p.bis }),
  }),

  aenderungsprotokoll: definiereMeldung(KATALOG_KELLERBUCH.aenderungsprotokoll, {
    parameter: sp => zeitraumAus(sp),
    laden: (ctx, p) => ladeAenderungsprotokoll(ctx.supabase, ctx.tenantId, ctx.membership, p),
    spalten: SPALTEN_AENDERUNGSPROTOKOLL,
    dateiteile: (p, betrieb) => ['Änderungsprotokoll', betrieb.betriebsnummer, zeitraumTeil(p)],
    bki: p => ({ bericht: 'Änderungsprotokoll', von: p.von, bis: p.bis }),
  }),
} satisfies MeldungenZu<typeof KATALOG_KELLERBUCH>
