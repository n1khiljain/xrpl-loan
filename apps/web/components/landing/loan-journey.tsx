import { CardJourney } from "@/components/landing/card-journey";

/*
 * One loan, start to finish, on a Night panel: the loan card walks through its states (each its own flat colour and
 * glyph picture), flat and without glow, with the states as a progress row under it.
 */
export function LoanJourney() {
  return (
    <section aria-label="One loan, start to finish" className="bg-surface w-full">
      <div className="mx-auto w-full max-w-[1440px] px-4 py-16 sm:px-6 lg:px-10 lg:py-28">
        <div className="bg-ink text-on-ink relative isolate flex justify-center overflow-hidden rounded-3xl px-4 py-20 sm:px-8 lg:px-16 lg:py-28">
          <CardJourney />
        </div>
      </div>
    </section>
  );
}
