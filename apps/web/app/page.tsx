import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingNav } from "@/components/landing/landing-nav";

/*
 * Layout, motion, palette, fonts (Figtree, Geist Mono), and the glow and cloud art are from Project One by Atharvsinh
 * Jadav (ObsidianUI), used with his permission, and now the whole app's look (U-75). The hero's footage is frax.com's
 * (U-74). The copy is ours (U-72).
 */

export default function Landing() {
  return (
    // UNCERTAIN: U-72, U-74
    <div className="noise bg-background text-foreground relative overflow-x-clip">
      <LandingNav />
      <Hero />
      <Features />
      <HowItWorks />
      <Faq />
      <LandingFooter />
    </div>
  );
}
