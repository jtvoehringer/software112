# Stripe-Einrichtung – offene Checkliste (Stand 11.11.2026)

**Status: Produktion läuft gegen die Stripe-Sandbox, Live-Konto noch offen.** Der Code für das Paketmodell
Basis / Standard / Premium ist fertig und deployt (Definition in `src/lib/pakete.ts`). In der Sandbox
„IC&P Consultants eU Sandbox“ gibt es die drei Produkte (199/299/399 EUR monatlich, ohne Testzeitraum); ihre
Preis-IDs stehen seit 11.11.2026 als `NEXT_PUBLIC_STRIPE_PRICE_BASIS/_STANDARD/_PREMIUM` in Vercel (Production),
`/signup` zeigt alle drei Pakete. Die Umstellung auf das Live-Konto (Abschnitt 7) erfolgt
**spätestens vor dem ersten zahlenden Kunden.** Bis dahin:

- Wer sich registriert, bekommt ein Test-Abo ohne echte Zahlung und wird trotzdem freigeschaltet.
- Pakete ohne Preis-ID werden nicht angeboten (kein Fehler) – fehlt eine der drei Variablen, fehlt die Paketkarte.
- **Umsatzsteuer (KAN-450, Schritt 2c):** Ohne die Variable `STRIPE_TAX_RATE_UST` brechen Checkout, Paketwechsel und
  die Buchung des Premium-Supports mit einer Meldung ab – es wird nie ohne Umsatzsteuer abgerechnet.
- `STRIPE_PRICE_PREMIUM_SUPPORT` (Schritt 2b) ist in Vercel noch nicht angelegt – der Knopf „Premium-Support buchen“
  bleibt ausgeblendet.
- Bestehende Mandanten (Sandbox, Gebeshuber, …) laufen ohne Stripe weiter:
  `max_benutzer` = NULL (unbegrenzt), Module bleiben wie manuell geschaltet.
- Der Webhook empfängt noch die alten Preis-IDs (`…_PROFESSIONAL` usw.) und bildet
  sie auf Standard/Premium ab.

## Checkliste (in dieser Reihenfolge)

### 1. Stripe-Konto / Umgebung klären
- Live-Konto oder Sandbox? Preis-IDs und Secret Key müssen aus **derselben**
  Umgebung stammen. In Vercel nachsehen: `STRIPE_SECRET_KEY` beginnt mit `sk_live_`
  (→ Produkte im Live-Konto anlegen) oder `sk_test_` (→ in genau dieser Sandbox).
- Empfehlung: Live-IDs für Vercel-Umgebung *Production*, Sandbox-IDs für
  *Preview/Development* (Vercel erlaubt Variablen pro Umgebung).

### 2. Produkte anlegen – Stripe → Produktkatalog → „+ Produkt hinzufügen"
| Produkt | Preis | Intervall | Vercel-Variable |
|---|---|---|---|
| software:112 Basis | 199,00 EUR | monatlich, wiederkehrend | `NEXT_PUBLIC_STRIPE_PRICE_BASIS` |
| software:112 Standard | 299,00 EUR | monatlich, wiederkehrend | `NEXT_PUBLIC_STRIPE_PRICE_STANDARD` |
| software:112 Premium | 399,00 EUR | monatlich, wiederkehrend | `NEXT_PUBLIC_STRIPE_PRICE_PREMIUM` |

Nach dem Speichern im Produkt unter „Preise" die **Preis-ID** (`price_…`) kopieren.

### 2c. Umsatzsteuer: fester Steuersatz 20 % (KAN-450, Entscheidung Jörgen 13.11.2026)
Die Preise in Schritt 2 und 2b sind **Nettopreise**. Die Umsatzsteuer kommt über einen festen Steuersatz dazu
(kein Stripe Tax, solange alle Kunden österreichische Betriebe sind).

- Stripe → Produktkatalog → **Steuersätze** → „Steuersatz hinzufügen“: Typ USt/VAT, Region Österreich, Satz **20 %**,
  Steuer **exklusive** (wird auf den Preis aufgeschlagen), Anzeigename „USt“. Es entsteht eine ID `txr_…`.
- ID → Vercel `STRIPE_TAX_RATE_UST` (serverseitig, kein `NEXT_PUBLIC_`), **je Umgebung aus demselben Stripe-Konto**
  wie Schlüssel und Preise (Sandbox-ID zur Sandbox, Live-ID zum Live-Konto). Danach Redeploy.
- Wirkung im Programm (`src/lib/abo/steuer.ts`): Der Checkout hinterlegt den Satz am Abo (`default_tax_rates`) – er gilt
  für alle Positionen (Paket, Zusatzmandant, Premium-Support) und alle Folgerechnungen. Der Checkout verlangt die
  Rechnungsadresse und fragt die **UID** des Kunden ab; sie steht dann auf jeder Rechnung.
- Abos aus der Zeit davor haben keinen Steuersatz: Das Programm zieht ihn beim nächsten Paketwechsel bzw. bei der
  Buchung des Premium-Supports nach. Bis dahin im Dashboard prüfen (Abonnement → „Abonnement aktualisieren“ →
  Steuersatz „USt 20 %“) – sonst weist die nächste Rechnung keine Umsatzsteuer aus.
- Gutschein „Early Mover“ (Abschnitt 8): Der Nachlass mindert den Nettobetrag, die Umsatzsteuer rechnet Stripe vom
  verminderten Betrag.

**Rechnung und Versand (einmal je Konto einstellen)**
- **Rechnungsvorlage**: Stripe → Einstellungen → Unternehmen bzw. Rechnungen: Firmenname, Adresse und eigene **UID**
  (Steuer-ID des Kontos, „auf Rechnungen anzeigen“), Fußzeile nach Bedarf.
- **Kunden-E-Mails**: Stripe → Einstellungen → Abrechnung → Kunden-E-Mails: „Rechnungen und Belege bei erfolgreicher
  Zahlung senden“ einschalten – sonst bekommt der Kunde keine Rechnung per E-Mail.
- **Rechnungsverlauf** im Kundenportal: Stripe → Einstellungen → Abrechnung → Kundenportal: „Rechnungsverlauf“
  aktivieren. Der Betrieb erreicht das Portal über „Abo & Zahlung“ → „Zahlungsdaten verwalten“; eine eigene
  Rechnungsliste in software:112 gibt es nicht.

**Prüfung im Testmodus:** Paket buchen → die Bezahlseite zeigt z. B. 399,00 € + 79,80 € USt = 478,80 € und das Feld
für die UID; die Rechnung im Kundenportal weist 20 % USt und die UID aus.

### 3. Webhook – Stripe → Entwickler → Webhooks / Event-Ziele → „Ereignisziel erstellen"
- Bereich „Ihr Konto", Zieltyp **Webhook-Endpoint**
- URL: `https://software112.icp-consultants.at/api/stripe/webhook`
- Genau diese Ereignisse (Vorauswahl „Account Link" abwählen):
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
- Signing Secret (`whsec_…`) → Vercel `STRIPE_WEBHOOK_SECRET` (je Umgebung passend)
- Ohne passenden Webhook kommen Paketwechsel nie bei den Modul-Flags an.
- Seit KAN-5 lädt der Webhook bei jedem Abo- und Rechnungsereignis das Abo frisch von Stripe
  (`subscriptions.retrieve`) und schreibt dessen Status nur, wenn die Abo-ID zum Betrieb passt
  (`src/lib/abo/stripeAbgleich.ts`). Scheitert etwas, antwortet er 500 – Stripe stellt dann
  erneut zu; im Stripe-Dashboard unter dem Ereignisziel auf fehlgeschlagene Zustellungen achten.

### 3a. Mahnwesen – Stripe → Einstellungen → Billing → Revenue Recovery (Pflicht, KAN-5)
- „Wiederholungsversuche“ (Smart Retries) aktiv lassen.
- **„Abo-Status, wenn alle Wiederholungsversuche fehlschlagen“: „Abonnement als unbezahlt
  markieren“ (unpaid) oder „Abonnement kündigen“ (canceled)** – NICHT „Abonnement überfällig
  lassen“. software:112 sperrt erst bei `unpaid`/`canceled` (Nur-Lesen-Modus); `past_due`
  zeigt nur eine Warnleiste. Mit „überfällig lassen“ würde ein säumiger Betrieb nie gesperrt.
- Keine Testphase (KAN-402, Vertrag v3 NV 4.1): Produkte und Preise **ohne** Testzeitraum anlegen; der Checkout
  setzt nie `trial_period_days`, die erste Zahlung ist sofort fällig. Nur Altfälle mit `trialing` (vor dem 10.11.2026)
  wertet software:112 noch aus – für sie „Testphase endet ohne Zahlungsmethode“: kündigen bzw. pausieren (beide sperren).

### 2a. Hauptmandant und Submandanten (KAN-215, seit KAN-214 ohne Stripe-Produkt)
- **Kein Stripe-Produkt nötig:** Ein Submandant kostet 0 € (Entscheidung Jörgen 08.10.2026, KAN-214). Das frühere
  Produkt „software:112 Zusatzmandant“ und die Variablen `STRIPE_PRICE_ZUSATZMANDANT`/`STRIPE_PRODUCT_ZUSATZMANDANT`
  entfallen.
- Mandanten je Paket (KAN-403, Vertrag v3 NV 2.3, Hauptmandant mitgezählt): Basis 1, Standard bis zu 2, Premium bis zu 5
  (`PAKETE[…].maxMandanten`); Benutzerlimit je Mandant. Ein Paketwechsel des Hauptmandanten in ein Paket mit weniger
  Mandanten wird abgelehnt, solange zu viele Submandanten bestehen.
- Ablauf: Der Hauptmandant hat Standard oder Premium (mit Stripe-Abo oder – Pilotbetriebe – manuell gesetzt). Der
  Plattform-Admin ordnet unter Administration › Mandanten › Submandant › Stripe „Als Submandant zuordnen“ zu. Der
  Submandant bekommt das Paket des Hauptmandanten und – falls vorhanden – Stripe-Kunde, -Abo und Status des Hauptmandanten; CRM und Kellergebinde
  werden gemeinsam genutzt (Freigaben in beide Richtungen), Support-Anfragen laufen in JSM unter dem Hauptmandanten.
- Austritt: mit geteiltem Stripe-Abo Nur-Lesen, bis ein eigenes Abo abgeschlossen ist; ohne
  Stripe-Abo bleibt der Status. Die Gemeinschaften bleiben bestehen (Administration › Gemeinschaften).

### 2b. Premium-Support als Zusatzposition (KAN-226)
- Produkt **„software:112 Premium-Support“** anlegen, Preis **79,00 EUR netto monatlich** (wiederkehrend, Steuer wie
  die Pakete). Preis-ID → Vercel `STRIPE_PRICE_PREMIUM_SUPPORT` (serverseitig, kein `NEXT_PUBLIC_`).
- Ablauf: Die Betriebsleitung bucht auf `/abo` → „Premium-Support buchen“ – eine zusätzliche Position im bestehenden
  Abo (anteilig ab heute, metadata `s112_art=premium_support`, `s112_tenant_id`). „Zum Monatsende kündigen“ entfernt die
  Position ohne Gutschrift; das Kennzeichen am Betrieb läuft bis Monatsende. Der Webhook gleicht nach (auch bei
  Änderungen im Stripe-Dashboard: Position hinzufügen/entfernen).
- Ohne `STRIPE_PRICE_PREMIUM_SUPPORT` ist der Knopf ausgeblendet; der Plattform-Admin bucht dann wie bisher unter
  Administration › Mandanten › Stripe (z. B. kostenlos für Pilot- oder Demobetriebe – der Webhook beendet nur, was
  über Stripe gebucht war).

### 4. Vercel – Project → Settings → Environment Variables
- Die drei `NEXT_PUBLIC_STRIPE_PRICE_*` aus Schritt 2 anlegen, dazu `STRIPE_PRICE_PREMIUM_SUPPORT` (Schritt 2b).
- `STRIPE_SECRET_KEY` und `STRIPE_WEBHOOK_SECRET` prüfen/ergänzen.
- Alte Variablen `NEXT_PUBLIC_STRIPE_PRICE_PROFESSIONAL`, `…_PROFESSIONAL_PLUS`,
  `…_ENTERPRISE` **vorerst stehen lassen** (Abbildung alter Abos auf das neue Modell).
- Danach **Redeploy** – `NEXT_PUBLIC_*` werden erst beim Build eingebacken.

### 5. Testlauf (Stripe-Testmodus)
1. Signup (seit KAN-139 ohne Passwort, mit E-Mail-Bestätigung): Link aus der Mail öffnen,
   Passwort festlegen → Weiterleitung auf `/abo` → „Zahlungsdaten hinterlegen“ mit Paket →
   Testkarte `4242 4242 4242 4242` → Mandant muss `active` sein (keine Testphase, KAN-402),
   Module laut Paket geschaltet, `max_benutzer` gesetzt.
2. Auf `/abo` einmal Upgrade und einmal Downgrade → Administration → Mandanten →
   Module: Schalter müssen mitgehen; Downgrade-Hinweis auf wegfallende Module prüfen.
3. Benutzer einladen bis über das Limit → Fehlermeldung „Benutzerlimit erreicht".
4. Abo im Kundenportal kündigen (sofort) → **Nur-Lesen-Modus** (KAN-5): rote Hinweisleiste
   „Nur-Lesen-Modus“ im Arbeitsbereich, `stripe_plan` leer, Module bleiben **unverändert**
   (Daten bleiben einsehbar und exportierbar), jedes Speichern und die KI-Abfrage werden
   abgelehnt, CSV-/BMD-Export und Drucken funktionieren.
5. Danach auf `/abo` „Zahlungsdaten hinterlegen“ → Checkout mit sofortiger Zahlung (keine Testphase, KAN-402)
   → nach Zahlung `active`, Hinweisleiste weg, Speichern wieder möglich.
6. Zahlungsausfall simulieren (Testkarte `4000 0000 0000 0341`, Testuhr vorstellen):
   erst `past_due` (nur Warnleiste), nach dem letzten Versuch `unpaid` bzw. `canceled`
   (Nur-Lesen-Modus). Die Reihenfolge von `invoice.payment_failed` und
   `customer.subscription.updated` spielt keine Rolle – der Status kommt frisch von Stripe.
7. Nach der Kündigung die offene Schlussrechnung bezahlen (Rechnungslink) → Zahlung wird
   protokolliert, der Betrieb bleibt aber im Nur-Lesen-Modus (Rechnung gehört zum alten Abo).

### 6. Danach aufräumen
- Alte Preis-Variablen entfernen, sobald kein Abo mehr auf einem Alt-Preis läuft
  (Stripe → Abonnements filtern).
- Legacy-Slugs in `STRIPE_PLAN_LABELS` (`lib/stripe/client.ts`) und
  `paketAusPlan()` (`lib/pakete.ts`) können dann weg.

### 7. Umstellung von der Sandbox auf das Live-Konto (vor dem ersten zahlenden Kunden)
Sandbox und Live-Konto sind getrennte Datenbestände – **nichts wird automatisch mitgenommen.** Am Code ändert sich
nichts, er liest nur die Variablen. Eine Mischung aus Sandbox- und Live-Werten lässt den Checkout scheitern
(„No such price“), deshalb alles in einem Zug umstellen.

**Vorher klären**
- Live-Konto freischalten: Unternehmensdaten, Bankverbindung, Identitätsprüfung – kann ein paar Tage dauern.
- Kontoinhaber: Das Live-Konto gehört dem Unternehmen, das den Kunden laut Nutzungsvertrag die Rechnung stellt
  (die Sandbox läuft auf „IC&P Consultants eU“).

**Im Live-Konto neu anlegen bzw. einstellen**
1. Produkte und Preise wie in Schritt 2 und 2b (ohne Testzeitraum) – es entstehen **neue Preis-IDs**.
2. Webhook wie in Schritt 3 (gleiche Adresse, gleiche fünf Ereignisse) – es entsteht ein **neues Signing Secret**.
3. Mahnwesen wie in Schritt 3a (unpaid bzw. canceled, nicht „überfällig lassen“).
4. Kontoeinstellungen prüfen: Kundenportal (Kündigen, Zahlungsart ändern, Rechnungsverlauf), Rechnungsvorlage mit
   eigener UID und Branding, Kunden-E-Mails, Steuersatz „USt 20 %“ (Schritt 2c), Zahlungsarten.
5. Gutschein „Early Mover“ wie in Abschnitt 8 (in der Sandbox seit 11.11.2026 vorhanden, im Live-Konto neu anlegen).

**In Vercel (Production) gemeinsam ersetzen, danach Redeploy**
- `STRIPE_SECRET_KEY` (`sk_live_…`)
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PRICE_BASIS`, `NEXT_PUBLIC_STRIPE_PRICE_STANDARD`, `NEXT_PUBLIC_STRIPE_PRICE_PREMIUM`
- `STRIPE_PRICE_PREMIUM_SUPPORT` (neu anlegen)
- `STRIPE_TAX_RATE_UST` (Steuersatz im Live-Konto neu anlegen, Schritt 2c – die Sandbox-ID gilt dort nicht)
- Kommentar „Stripe-Sandbox“ an den Preis-Variablen entfernen. Die Sandbox-Werte können für *Preview* bleiben.

**In der Datenbank aufräumen**
- Betriebe, die sich bis dahin über die Sandbox registriert haben, tragen Sandbox-Kunden- und Abo-Nummern
  (`tenants.stripe_customer_id`, `stripe_subscription_id` …). Mit dem Live-Schlüssel findet Stripe sie nicht mehr.
  Test-Registrierungen vorher über `s112_mandant_loeschen` (Runbook `docs/Mandant_loeschen.md`) entfernen oder ihre
  Stripe-Felder per Service-Role leeren. Prüfabfrage: `SELECT id, name FROM tenants WHERE stripe_customer_id IS NOT NULL`.
- Pilotbetriebe ohne Stripe sind nicht betroffen.

**Danach**
- Ein echter Kauf mit kleinem Betrag bzw. eigener Karte und sofortige Kündigung/Erstattung als Rauchtest:
  Status `active`, Module laut Paket, Webhook-Zustellung im Stripe-Dashboard ohne Fehler.

### 8. Early-Mover-Kondition: Premium zum Preis von Standard (Entscheidung Jörgen 11.11.2026)
Die Kondition für die ersten Kunden gilt **dauerhaft** (welche Betriebe sie bekommen, steht in KAN-11). Umgesetzt als Stripe-Gutschein
am Premium-Abo – der Betrieb läuft in software:112 als Premium (alle Module, bis zu 5 Mandanten), die Rechnung weist
den Nachlass aus. Ein eigener Preis über 299 € würde dagegen als Standard erkannt.

- Gutschein: ID `early-mover`, Name „Early Mover“, 100,00 EUR Nachlass je Monat, Dauer „für immer“, beschränkt auf das
  Produkt „software:112 Premium“.
- Der Checkout kennt keine Gutscheine (kein Gutscheinfeld, bewusst). Ablauf **von Hand im Stripe-Dashboard**:
  1. Der Betrieb registriert sich und bucht Premium (Checkout über 399 €).
  2. Stripe → Abonnements → Abo des Betriebs → „Abonnement aktualisieren“ → Gutschein „Early Mover“ hinzufügen.
     Ab der nächsten Rechnung 299 €.
  3. Die erste Rechnung ist schon mit 399 € bezahlt: 100 € über „Gutschrift erstellen“ an der Rechnung erstatten
     (oder als Guthaben auf die nächste Rechnung anrechnen).
- In software:112 ist nichts zu tun: Paket und Module hängen am Preis (Premium), nicht am Betrag.
- Kommen weitere Early Mover dazu, lohnt ein Gutscheinfeld im Checkout (`allow_promotion_codes` + Aktionscode) –
  eigenes Ticket.

## Noch offen / bewusst nicht gebaut
- Paket-Spalte in der Mandanten-**Liste** (nur im Detail sichtbar).
- Testphase: seit KAN-402 (10.11.2026) entfallen – `TRIAL_TAGE`/`testphaseTage()` sind entfernt, der Checkout baut
  seine Abo-Daten über `checkoutAboDaten()` (`lib/abo/regeln.ts`) ohne `trial_period_days`.
