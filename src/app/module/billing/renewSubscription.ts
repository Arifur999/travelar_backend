import { addDays } from "date-fns";
import { Prisma } from "../../../generated/prisma/client.js";
import { AgencyStatus, PlanHistoryAction } from "../../../generated/prisma/enums.js";

/**
 * Extends a subscription from the later of now or its current end date, so
 * paying early never costs the agency the days it has already bought — and
 * sets the plan being paid for.
 *
 * This is the only renewal path. The old implementation had two that disagreed:
 * this one stacked, while the admin's assign-plan reset the end date to
 * now + duration and silently discarded whatever time was left.
 */
export const renewSubscription = async (
  client: Prisma.TransactionClient,
  agencyId: string,
  planId: string,
  durationDays: number,
  actorId: string | null,
  action: PlanHistoryAction,
) => {
  const agency = await client.agency.findUniqueOrThrow({ where: { id: agencyId } });

  const base =
    agency.subscriptionEndsAt && agency.subscriptionEndsAt.getTime() > Date.now()
      ? agency.subscriptionEndsAt
      : new Date();

  await client.agency.update({
    where: { id: agencyId },
    data: {
      // Paying for a plan puts the agency on that plan. The old code renewed
      // the dates but left planId untouched, so an agency that paid to upgrade
      // got more time on its old plan's features.
      planId,
      subscriptionEndsAt: addDays(base, durationDays),
      status: AgencyStatus.ACTIVE,
    },
  });

  await client.planHistory.create({
    data: { agencyId, planId, action, assignedById: actorId },
  });
};
