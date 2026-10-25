import { FeatureGrid } from "@/components/landing/feature-grid";
import { LoanJourney } from "@/components/landing/loan-journey";
import { ProductShowcase } from "@/components/landing/product-showcase";

/** The feature band, one loan start to finish, then the app itself on both sides of a loan. */
export function Features() {
  return (
    <>
      <FeatureGrid />
      <LoanJourney />
      <ProductShowcase />
    </>
  );
}
