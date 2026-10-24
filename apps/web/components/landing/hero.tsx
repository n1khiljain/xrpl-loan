"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { CtaLabel } from "@/components/app/cta";
import { Button } from "@/components/ui/button";
import { EASE } from "@/components/motion";

/*
 * The landing hero: centred copy over the panel gradient and a soft glow.
 */

const HEADLINE = "Get reimbursed for club expenses today";

export function Hero() {
  return (
    <section id="top" className="bg-ink text-on-ink relative isolate flex h-dvh min-h-[640px] flex-col items-center justify-center overflow-hidden">
        <div aria-hidden className="bg-grad-hero absolute inset-0 -z-20" />
        <div aria-hidden className="bg-on-ink/10 absolute top-[18%] left-1/2 -z-10 size-[60vmin] -translate-x-1/2 rounded-full blur-3xl" />
        <div aria-hidden className="from-ink absolute inset-x-0 bottom-0 -z-10 h-40 bg-linear-to-t to-transparent" />

        <div className="flex max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-5 text-center sm:px-8">
            <h1 aria-label={HEADLINE} className="display-type flex flex-wrap justify-center gap-x-[0.25em] text-5xl leading-[1.02] font-bold sm:text-7xl lg:text-8xl">
              {HEADLINE.split(" ").map((word, i) => (
                <motion.span
                  key={word}
                  aria-hidden
                  className="inline-block"
                  initial={{ opacity: 0, y: 30, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: EASE }}
                >
                  {word}
                </motion.span>
              ))}
            </h1>
            <motion.div
              className="flex flex-col items-center gap-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.8, ease: EASE }}
            >
              <p className="text-on-ink/80 max-w-xl text-base leading-relaxed lg:text-[19px] lg:leading-[1.55]">
                Skip the weeks of waiting on ASUC. A lending vault on the XRP Ledger pays you in RLUSD within a day.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" variant="light" className="pr-2">
                  <Link href="/claims/new/">
                    <CtaLabel invert>Get reimbursed now</CtaLabel>
                  </Link>
                </Button>
                <Button asChild size="lg" variant="glass">
                  <Link href="/lend/">Lend to the vault</Link>
                </Button>
              </div>
            </motion.div>
        </div>
    </section>
  );
}
