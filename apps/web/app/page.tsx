import { Audiences } from "@/components/landing/audiences";
import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingNav } from "@/components/landing/landing-nav";

/*
 * The landing page, laid out after smallest.ai: a plain top bar, the headline over a row of step cards, the feature
 * band, the product tour, who it's for, and the FAQ last, over the footer links. White throughout, with spot orange
 * and Night carrying the colour. The copy is ours.
 */

export default function Landing() {
  return (
    <div id="top" className="bg-surface text-foreground relative overflow-x-clip">
      <LandingNav />
      <main>
        <HowItWorks />
        <Features />
        <Audiences />
        <Faq />
      </main>
      <LandingFooter />
    </div>
  );
}
