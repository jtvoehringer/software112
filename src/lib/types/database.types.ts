/**
 * Supabase Database Types für software:112
 *
 * Diese Datei wird später durch `supabase gen types typescript` automatisch
 * generiert. Bis dahin dient sie als manuelles Type-Skeleton.
 *
 * Befehl zum Regenerieren (nach jeder Migration):
 *   npx supabase gen types typescript --project-id DEIN_PROJECT_ID > src/lib/types/database.types.ts
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'system_admin' | 'tenant_admin' | 'winzer' | 'leser'

export type Bewirtschaftung =
  | 'konventionell'
  | 'bio'
  | 'in_umstellung'
  | 'demeter'

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: {
          id: string
          name: string
          slug: string
          plan: string
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          plan?: string
          active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          plan?: string
          active?: boolean
          updated_at?: string
        }
      }
      tenant_memberships: {
        Row: {
          id: string
          tenant_id: string
          user_id: string
          role: UserRole
          created_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          user_id: string
          role: UserRole
          created_at?: string
        }
        Update: {
          role?: UserRole
        }
      }
      weingarten: {
        Row: {
          id: string
          tenant_id: string
          name: string
          ried: string | null
          flaeche_ha: number | null
          rebsorte: string | null
          pflanzjahr: number | null
          bewirtschaftung: Bewirtschaftung | null
          notizen: string | null
          aktiv: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          tenant_id: string
          name: string
          ried?: string | null
          flaeche_ha?: number | null
          rebsorte?: string | null
          pflanzjahr?: number | null
          bewirtschaftung?: Bewirtschaftung | null
          notizen?: string | null
          aktiv?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          name?: string
          ried?: string | null
          flaeche_ha?: number | null
          rebsorte?: string | null
          pflanzjahr?: number | null
          bewirtschaftung?: Bewirtschaftung | null
          notizen?: string | null
          aktiv?: boolean
          updated_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_user_tenant_ids: {
        Args: Record<PropertyKey, never>
        Returns: string[]
      }
      get_user_role_in_tenant: {
        Args: { p_tenant_id: string }
        Returns: UserRole | null
      }
    }
    Enums: {
      user_role: UserRole
      bewirtschaftung: Bewirtschaftung
    }
  }
}
