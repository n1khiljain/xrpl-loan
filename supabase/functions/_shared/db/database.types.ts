
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "admin_actions": {
                  Row: {
                    "action": string,"actor_wallet": string,"created_at": string,"id": number,"payload": NonNullable<Json>,"target": string
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_wallet": string,"created_at"?: string,"id"?: never,"payload"?: NonNullable<Json>,"target": string
                  }
                  Update: {
                    "action"?: string,"actor_wallet"?: string,"created_at"?: string,"id"?: never,"payload"?: NonNullable<Json>,"target"?: string
                  }
                  Relationships: [
                    
                  ]
                },"guarantor_invites": {
                  Row: {
                    "created_at": string,"expires_at": string,"guarantor_wallet": string,"id": string,"receivable_id": string,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"guarantor_wallet": string,"id"?: string,"receivable_id": string,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"guarantor_wallet"?: string,"id"?: string,"receivable_id"?: string,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "guarantor_invites_receivable_id_fkey"
      columns: ["receivable_id"]
isOneToOne: false
      referencedRelation: "receivables"
      referencedColumns: ["id"]
    }
                  ]
                },"ledger_txs": {
                  Row: {
                    "account": string,"created_at": string,"id": number,"purpose": string,"receivable_id": string | null,"result": string,"tx_hash": string,"tx_type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account": string,"created_at"?: string,"id"?: never,"purpose": string,"receivable_id"?: string | null,"result": string,"tx_hash": string,"tx_type": string
                  }
                  Update: {
                    "account"?: string,"created_at"?: string,"id"?: never,"purpose"?: string,"receivable_id"?: string | null,"result"?: string,"tx_hash"?: string,"tx_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_txs_receivable_id_fkey"
      columns: ["receivable_id"]
isOneToOne: false
      referencedRelation: "receivables"
      referencedColumns: ["id"]
    }
                  ]
                },"notifications": {
                  Row: {
                    "id": number,"kind": Database["public"]['Enums']["notification_kind"],"receivable_id": string,"sent_at": string,"wallet_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: never,"kind": Database["public"]['Enums']["notification_kind"],"receivable_id": string,"sent_at"?: string,"wallet_address": string
                  }
                  Update: {
                    "id"?: never,"kind"?: Database["public"]['Enums']["notification_kind"],"receivable_id"?: string,"sent_at"?: string,"wallet_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "notifications_receivable_id_fkey"
      columns: ["receivable_id"]
isOneToOne: false
      referencedRelation: "receivables"
      referencedColumns: ["id"]
    }
                  ]
                },"once_keys": {
                  Row: {
                    "created_at": string,"key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"key": string
                  }
                  Update: {
                    "created_at"?: string,"key"?: string
                  }
                  Relationships: [
                    
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"finance_agent": boolean,"org_id": number,"role_title": string | null,"wallet_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"finance_agent"?: boolean,"org_id": number,"role_title"?: string | null,"wallet_address": string
                  }
                  Update: {
                    "created_at"?: string,"finance_agent"?: boolean,"org_id"?: number,"role_title"?: string | null,"wallet_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "org_members_wallet_address_fkey"
      columns: ["wallet_address"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["wallet_address"]
    }
                  ]
                },"org_officers": {
                  Row: {
                    "active": boolean,"org_id": number,"title": string | null,"wallet_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"org_id": number,"title"?: string | null,"wallet_address": string
                  }
                  Update: {
                    "active"?: boolean,"org_id"?: number,"title"?: string | null,"wallet_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_officers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "active": boolean,"created_at": string,"id": number,"join_code": string,"name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: never,"join_code"?: string,"name": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: never,"join_code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"display_name": string | null,"email": string | null,"email_verified": boolean,"kyc_source": Database["public"]['Enums']["kyc_source"] | null,"kyc_status": Database["public"]['Enums']["kyc_status"],"kyc_updated_at": string | null,"kyc_updated_by": string | null,"privy_user_id": string,"wallet_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string | null,"email_verified"?: boolean,"kyc_source"?: Database["public"]['Enums']["kyc_source"] | null,"kyc_status"?: Database["public"]['Enums']["kyc_status"],"kyc_updated_at"?: string | null,"kyc_updated_by"?: string | null,"privy_user_id": string,"wallet_address": string
                  }
                  Update: {
                    "created_at"?: string,"display_name"?: string | null,"email"?: string | null,"email_verified"?: boolean,"kyc_source"?: Database["public"]['Enums']["kyc_source"] | null,"kyc_status"?: Database["public"]['Enums']["kyc_status"],"kyc_updated_at"?: string | null,"kyc_updated_by"?: string | null,"privy_user_id"?: string,"wallet_address"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_wallet_address_fkey"
      columns: ["wallet_address"]
isOneToOne: true
      referencedRelation: "wallets"
      referencedColumns: ["address"]
    }
                  ]
                },"receivable_documents": {
                  Row: {
                    "created_at": string,"id": string,"mime_type": string,"receivable_id": string,"sha256": string | null,"size_bytes": number,"storage_path": string,"uploaded_by": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"mime_type": string,"receivable_id": string,"sha256"?: string | null,"size_bytes": number,"storage_path": string,"uploaded_by": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"mime_type"?: string,"receivable_id"?: string,"sha256"?: string | null,"size_bytes"?: number,"storage_path"?: string,"uploaded_by"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receivable_documents_receivable_id_fkey"
      columns: ["receivable_id"]
isOneToOne: false
      referencedRelation: "receivables"
      referencedColumns: ["id"]
    }
                  ]
                },"receivables": {
                  Row: {
                    "amount_due": number,"amount_paid": number,"approval_expires_at": string | null,"approved_amount": number,"approved_by": string | null,"call_reason": Database["public"]['Enums']["call_reason"],"created_at": string,"defaulted_at": string | null,"description": string | null,"due_at": string | null,"due_date": string,"face_value": number,"fee_bps": number,"finance_cleared_at": string | null,"finance_cleared_by": string | null,"guarantor_called_at": string | null,"guarantor_wallet": string | null,"guaranty_signed_at": string | null,"id": string,"impaired_at": string | null,"loan_broker_id": string | null,"loan_id": string | null,"number": number,"org_id": number | null,"packet_hash": string | null,"packet_json": Json | null,"payer_email": string | null,"payer_name": string,"payer_outcome": Database["public"]['Enums']["payer_outcome"],"payer_outcome_at": string | null,"payer_outcome_note": string | null,"payer_wallet": string | null,"principal_written_off": boolean,"purchase_price": number,"purchased_at": string | null,"recipient_wallet": string,"reference": string,"reject_reason": string | null,"requested_amount": number,"status": Database["public"]['Enums']["receivable_status"],"submitted_at": string | null,"type": Database["public"]['Enums']["receivable_type"],"updated_at": string,"vault_id": string | null,"write_off_eligible_at": string | null,"written_off_principal": number
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_due"?: number,"amount_paid"?: number,"approval_expires_at"?: string | null,"approved_amount"?: number,"approved_by"?: string | null,"call_reason"?: Database["public"]['Enums']["call_reason"],"created_at"?: string,"defaulted_at"?: string | null,"description"?: string | null,"due_at"?: string | null,"due_date": string,"face_value": number,"fee_bps"?: number,"finance_cleared_at"?: string | null,"finance_cleared_by"?: string | null,"guarantor_called_at"?: string | null,"guarantor_wallet"?: string | null,"guaranty_signed_at"?: string | null,"id"?: string,"impaired_at"?: string | null,"loan_broker_id"?: string | null,"loan_id"?: string | null,"number"?: never,"org_id"?: number | null,"packet_hash"?: string | null,"packet_json"?: Json | null,"payer_email"?: string | null,"payer_name": string,"payer_outcome"?: Database["public"]['Enums']["payer_outcome"],"payer_outcome_at"?: string | null,"payer_outcome_note"?: string | null,"payer_wallet"?: string | null,"principal_written_off"?: boolean,"purchase_price"?: number,"purchased_at"?: string | null,"recipient_wallet": string,"reference": string,"reject_reason"?: string | null,"requested_amount": number,"status"?: Database["public"]['Enums']["receivable_status"],"submitted_at"?: string | null,"type": Database["public"]['Enums']["receivable_type"],"updated_at"?: string,"vault_id"?: string | null,"write_off_eligible_at"?: string | null,"written_off_principal"?: number
                  }
                  Update: {
                    "amount_due"?: number,"amount_paid"?: number,"approval_expires_at"?: string | null,"approved_amount"?: number,"approved_by"?: string | null,"call_reason"?: Database["public"]['Enums']["call_reason"],"created_at"?: string,"defaulted_at"?: string | null,"description"?: string | null,"due_at"?: string | null,"due_date"?: string,"face_value"?: number,"fee_bps"?: number,"finance_cleared_at"?: string | null,"finance_cleared_by"?: string | null,"guarantor_called_at"?: string | null,"guarantor_wallet"?: string | null,"guaranty_signed_at"?: string | null,"id"?: string,"impaired_at"?: string | null,"loan_broker_id"?: string | null,"loan_id"?: string | null,"number"?: never,"org_id"?: number | null,"packet_hash"?: string | null,"packet_json"?: Json | null,"payer_email"?: string | null,"payer_name"?: string,"payer_outcome"?: Database["public"]['Enums']["payer_outcome"],"payer_outcome_at"?: string | null,"payer_outcome_note"?: string | null,"payer_wallet"?: string | null,"principal_written_off"?: boolean,"purchase_price"?: number,"purchased_at"?: string | null,"recipient_wallet"?: string,"reference"?: string,"reject_reason"?: string | null,"requested_amount"?: number,"status"?: Database["public"]['Enums']["receivable_status"],"submitted_at"?: string | null,"type"?: Database["public"]['Enums']["receivable_type"],"updated_at"?: string,"vault_id"?: string | null,"write_off_eligible_at"?: string | null,"written_off_principal"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "receivables_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "receivables_recipient_wallet_fkey"
      columns: ["recipient_wallet"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["wallet_address"]
    }
                  ]
                },"staff": {
                  Row: {
                    "created_at": string,"role": Database["public"]['Enums']["staff_role"],"wallet_address": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"role": Database["public"]['Enums']["staff_role"],"wallet_address": string
                  }
                  Update: {
                    "created_at"?: string,"role"?: Database["public"]['Enums']["staff_role"],"wallet_address"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sync_state": {
                  Row: {
                    "key": string,"last_ledger": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"last_ledger": number,"updated_at"?: string
                  }
                  Update: {
                    "key"?: string,"last_ledger"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"wallets": {
                  Row: {
                    "address": string,"created_at": string,"encrypted_seed": string,"funded_tx": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "address": string,"created_at"?: string,"encrypted_seed": string,"funded_tx"?: string | null
                  }
                  Update: {
                    "address"?: string,"created_at"?: string,"encrypted_seed"?: string,"funded_tx"?: string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "generate_join_code":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "call_reason": "none"|"payer_rejected"|"partial_shortfall"|"overdue","kyc_source": "manual","kyc_status": "not_started"|"pending"|"approved"|"rejected","notification_kind": "guaranty_requested"|"receivable_approved"|"receivable_funded"|"due_soon"|"guarantor_called","payer_outcome": "none"|"rejected"|"short_paid","receivable_status": "Draft"|"FinanceReview"|"Submitted"|"Approved"|"Funded"|"GuarantorCalled"|"Settled"|"Recovered"|"WrittenOff"|"Rejected"|"Cancelled","receivable_type": "card_settlement"|"reimbursement"|"invoice"|"other","staff_role": "underwriter"|"attester"|"admin"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "call_reason": ["none", "payer_rejected", "partial_shortfall", "overdue"],"kyc_source": ["manual"],"kyc_status": ["not_started", "pending", "approved", "rejected"],"notification_kind": ["guaranty_requested", "receivable_approved", "receivable_funded", "due_soon", "guarantor_called"],"payer_outcome": ["none", "rejected", "short_paid"],"receivable_status": ["Draft", "FinanceReview", "Submitted", "Approved", "Funded", "GuarantorCalled", "Settled", "Recovered", "WrittenOff", "Rejected", "Cancelled"],"receivable_type": ["card_settlement", "reimbursement", "invoice", "other"],"staff_role": ["underwriter", "attester", "admin"]
          }
        }
} as const
