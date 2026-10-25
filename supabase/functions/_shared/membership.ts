import type { Db, Wallet } from "./db/types.ts";

/** The caller's organization, in the shape `me` and the membership function return. */
export async function membershipFor(db: Db, wallet: Wallet) {
  const member = await db.getMember(wallet);
  if (!member) return null;
  const org = await db.getOrg(member.orgId);
  if (!org) return null;
  const agents = await db.listFinanceAgents(org.id);
  return {
    orgId: org.id,
    name: org.name,
    joinCode: org.joinCode,
    active: org.active,
    financeAgent: member.financeAgent,
    roleTitle: member.roleTitle,
    peerFinanceAgents: agents.filter((agent) => agent !== wallet).length,
  };
}
