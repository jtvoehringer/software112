'use server'
// schreibsperre-ausnahme-datei: öffentliche Registrierung – legt erst einen Betrieb an, es gibt noch kein Abo zu sperren (KAN-5)

import { clientIp, drossel } from '@/lib/sicherheit/drossel'
// ── Self-Service-Signup: neuer Betrieb + Betriebsleiter-Einladung ────────────
// Rückmeldung 31.8.2026 ("Self-Service-Signup ... voller öffentlicher Signup
// für Ziel 200 Mandanten"): öffentlich erreichbar (kein Login nötig).
//
// KAN-139 (Konto-Vorab-Übernahme): Früher entstand hier sofort ein bestätigtes
// Konto mit dem eingegebenen Passwort (email_confirm: true) – wer eine fremde
// Adresse registrierte, besaß danach ein gültiges Konto auf diese Adresse und
// bekam spätere Einladungen des echten Inhabers. Jetzt:
//   – Mandant (stripe_status='incomplete', also gesperrt) + Mitgliedschaft
//     entstehen wie bisher, das Konto aber als Supabase-EINLADUNG ohne
//     Passwort. Anmelden kann sich erst, wer den Link aus dem Postfach öffnet
//     und dabei das Passwort festlegt (/auth/invite → /auth/update-password).
//   – Kein Login, kein Stripe-Kunde und kein Checkout vor der Bestätigung: nach
//     der ersten Anmeldung führt das Dashboard-Layout auf /abo ('incomplete'
//     OHNE Abo-ID = „Zahlung offen“, lib/abo/regeln.ts), dort legt „Jetzt
//     Zahlungsdaten hinterlegen“ (starteZahlungAction) Stripe-Kunde und
//     Checkout mit Testphase an. Erst das Webhook-Event
//     customer.subscription.created setzt stripe_status auf 'trialing'.
//   – Dieselbe neutrale Antwort, egal ob die Adresse neu ist oder schon ein
//     Konto hat (keine Enumeration). Bestehende bestätigte Konten bekommen
//     stattdessen einen Hinweis per Mail (Brevo, falls eingerichtet).

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { istPaketKey, paketPriceId, PAKETE } from '@/lib/pakete'
import { AktionsFehler } from '@/lib/fehler'
import { sendEmail } from '@/lib/brevo/api'
import { APP_URL, EINLADUNG_REDIRECT, findeKontoPerEmail } from '@/lib/auth/einladung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type Ergebnis = { ok: true; hinweis: string } | { ok: false; fehler: string }

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function neutraleAntwort(email: string): Ergebnis {
  return {
    ok: true,
    hinweis: `Fast geschafft! Wir haben eine E-Mail an ${email} geschickt. Bitte öffnen Sie den Link darin, um Ihre Adresse zu bestätigen und Ihr Passwort festzulegen. Danach hinterlegen Sie die Zahlungsdaten für die 14-tägige Testphase. Keine E-Mail erhalten? Bitte den Spam-Ordner prüfen – falls Sie bereits ein Konto haben, melden Sie sich einfach an oder setzen Ihr Passwort zurück.`,
  }
}

/** Hinweis an ein bestehendes, bestätigtes Konto (statt einer Fehlermeldung im Formular). Best effort. */
async function sendeKontoBestehtMail(email: string): Promise<void> {
  if (!process.env.BREVO_API_KEY) return
  const text = `Hallo,\n\njemand hat versucht, mit dieser E-Mail-Adresse einen neuen Betrieb bei software:112 zu registrieren. `
    + `Für diese Adresse besteht bereits ein Konto.\n\nAnmelden: ${APP_URL}/login\n`
    + `Passwort vergessen? Auf der Anmeldeseite „Passwort vergessen“ wählen.\n\n`
    + `Falls Sie das nicht waren, können Sie diese E-Mail ignorieren – an Ihrem Konto wurde nichts geändert.\n\n– software:112`
  const html = `<p>Hallo,</p><p>jemand hat versucht, mit dieser E-Mail-Adresse einen neuen Betrieb bei software:112 zu registrieren. Für diese Adresse besteht bereits ein Konto.</p>`
    + `<p><a href="${APP_URL}/login" style="display:inline-block;background:#4F90E8;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none">Anmelden</a></p>`
    + `<p>Passwort vergessen? Auf der Anmeldeseite „Passwort vergessen“ wählen.</p>`
    + `<p style="color:#707883;font-size:12px">Falls Sie das nicht waren, können Sie diese E-Mail ignorieren – an Ihrem Konto wurde nichts geändert.</p>`
  try {
    await sendEmail({ to: { email }, subject: '[software:112] Registrierung mit Ihrer E-Mail-Adresse', htmlContent: html, textContent: text, senderName: 'software:112' })
  } catch (err) {
    console.error('Signup: Hinweis-Mail an bestehendes Konto (KAN-139):', err)
  }
}

export async function registrierenAction(formData: FormData): Promise<Ergebnis> {
  const betrieb  = ((formData.get('betrieb')  as string) || '').trim()
  const name     = ((formData.get('name')     as string) || '').trim()
  const email    = ((formData.get('email')    as string) || '').trim().toLowerCase()
  // Paketmodell (2.9.2026): der Client schickt nur den Paket-Schlüssel, die
  // Stripe-Preis-ID wird serverseitig aufgelöst (lib/pakete.ts) - so kann
  // niemand eine fremde/alte Preis-ID unterschieben. Gebucht wird seit KAN-139
  // erst nach der Bestätigung auf /abo; hier nur prüfen, dass der Checkout für
  // das Paket eingerichtet ist (sonst bliebe der neue Betrieb dauerhaft gesperrt).
  const paket    = ((formData.get('paket')    as string) || '').trim()

  // Öffentliche Registrierung (23.9.2026): je IP höchstens 5 Versuche pro Stunde
  if (!drossel(`signup:${await clientIp()}`, 5, 60 * 60 * 1000)) return { ok: false, fehler: 'Zu viele Registrierungsversuche. Bitte später erneut versuchen oder uns kontaktieren.' }
  if (!betrieb)  return { ok: false, fehler: 'Bitte den Namen Ihres Betriebs angeben.' }
  // Reservierter Name (24.9.2026): Das Layout erkennt den Sandbox-Mandanten für Menü und
  // Sandbox-Sonderfreigabe noch am Namen 'Sandbox' (Umstellung auf die ID: KAN-10); die
  // Ausnahme von der Abo-Sperre hängt seit KAN-5 an der festen ID (lib/abo/regeln.ts)
  if (betrieb.toLowerCase() === 'sandbox') return { ok: false, fehler: 'Dieser Betriebsname ist reserviert. Bitte einen anderen Namen wählen.' }
  if (!name)     return { ok: false, fehler: 'Bitte Ihren Namen angeben.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, fehler: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if (!istPaketKey(paket)) return { ok: false, fehler: 'Bitte ein Paket auswählen.' }
  if (!paketPriceId(paket)) return { ok: false, fehler: `Für das Paket ${PAKETE[paket].label} ist noch kein Stripe-Preis hinterlegt. Bitte den Support kontaktieren.` }

  const admin = createSupabaseAdminClient()

  let bestehend: Awaited<ReturnType<typeof findeKontoPerEmail>>
  try { bestehend = await findeKontoPerEmail(admin, email) }
  catch (err) { console.error('Signup:', err); return { ok: false, fehler: 'Die Registrierung ist gerade nicht möglich. Bitte später erneut versuchen.' } }

  if (bestehend?.email_confirmed_at) {
    // Konto existiert und ist bestätigt: nichts anlegen, dieselbe Antwort wie bei einer neuen Adresse
    await sendeKontoBestehtMail(email)
    return neutraleAntwort(email)
  }

  if (bestehend) {
    // Unbestätigtes Konto (offene Einladung oder nie bestätigte Registrierung): Link
    // erneut senden – das Passwort legt erst fest, wer den Link aus dem Postfach öffnet.
    const { count } = await (admin.from('tenant_memberships') as R)
      .select('id', { count: 'exact', head: true }).eq('user_id', bestehend.id)
    const { error: e } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: EINLADUNG_REDIRECT })
    if (e) console.error('Signup: Einladung erneut senden (KAN-139):', e.message)
    // Schon einem Betrieb zugeordnet → keinen weiteren anlegen
    if ((count ?? 0) > 0) return neutraleAntwort(email)
  }

  const baseSlug = slugify(betrieb)
  const slug = `${baseSlug || 'betrieb'}-${Date.now().toString(36)}`

  const { data: tenant, error: tenantError } = await (admin.from('tenants') as R)
    .insert({ name: betrieb, slug, stripe_status: 'incomplete' })
    .select('id')
    .single()
  if (tenantError) return { ok: false, fehler: (tenantError as R).message }
  const tenantId = (tenant as R).id as string

  const betriebLoeschen = async () => {
    const { error: e } = await (admin.from('tenants') as R).delete().eq('id', tenantId)
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (tenants): ${e.message}`)
  }

  // Konto als Einladung ohne Passwort (bestehendes unbestätigtes Konto: oben schon neu verschickt)
  let userId = bestehend?.id ?? null
  const neuesKonto = !userId
  if (!userId) {
    const { data: userData, error: userError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: EINLADUNG_REDIRECT,
      data: { display_name: name },
    })
    if (userError || !userData.user) {
      console.error('Signup: Einladung (KAN-139):', userError?.message)
      await betriebLoeschen()
      return { ok: false, fehler: 'Die Bestätigungs-E-Mail konnte nicht versandt werden. Bitte später erneut versuchen oder uns kontaktieren.' }
    }
    userId = userData.user.id
  }

  const { error: memberError } = await (admin.from('tenant_memberships') as R)
    .insert({ tenant_id: tenantId, user_id: userId, role: 'tenant_admin', aktiv: true })
  if (memberError) {
    if (neuesKonto) await admin.auth.admin.deleteUser(userId)
    await betriebLoeschen()
    return { ok: false, fehler: (memberError as R).message }
  }

  await (admin.from('profiles') as R)
    .upsert({ id: userId, full_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' })

  return neutraleAntwort(email)
}
