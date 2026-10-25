import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CARD_TONE, StateChip } from "../components/app/state-chip";
import { ClaimCard } from "../components/brand/claim-card";
import { LiveClaimCard } from "../components/brand/live-claim-card";
import { CountUp, Expand, Swap } from "../components/motion";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("motion kit renders the real content without JavaScript (U-75)", () => {
  it("CountUp renders the final number, so no-JS and reduced motion see the right amount", () => {
    const html = renderToStaticMarkup(<CountUp value={240} format={(n) => `$${n.toFixed(2)}`} />);
    expect(html).toContain("$240.00");
  });

  it("Expand renders its content only while open", () => {
    expect(renderToStaticMarkup(<Expand open>details</Expand>)).toContain("details");
    expect(renderToStaticMarkup(<Expand open={false}>details</Expand>)).not.toContain("details");
  });

  it("Swap renders the current child", () => {
    expect(renderToStaticMarkup(<Swap id="paid">Paid card</Swap>)).toContain("Paid card");
  });
});

describe("the app follows the landing page's look (U-75)", () => {
  it("uses Inter for headings, Inter for text, and Geist Mono, not the design canvas's Manrope, Archivo, and JetBrains Mono", () => {
    expect(css).toMatch(/--font-body: var\(--font-inter\)/);
    expect(css).toMatch(/--font-display: var\(--font-inter\)/);
    expect(css).toMatch(/--font-mono: var\(--font-geist-mono\)/);
    expect(css).not.toMatch(/manrope|archivo|jetbrains/i);
  });

  it("headings and labels are sentence case, never forced uppercase", () => {
    for (const utility of ["display-type", "eyebrow"]) {
      const block = new RegExp(`@utility ${utility} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
      expect(block).not.toBe("");
      expect(block).not.toContain("uppercase");
    }
  });

  it("state chips are a dot and plain text, not a filled pill", () => {
    const html = renderToStaticMarkup(<StateChip state="Submitted" />);
    expect(html).toContain("In review");
    expect(html).not.toMatch(/bg-info-soft|rounded-full px-/);
  });

  it("claim cards show a plain number and state in the card's font", () => {
    const html = renderToStaticMarkup(<ClaimCard claimId="0014" amount="$240.00" state="IN REVIEW" org="Launchpad" />);
    expect(html).toContain("No. 0014");
    expect(html).toContain("In review");
    expect(html).not.toContain("font-mono");
    expect(renderToStaticMarkup(<ClaimCard claimId="DRAFT" amount="$0.00" state="DRAFT" org="Launchpad" />)).toContain(">Draft<");
  });

  it("the card's color changes at every step a member sees, so each state looks different", () => {
    const steps = [CARD_TONE.Submitted, CARD_TONE.Approved, CARD_TONE.Funded, CARD_TONE.Settled];
    expect(new Set(steps).size).toBe(4);
    for (const tone of new Set(Object.values(CARD_TONE))) expect(css).toContain(`@utility bg-grad-card-${tone} {`);
  });

  it("cards are flat in every state, with no glass or metal finish, and closed-out cards still get their stamp", () => {
    for (const tone of ["frost", "sky", "deep", "gold"] as const) {
      const html = renderToStaticMarkup(<ClaimCard claimId="0014" amount="$240.00" state="IN REVIEW" org="Launchpad" tone={tone} />);
      expect(html).not.toMatch(/card-(frost-edge|brushed|holo)|grain/);
    }
    const closed = renderToStaticMarkup(<LiveClaimCard claimId="0014" amount="$240.00" state="CLOSED OUT" org="Launchpad" tone="gold" moment="closed" />);
    expect(closed).toContain("Paid in full");
  });
});
