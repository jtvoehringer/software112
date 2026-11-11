-- KAN-411 Teil 1 (11.11.2026): Verkauf aus einer E-Mail – Bezug des Verkaufs zur Bestell-Mail.
-- Entscheidungen Jörgen (11.11.2026, Kommentar im Ticket): Schnitt in Teil 1 (ohne KI) und Teil 2 (KI), Ergebnis ist
-- sofort ein Verkauf, nur Microsoft-365-Postfächer, nach dem Speichern wird eine Antwort vorbereitet.
--
--  verkaufsposten.email_conversation_id  Unterhaltung der Bestell-Mail (Graph conversationId – bleibt gleich, auch wenn
--                                        die Mail in einen anderen Ordner verschoben wird; die Nachrichten-ID nicht)
--  verkaufsposten.email_betreff          Betreff der Mail zum Zeitpunkt des Verkaufs (Anzeige am Verkauf)
-- Die Mail-Ansicht zeigt damit „Zu dieser Unterhaltung gibt es bereits einen Verkauf“ (Schutz vor doppelter Erfassung).
-- Staging zuerst (sjpeghrlhsowmquacjhb), dann Produktion. Erst danach die App (PR KAN-411) mergen.

ALTER TABLE public.verkaufsposten
  ADD COLUMN email_conversation_id text
    CONSTRAINT verkaufsposten_email_conversation_chk CHECK (email_conversation_id IS NULL OR char_length(email_conversation_id) <= 300),
  ADD COLUMN email_betreff text
    CONSTRAINT verkaufsposten_email_betreff_chk CHECK (email_betreff IS NULL OR char_length(email_betreff) <= 300);
COMMENT ON COLUMN public.verkaufsposten.email_conversation_id IS
  'KAN-411: Unterhaltung (Graph conversationId) der E-Mail, aus der der Verkauf angelegt wurde.';
COMMENT ON COLUMN public.verkaufsposten.email_betreff IS
  'KAN-411: Betreff der E-Mail, aus der der Verkauf angelegt wurde (Momentaufnahme).';

CREATE INDEX verkaufsposten_email_conversation_idx
  ON public.verkaufsposten (tenant_id, email_conversation_id)
  WHERE email_conversation_id IS NOT NULL;
