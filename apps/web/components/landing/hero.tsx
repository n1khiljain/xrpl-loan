"use client";

import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { CtaLabel } from "@/components/app/cta";
import { ClubLogoStrip } from "@/components/landing/club-logo-strip";
import { Button } from "@/components/ui/button";
import { EASE } from "@/components/motion";

/*
 * The landing hero: frax.com's own hero footage (Earth at night, city lights, sunrise on the rim) full-bleed behind
 * centred copy, kept as plain as frax.com's hero, with the clubs' logos along the bottom (U-74).
 */

const HEADLINE = "Get reimbursed for club expenses today";

export function Hero() {
  const reduced = useReducedMotion();
  const video = useRef<HTMLVideoElement>(null);

  // Keep the footage running. Browsers pause a muted background video on their own (iOS when the tab goes to the back,
  // Safari's Low Power Mode, data saver, memory pressure) and never restart it, and after a long idle, a laptop sleep,
  // or a GPU restart the decoder can die while the element still says "playing", which painted the hero black. So:
  // resume on any sign of life, retry a refused play() on the next interaction, pause while scrolled away, and watch
  // for frames; when none arrive for a few seconds, reload the video. The poster sits underneath, so a failure shows
  // the still frame, never black. Reduced motion keeps the poster. Playing only after mount keeps markup the same.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      return;
    }
    let onScreen = true;
    let lastFrame = performance.now();
    let lastTime = -1;
    const wanted = () => onScreen && document.visibilityState === "visible";
    const resume = () => {
      if (!wanted()) return;
      if (v.error || v.networkState === v.NETWORK_NO_SOURCE) return reload();
      if (v.paused) void v.play().catch(() => undefined);
    };
    const reload = () => {
      lastFrame = performance.now();
      v.load();
      void v.play().catch(() => undefined);
    };

    // count painted frames where the browser can tell us, and fall back to watching currentTime move
    let frameCb = 0;
    const countsFrames = typeof v.requestVideoFrameCallback === "function";
    const onFrame = () => {
      lastFrame = performance.now();
      frameCb = v.requestVideoFrameCallback(onFrame);
    };
    if (countsFrames) frameCb = v.requestVideoFrameCallback(onFrame);
    const watchdog = window.setInterval(() => {
      if (!wanted()) {
        lastFrame = performance.now();
        return;
      }
      if (!countsFrames && v.currentTime !== lastTime) lastFrame = performance.now();
      lastTime = v.currentTime;
      if (v.paused) return resume();
      if (v.error || performance.now() - lastFrame > 4000) reload();
    }, 2000);

    const onPause = () => window.setTimeout(resume, 250);
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry?.isIntersecting ?? true;
      if (onScreen) resume();
      else v.pause();
    });
    seen.observe(v);
    const events = ["pageshow", "focus", "online", "pointerdown", "keydown", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, resume, { passive: true });
    document.addEventListener("visibilitychange", resume);
    v.addEventListener("pause", onPause);
    v.addEventListener("canplay", resume);
    v.addEventListener("error", reload);
    resume();
    return () => {
      window.clearInterval(watchdog);
      if (frameCb) v.cancelVideoFrameCallback(frameCb);
      seen.disconnect();
      for (const e of events) window.removeEventListener(e, resume);
      document.removeEventListener("visibilitychange", resume);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("canplay", resume);
      v.removeEventListener("error", reload);
    };
  }, [reduced]);

  return (
    <section id="top" className="bg-ink text-on-ink relative isolate flex h-dvh min-h-[640px] flex-col items-center justify-center overflow-hidden">
        {/* the still frame under the video, so a dead decoder shows this instead of black */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/landing/earth-poster.webp"
          alt=""
          aria-hidden
          className="absolute inset-0 -z-30 size-full object-cover object-[30%_center] max-sm:object-[18%_center]"
        />
        <video
          ref={video}
          muted
          loop
          playsInline
          preload="auto"
          poster="/images/landing/earth-poster.webp"
          aria-hidden
          className="absolute inset-0 -z-20 size-full object-cover object-[30%_center] max-sm:object-[18%_center]"
        >
          <source src="/images/landing/earth.webm" type="video/webm" />
          <source src="/images/landing/earth.mp4" type="video/mp4" />
        </video>
        {/* frax.com's own treatment: an even dark wash, then a fade into the page below */}
        <div aria-hidden className="bg-ink/50 absolute inset-0 -z-10" />
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
              {/* UNCERTAIN: U-73 */}
              <p className="text-on-ink/80 max-w-xl text-base leading-relaxed lg:text-[19px] lg:leading-[1.55]">
                Skip the weeks of waiting on ASUC. Frax pays you in under 24 hours.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button asChild size="lg" variant="light" className="pr-2">
                  <Link href="/claims/new/">
                    <CtaLabel invert>Get reimbursed now</CtaLabel>
                  </Link>
                </Button>
                <Button asChild size="lg" variant="glass">
                  <Link href="/lend/">Lend to the pool</Link>
                </Button>
              </div>
            </motion.div>
        </div>
        <ClubLogoStrip />
    </section>
  );
}
