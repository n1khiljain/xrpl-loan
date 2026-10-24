import { Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { LandingFooter } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingNav } from "@/components/landing/landing-nav";

/*
 * Layout, motion, palette, fonts (Figtree, Geist Mono), and the glow and cloud art are from Project One by Atharvsinh
 * Jadav (ObsidianUI), used with his permission, and now the whole app's look. The copy is ours.
 */

export default function Landing() {
  return (
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
