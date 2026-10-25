import { GlyphField, type ShapeName } from "@/components/landing/glyph-field";
import { PosterContent, posterSurface } from "@/components/landing/poster-card";
import { ASSET, config } from "@/lib/config";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * The landing's feature band: a heading with its blurb across from it, then the same poster cards as the hero. Three
 * cards in the secondary button's light warm grey, each with its idea drawn in Night glyphs, and one wide spot-orange
 * card across the row for lenders, its bank rising out of the bottom right corner.
 */

const CARDS: { title: string; detail: string; shape: ShapeName }[] = [
  {
    title: "Liquidity up front",
    detail: `The lending vault pays the loan in ${ASSET} once a reviewer approves it.`,
    shape: "drop",
  },
  {
    title: "Signed off at your business",
    detail: "Someone at your business confirms the payment. If it never arrives, they cover the rest.",
    shape: "pen",
  },
  {
    title: "Interest follows the horizon",
    detail: "What you pay back depends on how long the loan runs. The app covers network costs.",
    shape: "clock",
  },
];

export function FeatureGrid() {
  return (
    <section className="bg-surface w-full">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-10 px-4 py-16 sm:px-6 lg:gap-16 lg:px-10 lg:py-28">
        <div className="flex flex-col justify-between gap-6 lg:flex-row lg:gap-12">
          <h2 className="display-type max-w-[16ch] text-[clamp(2rem,4vw,3.25rem)]">Liquidity for the payments you choose</h2>
          <p className="text-muted-foreground max-w-md text-base leading-relaxed sm:text-lg">
            Install lets a business expedite a transaction, transfer, or payment. A lending vault on the XRP Ledger pays
            the loan up front, and you pay it back with interest based on the loan horizon.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {CARDS.map((card, i) => (
            <article key={card.title} className={posterSurface("light")}>
              <PosterContent
                title={card.title}
                detail={card.detail}
                shape={card.shape}
                tone="light"
                index={i}
                markLabel={`Feature ${i + 1} of 4`}
                showMark={false}
                seed={i + 21}
              />
            </article>
          ))}
          <article className={cn(posterSurface("orange"), "md:col-span-2 lg:col-span-3")}>
            {/* the bank rises out of the bottom right corner, cropped by the card's edges */}
            <GlyphField
              shape="bank"
              seed={8}
              cell={13}
              anchor={1}
              fit={1}
              className="absolute -right-[8%] bottom-[30%] -z-10 h-[46%] w-[100%] sm:-right-[4%] sm:-bottom-[10%] sm:h-[92%] sm:w-[52%]"
            />
            <PosterContent
              title="Open to lenders through a lending vault"
              detail={`Verified lenders fund a private vault on the XRP Ledger, up to ${usd(config.params.poolDepositCap)}. Every payout and repayment is on the ledger.`}
              shape="bank"
              tone="orange"
              index={3}
              markLabel="Feature 4 of 4"
              showMark={false}
              centerGlyph={false}
              seed={8}
              titleClassName="max-w-[16ch] text-[clamp(1.875rem,3vw,2.75rem)] lg:max-w-[45%]"
              detailClassName="max-w-[34ch] sm:text-[22px] lg:max-w-[42%]"
            />
          </article>
        </div>
      </div>
    </section>
  );
}
