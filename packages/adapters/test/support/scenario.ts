import { claimRegistryAbi, mockFrxUsdAbi, orgRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { type Account, type Chain, type Hex, type Transport, type WalletClient, keccak256, parseEther, stringToHex } from "viem";
import type { Anvil, System } from "./anvil.ts";

type Wallet = WalletClient<Transport, Chain, Account>;

/** Role wallets from anvil's dev accounts. */
export function actors(anvil: Anvil) {
  return {
    admin: anvil.wallet(0),
    lender: anvil.wallet(1),
    claimant: anvil.wallet(2),
    officer: anvil.wallet(3),
    claimant2: anvil.wallet(4),
  };
}

export function scenario(anvil: Anvil, system: System) {
  const { publicClient } = anvil;
  const a = actors(anvil);

  async function send(hash: Promise<Hex>) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: await hash });
    if (receipt.status !== "success") throw new Error(`tx ${receipt.transactionHash} reverted`);
    return receipt;
  }

  async function mint(to: Wallet, amount: bigint) {
    await send(
      a.admin.writeContract({ address: system.frxUSD, abi: mockFrxUsdAbi, functionName: "mint", args: [to.account.address, amount] }),
    );
  }

  async function approveToken(from: Wallet, spender: `0x${string}`, amount: bigint) {
    await send(from.writeContract({ address: system.frxUSD, abi: mockFrxUsdAbi, functionName: "approve", args: [spender, amount] }));
  }

  return {
    ...a,
    send,
    mint,

    async addOrg(name: string) {
      await send(a.admin.writeContract({ address: system.orgRegistry, abi: orgRegistryAbi, functionName: "addOrg", args: [name] }));
      return publicClient.readContract({ address: system.orgRegistry, abi: orgRegistryAbi, functionName: "orgCount" });
    },

    async setOrgCap(orgId: bigint, cap: bigint) {
      await send(a.admin.writeContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "setOrgCap", args: [orgId, cap] }));
    },

    async setOfficer(orgId: bigint, officer: Wallet, active = true) {
      await send(
        a.admin.writeContract({
          address: system.orgRegistry,
          abi: orgRegistryAbi,
          functionName: "setOfficer",
          args: [orgId, officer.account.address, active],
        }),
      );
    },

    async deposit(lender: Wallet, amount: bigint) {
      await mint(lender, amount);
      await approveToken(lender, system.pool, amount);
      await send(
        lender.writeContract({
          address: system.pool,
          abi: receivablesPoolAbi,
          functionName: "deposit",
          args: [amount, lender.account.address],
        }),
      );
    },

    /** Signs a guaranty with the guarantor's current nonce and submits the claim as `recipient`. Returns its ID. */
    async submit(recipient: Wallet, guarantor: Wallet, orgId: bigint, faceValue: bigint, requestedAmount: bigint, label: string) {
      const packetHash = keccak256(stringToHex(label));
      const nonce = await publicClient.readContract({
        address: system.claimRegistry,
        abi: claimRegistryAbi,
        functionName: "nonces",
        args: [guarantor.account.address],
      });
      const block = await publicClient.getBlock();
      const deadline = block.timestamp + 3600n;
      const signature = await guarantor.signTypedData({
        domain: { name: "FraxCollegeClaimRegistry", version: "1", chainId: anvil.chain.id, verifyingContract: system.claimRegistry },
        types: {
          Guaranty: [
            { name: "guarantor", type: "address" },
            { name: "recipient", type: "address" },
            { name: "orgId", type: "uint64" },
            { name: "faceValue", type: "uint128" },
            { name: "requestedAmount", type: "uint128" },
            { name: "packetHash", type: "bytes32" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Guaranty",
        message: {
          guarantor: guarantor.account.address,
          recipient: recipient.account.address,
          orgId,
          faceValue,
          requestedAmount,
          packetHash,
          nonce,
          deadline,
        },
      });
      await send(
        recipient.writeContract({
          address: system.claimRegistry,
          abi: claimRegistryAbi,
          functionName: "submitClaim",
          args: [
            { orgId, recipientType: 0, guarantor: guarantor.account.address, faceValue, requestedAmount, packetHash },
            deadline,
            signature,
          ],
        }),
      );
      return publicClient.readContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "claimCount" });
    },

    async approve(claimId: bigint, amount: bigint) {
      await send(
        a.admin.writeContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "approveClaim", args: [claimId, amount] }),
      );
    },

    async reject(claimId: bigint, code: string) {
      await send(
        a.admin.writeContract({
          address: system.claimRegistry,
          abi: claimRegistryAbi,
          functionName: "rejectClaim",
          args: [claimId, stringToHex(code, { size: 32 })],
        }),
      );
    },

    async cancel(recipient: Wallet, claimId: bigint) {
      await send(
        recipient.writeContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "cancelClaim", args: [claimId] }),
      );
    },

    async purchase(recipient: Wallet, claimId: bigint) {
      await send(
        recipient.writeContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "purchaseClaim", args: [claimId] }),
      );
    },

    async settle(payer: Wallet, claimId: bigint, amount: bigint) {
      await mint(payer, amount);
      await approveToken(payer, system.claimRegistry, amount);
      await send(
        payer.writeContract({ address: system.claimRegistry, abi: claimRegistryAbi, functionName: "settle", args: [claimId, amount] }),
      );
    },
  };
}

export const usd = (value: string) => parseEther(value);
