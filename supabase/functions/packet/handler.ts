import { type NetworkConfig, requireDeployed } from "@app/config";
import type { Address } from "viem";
import { z } from "zod";
import { type TokenVerifier, requireCaller } from "../_shared/auth.ts";
import type { RegistryReads } from "../_shared/chain.ts";
import { loadClaim, requireClaimant, uuid } from "../_shared/claims.ts";
import { type Claim, type Db, UniqueViolation } from "../_shared/db/types.ts";
import { GUARANTY_TTL_SECONDS, guarantyTypedData } from "../_shared/guaranty.ts";
import { type Handler, conflict, json, methodNotAllowed, readJson } from "../_shared/http.ts";
import { type ClaimPacket, buildPacket, packetHash } from "../_shared/packet.ts";
import { requireKycApproved } from "../_shared/kyc.ts";

export type PacketDeps = { auth: TokenVerifier; db: Db; config: NetworkConfig; registry: RegistryReads; now?: () => Date };

const Body = z.strictObject({ claimId: uuid });

/** The EIP-712 guaranty for a frozen claim, with the guarantor's current nonce (SYSTEM_DESIGN 7). */
export async function typedDataFor(
  deps: { config: NetworkConfig; registry: RegistryReads },
  claim: Claim,
  now: Date,
) {
  if (!claim.packetHash || !claim.guarantorWallet) throw new Error("claim is not frozen");
  const deployed = requireDeployed(deps.config);
  const guarantor = claim.guarantorWallet as Address;
  return guarantyTypedData({
    chainId: deps.config.chainId,
    registry: deployed.claimRegistry,
    message: {
      guarantor,
      recipient: claim.recipientWallet as Address,
      orgId: BigInt(claim.orgId),
      faceValue: BigInt(claim.faceValue),
      requestedAmount: BigInt(claim.requestedAmount),
      packetHash: claim.packetHash,
      nonce: await deps.registry.guarantyNonce(guarantor),
      deadline: BigInt(Math.floor(now.getTime() / 1000) + GUARANTY_TTL_SECONDS),
    },
  });
}

/**
 * Freezes a draft into its canonical packet and returns `packetHash` with the guaranty typed data (FR-B4). Calling
 * it again returns the same hash with a fresh nonce and deadline.
 */
export function createPacketHandler(deps: PacketDeps): Handler {
  const now = deps.now ?? (() => new Date());
  const { db } = deps;
  return async (req) => {
    const caller = await requireCaller(req, deps);
    if (req.method !== "POST") throw methodNotAllowed(["POST"]);
    const { claimId } = await readJson(req, Body);
    let claim = await loadClaim(db, claimId);
    requireClaimant(caller, claim);
    requireKycApproved(caller.profile, "member");

    if (claim.packetHash === null) {
      if (claim.statusCache !== "Draft") throw conflict("only a draft can be frozen", "not_draft");
      if (!claim.guarantorWallet) throw conflict("choose a guarantor first", "no_guarantor");
      const docs = await db.listDocuments(claim.id);
      if (docs.length === 0) throw conflict("add at least one receipt", "no_documents");
      if (docs.some((d) => d.sha256 === null)) throw conflict("every receipt must finish uploading", "unconfirmed_documents");
      const packet = buildPacket({
        orgId: claim.orgId,
        recipient: claim.recipientWallet,
        faceValue: claim.faceValue,
        callinkPrNumber: claim.callinkPrNumber,
        documentHashes: docs.map((d) => d.sha256 as string),
        createdAt: claim.createdAt,
      });
      try {
        claim = await db.updateClaim(claim.id, { packetJson: packet, packetHash: packetHash(packet) });
      } catch (error) {
        if (error instanceof UniqueViolation) throw conflict("another claim already has this packet", "duplicate_packet");
        throw error;
      }
    }

    return json({
      packetHash: claim.packetHash,
      packet: claim.packetJson as ClaimPacket,
      typedData: await typedDataFor(deps, claim, now()),
    });
  };
}
