# Stripe-Einrichtung – offene Checkliste (Stand 2.9.2026)

**Status: bewusst zurückgestellt.** Der Code für das Paketmodell Basis / Standard /
Premium ist fertig und deployt (Commit `80e24a2`, Definition in `src/lib/pakete.ts`),
aber in Stripe ist noch nichts angelegt. Die Einrichtung erfolgt, sobald das
Stripe-Konto steht – **spätestens vor dem ersten zahlenden Kunden.** Bis dahin:

- Signup und `/abo` zeigen keine Paketkarten (kein Fehler – Pakete ohne Preis-ID
  werden einfach nicht angeboten). Ein Signup ist damit nicht abschließbar.
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
   Testkarte `4242 4242 4242 4242` → Mandant muss `trialing` sein,
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

## Noch offen / bewusst nicht gebaut
- Paket-Spalte in der Mandanten-**Liste** (nur im Detail sichtbar).
- Testphase: seit KAN-402 (10.11.2026) entfallen – `TRIAL_TAGE`/`testphaseTage()` sind entfernt, der Checkout baut
  seine Abo-Daten über `checkoutAboDaten()` (`lib/abo/regeln.ts`) ohne `trial_period_days`.
