import type { ReactNode } from "react";
import { CardJourney } from "@/components/landing/card-journey";
import { GlowStage } from "@/components/landing/glow-stage";
import { SectionLink } from "@/components/landing/section-link";
import { usd } from "@/lib/format";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";

/* eslint-disable @next/next/no-img-element */

/** One of Frax's official 3D token renders from frax.com/brand, centred like Project One's coin over a soft glow. */
function CoinVisual({ src }: { src: string }) {
  return (
    <div aria-hidden className="absolute inset-0 flex justify-center pt-[10%] lg:pt-[12%]">
      <div className="bg-on-ink/15 absolute top-[8%] size-[45%] rounded-full blur-3xl" />
      <img src={src} alt="" width={372} height={386} loading="lazy" className="relative h-auto w-[38%] max-w-[260px] self-start drop-shadow-2xl" />
    </div>
  );
}

// the first two backgrounds are Project One's (the astronaut's NASA insignia is blurred out); the last two are Frax's own
// token renders (U-72)
const FEATURES: { title: string; detail: string; visual: ReactNode }[] = [
  {
    title: "Get paid today",
    detail: "Frax pays you in frxUSD as soon as Blockchain at Berkeley approves your request.",
    visual: <img src="/images/landing/bitcoin-coin.webp" alt="" width={1200} height={1170} loading="lazy" className="absolute inset-0 size-full object-cover" />,
  },
  {
    title: "Approved by a club officer",
    detail: "An officer from your club confirms the expense from their phone. If ASUC never pays, the officer covers the rest.",
    visual: <img src="/images/landing/astronaut.webp" alt="" width={1800} height={871} loading="lazy" className="absolute inset-0 size-full object-cover object-[40%_center]" />,
  },
  {
    title: "No fees during the pilot",
    detail: "The fee is 0%, and Frax covers network costs, so nothing is taken out of your reimbursement.",
    visual: <CoinVisual src="/brand/frax-3d.png" />,
  },
  {
    title: "Open to lenders",
    detail: `Frax funds the pilot pool with up to ${usd(config.params.poolDepositCap)}. Lenders can see every reimbursement the pool buys and when each one is closed out.`,
    visual: <CoinVisual src="/brand/frxusd-3d.png" />,
  },
];

function FeatureCard({ title, detail, visual }: (typeof FEATURES)[number]) {
  return (
    <div className="border-on-ink/10 bg-ink relative h-[340px] w-full overflow-hidden rounded-3xl border sm:h-[420px] lg:h-[500px] xl:h-[600px]">
      {visual}
      <div aria-hidden className="from-ink via-ink/70 absolute inset-0 bg-linear-to-t from-25% via-50% to-transparent" />
      <div className="text-on-ink absolute bottom-3 left-3 flex flex-col gap-3 p-4 sm:bottom-4 sm:left-4 sm:p-6 lg:bottom-6 lg:left-6 lg:gap-5 lg:p-8 xl:p-10">
        <h3 className="display-type text-xl font-semibold sm:text-2xl lg:text-3xl xl:text-4xl">{title}</h3>
        <p className="text-on-ink/60 max-w-[520px] text-sm leading-relaxed sm:text-base lg:text-lg">{detail}</p>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section className="mt-10 w-full px-2 sm:mt-16 sm:px-4 lg:mt-20 lg:px-6">
      <div className="noise noise-dark text-on-ink relative rounded-3xl px-4 sm:px-8 lg:px-12 xl:px-20">
        <div className="flex flex-col justify-between gap-8 px-5 py-12 sm:py-16 lg:flex-row lg:gap-12 lg:py-20 xl:py-32">
          <h2 className="display-type max-w-[700px] text-2xl sm:text-3xl lg:text-4xl xl:text-5xl">Reimbursements without the wait</h2>
          <div className="flex max-w-[600px] flex-col gap-6 sm:gap-8 lg:gap-10">
            <p className="text-on-ink/60 text-base leading-relaxed sm:text-lg">
              ASUC reimbursements can take weeks or months. Frax buys your pending reimbursement and pays you today. When ASUC pays you, you send that payment to Frax.
            </p>
            <SectionLink
              href="#how"
              className="from-ink to-ink-2 border-on-ink/20 text-on-ink hover:to-ink w-fit rounded-full border bg-linear-to-t px-6 py-2.5 text-sm font-semibold transition-colors sm:px-7 sm:py-3 sm:text-base"
            >
              See how it works
            </SectionLink>
          </div>
        </div>

        <div className="border-on-ink/10 mb-6 grid w-full grid-cols-1 gap-1 rounded-3xl border-4 p-1 sm:mb-8 sm:gap-2 sm:border-[6px] sm:p-2 lg:mb-10 lg:grid-cols-2">
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>

        <GlowStage>
          <CardJourney />
        </GlowStage>
      </div>
    </section>
  );
}
