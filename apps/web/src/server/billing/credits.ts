import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import { action_credits } from '../db/schema';

/** Credit packs are currently inert while Cumulus billing is redesigned. */
export type CreditPackId = 'builder' | 'starter' | 'growth' | 'scale';

export const CREDIT_PACK_IDS: readonly CreditPackId[] = [
  'builder',
  'starter',
  'growth',
  'scale',
] as const;

export interface CreditPackDef {
  id: CreditPackId;
  plan: CreditPackId;
  actions: number;
  amountCents: number;
  effectiveCentsPerAction: number;
}

export const PACK_DEFS: Record<CreditPackId, CreditPackDef> = {
  builder: {
    id: 'builder',
    plan: 'builder',
    actions: 500,
    amountCents: 0,
    effectiveCentsPerAction: 0,
  },
  starter: {
    id: 'starter',
    plan: 'starter',
    actions: 5000,
    amountCents: 0,
    effectiveCentsPerAction: 0,
  },
  growth: {
    id: 'growth',
    plan: 'growth',
    actions: 25000,
    amountCents: 0,
    effectiveCentsPerAction: 0,
  },
  scale: {
    id: 'scale',
    plan: 'scale',
    actions: 100000,
    amountCents: 0,
    effectiveCentsPerAction: 0,
  },
};

export interface CreditSummaryItem {
  pack_id: CreditPackId;
  actions_purchased: number;
  actions_remaining: number;
  amount_cents_paid: number;
  expires_at: string;
  created_at: string;
}

export async function totalCreditsRemaining(tenantId: string): Promise<number> {
  const rows = await db
    .select({
      actions_remaining: action_credits.actions_remaining,
      expires_at: action_credits.expires_at,
    })
    .from(action_credits)
    .where(eq(action_credits.tenant_id, tenantId));
  const now = Date.now();
  return rows.reduce(
    (sum, row) =>
      row.expires_at.getTime() > now ? sum + row.actions_remaining : sum,
    0,
  );
}

export async function listCredits(tenantId: string): Promise<{
  credits: CreditSummaryItem[];
  total_remaining: number;
}> {
  const rows = await db
    .select()
    .from(action_credits)
    .where(eq(action_credits.tenant_id, tenantId))
    .orderBy(action_credits.expires_at);
  const now = Date.now();
  const credits = rows.map((row) => ({
    pack_id: row.pack_id as CreditPackId,
    actions_purchased: row.actions_purchased,
    actions_remaining: row.actions_remaining,
    amount_cents_paid: row.amount_cents_paid,
    expires_at: row.expires_at.toISOString(),
    created_at: row.created_at.toISOString(),
  }));
  return {
    credits,
    total_remaining: credits
      .filter((credit) => new Date(credit.expires_at).getTime() > now)
      .reduce((sum, credit) => sum + credit.actions_remaining, 0),
  };
}
