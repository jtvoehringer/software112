-- KAN-45 (10.10.2026): Art des Stoffs im Stoffkonto (besondere Konten).
-- Das BKI-Blatt „Besondere Konten“ verlangt je Buchung die Art des Stoffs (Zucker, RTK flüssig, RTK Pulver,
-- Säuerungsmittel, Entsäuerungsmittel); § 29 Abs. 3 WG verlangt die Bestände an KTM/RTK in der Bestandsmeldung.
-- Neue Spalte kellermittel.art mit festem Wertebereich, Vorgabe 'sonstiges' (in der Produktion gibt es noch keine Stoffe).
-- Keine neue RLS: die bestehenden Policies von kellermittel gelten für die ganze Zeile; keine Geheimnis-Spalte.

ALTER TABLE public.kellermittel
  ADD COLUMN art text NOT NULL DEFAULT 'sonstiges'
  CONSTRAINT kellermittel_art_gueltig CHECK (art IN ('zucker', 'rtk_fluessig', 'rtk_pulver', 'ktm', 'saeuerungsmittel', 'entsaeuerungsmittel', 'sonstiges'));

COMMENT ON COLUMN public.kellermittel.art IS
  'KAN-45: Art des Stoffs für das BKI-Blatt „Besondere Konten“ und die KTM/RTK-Bestände der BSM (§ 29 Abs. 3 WG): zucker, rtk_fluessig, rtk_pulver, ktm, saeuerungsmittel, entsaeuerungsmittel, sonstiges';

-- Bestehende Stoffe (Staging/Sandbox): Art aus dem Namen vorschlagen
UPDATE public.kellermittel SET art = CASE
    WHEN name ~* '(rtk|rektifiz)' AND einheit = 'kg' THEN 'rtk_pulver'
    WHEN name ~* '(rtk|rektifiz)' THEN 'rtk_fluessig'
    WHEN name ~* '(ktm|konzentrierter traubenmost|mostkonzentrat)' THEN 'ktm'
    WHEN name ~* '(zucker|saccharose)' THEN 'zucker'
    WHEN name ~* '(entsäuer|entsauer|kalk|kaliumbicarbonat|kaliumhydrogencarbonat)' THEN 'entsaeuerungsmittel'
    WHEN name ~* '(säuer|sauer|weinsäure|weinsaeure|äpfelsäure|milchsäure|zitronensäure)' THEN 'saeuerungsmittel'
    ELSE 'sonstiges' END
  WHERE art = 'sonstiges';
