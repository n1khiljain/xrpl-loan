export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_actions: {
        Row: {
          action: string
          actor_wallet: string
          created_at: string
          id: number
          payload: Json
          target: string
        }
        Insert: {
          action: string
          actor_wallet: string
          created_at?: string
          id?: never
          payload?: Json
          target: string
        }
        Update: {
          action?: string
          actor_wallet?: string
          created_at?: string
          id?: never
          payload?: Json
          target?: string
        }
        Relationships: []
      }
      claim_documents: {
        Row: {
          claim_id: string
          created_at: string
          id: string
          mime_type: string
          sha256: string | null
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          id?: string
          mime_type: string
          sha256?: string | null
          size_bytes: number
          storage_path: string
          uploaded_by: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          sha256?: string | null
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_documents_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      claims: {
        Row: {
          asuc_outcome: Database["public"]["Enums"]["asuc_outcome"]
          asuc_outcome_at: string | null
          asuc_outcome_note: string | null
          callink_pr_number: string
          created_at: string
          description: string | null
          face_value: number
          guarantor_wallet: string | null
          guaranty_deadline: number | null
          guaranty_nonce: number | null
          guaranty_signature: string | null
          id: string
          onchain_claim_id: number | null
          org_id: number
          packet_hash: string | null
          packet_json: Json | null
          recipient_type: Database["public"]["Enums"]["recipient_type"]
          recipient_wallet: string
          requested_amount: number
          status_cache: Database["public"]["Enums"]["claim_status"]
          updated_at: string
        }
        Insert: {
          asuc_outcome?: Database["public"]["Enums"]["asuc_outcome"]
          asuc_outcome_at?: string | null
          asuc_outcome_note?: string | null
          callink_pr_number: string
          created_at?: string
          description?: string | null
          face_value: number
          guarantor_wallet?: string | null
          guaranty_deadline?: number | null
          guaranty_nonce?: number | null
          guaranty_signature?: string | null
          id?: string
          onchain_claim_id?: number | null
          org_id: number
          packet_hash?: string | null
          packet_json?: Json | null
          recipient_type?: Database["public"]["Enums"]["recipient_type"]
          recipient_wallet: string
          requested_amount: number
          status_cache?: Database["public"]["Enums"]["claim_status"]
          updated_at?: string
        }
        Update: {
          asuc_outcome?: Database["public"]["Enums"]["asuc_outcome"]
          asuc_outcome_at?: string | null
          asuc_outcome_note?: string | null
          callink_pr_number?: string
          created_at?: string
          description?: string | null
          face_value?: number
          guarantor_wallet?: string | null
          guaranty_deadline?: number | null
          guaranty_nonce?: number | null
          guaranty_signature?: string | null
          id?: string
          onchain_claim_id?: number | null
          org_id?: number
          packet_hash?: string | null
          packet_json?: Json | null
          recipient_type?: Database["public"]["Enums"]["recipient_type"]
          recipient_wallet?: string
          requested_amount?: number
          status_cache?: Database["public"]["Enums"]["claim_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claims_recipient_wallet_fkey"
            columns: ["recipient_wallet"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      fraxnet_connections: {
        Row: {
          access_expires_at: string | null
          access_token: string | null
          checked_at: string
          connected_at: string
          email: string | null
          fraxnet_user_id: string
          needs_reconnect: boolean
          org_id: string
          org_is_business: boolean | null
          org_name: string
          org_verified: boolean
          org_verified_at: string | null
          refresh_token: string | null
          scopes: string[]
          wallet_added_at: string | null
          wallet_address: string
        }
        Insert: {
          access_expires_at?: string | null
          access_token?: string | null
          checked_at?: string
          connected_at?: string
          email?: string | null
          fraxnet_user_id: string
          needs_reconnect?: boolean
          org_id: string
          org_is_business?: boolean | null
          org_name: string
          org_verified: boolean
          org_verified_at?: string | null
          refresh_token?: string | null
          scopes?: string[]
          wallet_added_at?: string | null
          wallet_address: string
        }
        Update: {
          access_expires_at?: string | null
          access_token?: string | null
          checked_at?: string
          connected_at?: string
          email?: string | null
          fraxnet_user_id?: string
          needs_reconnect?: boolean
          org_id?: string
          org_is_business?: boolean | null
          org_name?: string
          org_verified?: boolean
          org_verified_at?: string | null
          refresh_token?: string | null
          scopes?: string[]
          wallet_added_at?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraxnet_connections_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      fraxnet_oauth_states: {
        Row: {
          code_verifier: string
          created_at: string
          expires_at: string
          nonce: string
          state: string
          wallet_address: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          expires_at: string
          nonce: string
          state: string
          wallet_address: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          expires_at?: string
          nonce?: string
          state?: string
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraxnet_oauth_states_wallet_address_fkey"
            columns: ["wallet_address"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["wallet_address"]
          },
        ]
      }
      gas_drips: {
        Row: {
          amount_wei: number
          created_at: string
          id: number
          tx_hash: string | null
          wallet_address: string
        }
        Insert: {
          amount_wei?: number
          created_at?: string
          id?: never
          tx_hash?: string | null
          wallet_address: string
        }
        Update: {
          amount_wei?: number
          created_at?: string
          id?: never
          tx_hash?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      guarantor_invites: {
        Row: {
          claim_id: string
          created_at: string
          expires_at: string
          guarantor_wallet: string
          id: string
          token_hash: string
          used_at: string | null
        }
        Insert: {
          claim_id: string
          created_at?: string
          expires_at: string
          guarantor_wallet: string
          id?: string
          token_hash: string
          used_at?: string | null
        }
        Update: {
          claim_id?: string
          created_at?: string
          expires_at?: string
          guarantor_wallet?: string
          id?: string
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guarantor_invites_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          attempts: number
          claim_id: string
          created_at: string
          data: Json
          id: number
          kind: Database["public"]["Enums"]["notification_kind"]
          last_error: string | null
          sent_at: string | null
          wallet_address: string
        }
        Insert: {
          attempts?: number
          claim_id: string
          created_at?: string
          data?: Json
          id?: never
          kind: Database["public"]["Enums"]["notification_kind"]
          last_error?: string | null
          sent_at?: string | null
          wallet_address: string
        }
        Update: {
          attempts?: number
          claim_id?: string
          created_at?: string
          data?: Json
          id?: never
          kind?: Database["public"]["Enums"]["notification_kind"]
          last_error?: string | null
          sent_at?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "claims"
            referencedColumns: ["id"]
          },
        ]
      }
      once_keys: {
        Row: {
          created_at: string
          key: string
        }
        Insert: {
          created_at?: string
          key: string
        }
        Update: {
          created_at?: string
          key?: string
        }
        Relationships: []
      }
      org_officers: {
        Row: {
          active: boolean
          org_id: number
          title: string | null
          wallet_address: string
        }
        Insert: {
          active?: boolean
          org_id: number
          title?: string | null
          wallet_address: string
        }
        Update: {
          active?: boolean
          org_id?: number
          title?: string | null
          wallet_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_officers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id: number
          name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: number
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          fraxnet_account_ref: string | null
          kyc_source: Database["public"]["Enums"]["kyc_source"] | null
          kyc_status: Database["public"]["Enums"]["kyc_status"]
          kyc_updated_at: string | null
          kyc_updated_by: string | null
          liquidation_address: string | null
          privy_user_id: string
          wallet_address: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          fraxnet_account_ref?: string | null
          kyc_source?: Database["public"]["Enums"]["kyc_source"] | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_updated_at?: string | null
          kyc_updated_by?: string | null
          liquidation_address?: string | null
          privy_user_id: string
          wallet_address: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          fraxnet_account_ref?: string | null
          kyc_source?: Database["public"]["Enums"]["kyc_source"] | null
          kyc_status?: Database["public"]["Enums"]["kyc_status"]
          kyc_updated_at?: string | null
          kyc_updated_by?: string | null
          liquidation_address?: string | null
          privy_user_id?: string
          wallet_address?: string
        }
        Relationships: []
      }
      staff: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["staff_role"]
          wallet_address: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["staff_role"]
          wallet_address: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["staff_role"]
          wallet_address?: string
        }
        Relationships: []
      }
      sync_state: {
        Row: {
          key: string
          last_block: number
          updated_at: string
        }
        Insert: {
          key: string
          last_block: number
          updated_at?: string
        }
        Update: {
          key?: string
          last_block?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      invoke_chain_sync: { Args: never; Returns: undefined }
      reserve_gas_drip: {
        Args: { p_wallet: unknown; p_window_seconds: number }
        Returns: number
      }
    }
    Enums: {
      asuc_outcome: "none" | "rejected" | "short_paid"
      claim_status:
        | "Draft"
        | "Submitted"
        | "Approved"
        | "Funded"
        | "GuarantorCalled"
        | "Settled"
        | "Recovered"
        | "WrittenOff"
        | "Rejected"
        | "Cancelled"
      kyc_source: "fraxnet_api" | "manual"
      kyc_status: "not_started" | "pending" | "approved" | "rejected"
      notification_kind:
        | "guaranty_requested"
        | "claim_approved"
        | "claim_funded"
        | "due_soon"
        | "guarantor_called"
      recipient_type: "member" | "org_treasurer"
      staff_role: "underwriter" | "attester" | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      asuc_outcome: ["none", "rejected", "short_paid"],
      claim_status: [
        "Draft",
        "Submitted",
        "Approved",
        "Funded",
        "GuarantorCalled",
        "Settled",
        "Recovered",
        "WrittenOff",
        "Rejected",
        "Cancelled",
      ],
      kyc_source: ["fraxnet_api", "manual"],
      kyc_status: ["not_started", "pending", "approved", "rejected"],
      notification_kind: [
        "guaranty_requested",
        "claim_approved",
        "claim_funded",
        "due_soon",
        "guarantor_called",
      ],
      recipient_type: ["member", "org_treasurer"],
      staff_role: ["underwriter", "attester", "admin"],
    },
  },
} as const

