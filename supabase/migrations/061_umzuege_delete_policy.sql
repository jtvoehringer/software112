-- Migration 061: DELETE-Policy für keller_umzuege
-- Bisher fehlte die DELETE-Policy → RLS blockierte das Löschen still

create policy "umzuege_delete" on keller_umzuege
  for delete using (
    user_has_role_in_tenant(tenant_id, array['system_admin','tenant_admin','winzer'])
  );
