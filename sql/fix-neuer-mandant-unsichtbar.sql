-- ═══════════════════════════════════════════════════════════════════════════════
-- SOFORT-FIX: neu angelegter Mandant ohne Mitgliedschaft ist für niemanden sichtbar
--
-- Ursache: Die Mandanten-Liste (/admin/mandanten) zeigt seit dem Scoping-Fix nur
-- noch Mandanten, wo der eingeloggte User eine AKTIVE Mitgliedschaft hat. Beim
-- Anlegen eines neuen Mandanten über "+ Neuer Mandant" wurde bisher aber NUR die
-- tenants-Zeile angelegt, keine Mitgliedschaft für den Ersteller - der neue
-- Mandant war dadurch für niemanden mehr erreichbar (auch nicht für den
-- System-Admin, der ihn gerade angelegt hat).
--
-- Der Code ist gefixt (createMandant legt jetzt automatisch eine Mitgliedschaft
-- für den Ersteller an - siehe commit-fix-neuer-mandant-mitgliedschaft.ps1),
-- aber der Mandant, den du gerade eben angelegt hast, ist davon nicht betroffen
-- und braucht diesen einmaligen Nachtrag.
--
-- Schritt 1: ausführen, um den/die "verwaisten" Mandanten zu finden
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT t.id, t.name, t.slug, t.created_at
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = t.id
)
ORDER BY t.created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Schritt 2: die passende Zeile (dein neuer Mandant, an Name/Zeitpunkt erkennbar)
-- unten bei '<TENANT_ID>' eintragen und ausführen. Legt dich als aktives Mitglied
-- mit Rolle system_admin an - danach taucht der Mandant sofort in der Liste auf.
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO tenant_memberships (tenant_id, user_id, role, aktiv)
VALUES (
  '<TENANT_ID>',
  (SELECT id FROM auth.users WHERE email = 'jv@icp-consultants.at'),
  'system_admin',
  true
);

-- Kontrolle:
SELECT t.name, m.role, m.aktiv
FROM tenant_memberships m
JOIN tenants t ON t.id = m.tenant_id
WHERE m.user_id = (SELECT id FROM auth.users WHERE email = 'jv@icp-consultants.at')
ORDER BY t.created_at DESC;
