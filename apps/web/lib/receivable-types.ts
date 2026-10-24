import type { ReceivableType } from "./types";

/** How each kind of payment is named on screen, with the words its form uses for the payer and reference. */
export const RECEIVABLE_TYPES: Record<
  ReceivableType,
  { label: string; short: string; hint: string; payerLabel: string; payerPlaceholder: string; referenceLabel: string; referencePlaceholder: string }
> = {
  invoice: {
    label: "Invoice",
    short: "Invoice",
    hint: "A customer owes you for work or goods",
    payerLabel: "Customer",
    payerPlaceholder: "Acme Supply Co.",
    referenceLabel: "Invoice number",
    referencePlaceholder: "INV-1042",
  },
  card_settlement: {
    label: "Card settlement",
    short: "Card settlement",
    hint: "Card sales your processor hasn't paid out yet",
    payerLabel: "Card processor",
    payerPlaceholder: "Stripe",
    referenceLabel: "Settlement or payout ID",
    referencePlaceholder: "po_1Q2w3E",
  },
  reimbursement: {
    label: "Reimbursement",
    short: "Reimbursement",
    hint: "An employer, club, or school owes you back",
    payerLabel: "Who reimburses you",
    payerPlaceholder: "ASUC",
    referenceLabel: "Request or report number",
    referencePlaceholder: "PR-123456",
  },
  other: {
    label: "Something else",
    short: "Payment",
    hint: "Any other money someone has agreed to pay you",
    payerLabel: "Who owes you",
    payerPlaceholder: "Name of the person or business",
    referenceLabel: "Reference",
    referencePlaceholder: "Contract or agreement number",
  },
};

export const TYPE_ORDER: ReceivableType[] = ["invoice", "card_settlement", "reimbursement", "other"];
