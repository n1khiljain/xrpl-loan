/** Every page shows this on an XRPL test network. */
export function TestnetBanner({ isTestnet }: { isTestnet: boolean }) {
  if (!isTestnet) return null;
  return (
    <div role="status" data-testid="testnet-banner" className="bg-highlight text-highlight-contrast relative z-50 px-4 py-1.5 text-center text-[13px] font-bold">
      XRPL test network. No real money moves.
    </div>
  );
}
