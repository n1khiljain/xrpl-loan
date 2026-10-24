import { parseAbi } from "viem";

/**
 * The parts of LayerZero V2 `IOFT` (and OFTCore's public `token()` and `approvalRequired()`) that the Mesh cash-out
 * calls. This is LayerZero's interface, not one of our contracts, so it doesn't come from `@app/abi`.
 * https://github.com/LayerZero-Labs/devtools/blob/main/packages/oft-evm/contracts/interfaces/IOFT.sol
 */
export const oftAbi = parseAbi([
  "struct SendParam { uint32 dstEid; bytes32 to; uint256 amountLD; uint256 minAmountLD; bytes extraOptions; bytes composeMsg; bytes oftCmd; }",
  "struct MessagingFee { uint256 nativeFee; uint256 lzTokenFee; }",
  "struct MessagingReceipt { bytes32 guid; uint64 nonce; MessagingFee fee; }",
  "struct OFTLimit { uint256 minAmountLD; uint256 maxAmountLD; }",
  "struct OFTFeeDetail { int256 feeAmountLD; string description; }",
  "struct OFTReceipt { uint256 amountSentLD; uint256 amountReceivedLD; }",
  "function token() view returns (address)",
  "function approvalRequired() view returns (bool)",
  "function sharedDecimals() view returns (uint8)",
  "function quoteOFT(SendParam _sendParam) view returns (OFTLimit, OFTFeeDetail[], OFTReceipt)",
  "function quoteSend(SendParam _sendParam, bool _payInLzToken) view returns (MessagingFee)",
  "function send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) payable returns (MessagingReceipt, OFTReceipt)",
]);

/** LayerZero V2 endpoint ID for Ethereum mainnet, where FraxNet liquidation addresses live. UNCERTAIN: U-53 */
export const ETHEREUM_EID = 30_101;
