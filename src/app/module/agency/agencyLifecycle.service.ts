import { Prisma } from "../../../generated/prisma/client.js";
import { AgencyReminderKind, AgencyStatus, Role, UserStatus } from "../../../generated/prisma/enums.js";
import { env } from "../../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { sendEmail } from "../../utils/email.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * An expiry older than this gets its status fixed but no email. Without the
 * cut-off, switching the job on for the first time — or after a long outage —
 * would email every agency that lapsed months ago.
 */
const EXPIRED_NOTICE_WINDOW = 3 * DAY;

/**
 * Moves agencies whose trial or paid period has run out to EXPIRED.
 *
 * Access never depended on this — requireActiveSubscription and
 * getMyFeatures compare the dates themselves — but the operator console,
 * status filters and MRR read the stored status, and until now it only
 * changed when someone happened to open the platform overview.
 */
const expireLapsedAgencies = async (now = new Date()) => {
  const result = await prisma.agency.updateMany({
    where: {
      isDeleted: false,
      OR: [
        { status: AgencyStatus.TRIAL, trialEndsAt: { lt: now } },
        { status: AgencyStatus.ACTIVE, subscriptionEndsAt: { lt: now } },
      ],
    },
    data: { status: AgencyStatus.EXPIRED },
  });
  return result.count;
};

const formatDay = (date: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dhaka" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day} ${parts.month} ${parts.year}`;
};

const COPY: Record<AgencyReminderKind, (agencyName: string, endsOn: string) => { subject: string; headline: string; body: string }> = {
  TRIAL_ENDING_3_DAYS: (agencyName, endsOn) => ({
    subject: `Your Travelar trial ends on ${endsOn}`,
    headline: "Your free trial is ending soon",
    body: `The trial for ${agencyName} ends on ${endsOn}. Choose a plan before then to keep every module working — your tickets, customers and accounts all stay exactly as they are.`,
  }),
  TRIAL_ENDING_1_DAY: (agencyName, endsOn) => ({
    subject: `Your Travelar trial ends tomorrow (${endsOn})`,
    headline: "Your free trial ends tomorrow",
    body: `The trial for ${agencyName} ends on ${endsOn}. After that the workspace becomes read-only until a plan is chosen: you can still see everything, but nothing new can be recorded.`,
  }),
  SUBSCRIPTION_ENDING_7_DAYS: (agencyName, endsOn) => ({
    subject: `Your Travelar subscription ends on ${endsOn}`,
    headline: "Your subscription is ending soon",
    body: `The paid period for ${agencyName} ends on ${endsOn}. Renew before then to avoid any interruption.`,
  }),
  SUBSCRIPTION_ENDING_1_DAY: (agencyName, endsOn) => ({
    subject: `Your Travelar subscription ends tomorrow (${endsOn})`,
    headline: "Your subscription ends tomorrow",
    body: `The paid period for ${agencyName} ends on ${endsOn}. Renew now so your team can keep recording sales and payments without a break.`,
  }),
  EXPIRED: (agencyName, endsOn) => ({
    subject: `${agencyName} is now read-only on Travelar`,
    headline: "Your workspace is read-only",
    body: `The ${agencyName} workspace lapsed on ${endsOn}. Your data is safe and can still be viewed, but changes are disabled until you choose a plan.`,
  }),
};

interface Candidate {
  agencyId: string;
  agencyName: string;
  kind: AgencyReminderKind;
  periodEndsAt: Date;
}

/** Which one reminder, if any, each agency is due right now. */
const findDueReminders = async (now: Date): Promise<Candidate[]> => {
  const [trials, paid, expired] = await Promise.all([
    prisma.agency.findMany({
      where: { isDeleted: false, status: AgencyStatus.TRIAL, trialEndsAt: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
      select: { id: true, name: true, trialEndsAt: true },
    }),
    prisma.agency.findMany({
      where: { isDeleted: false, status: AgencyStatus.ACTIVE, subscriptionEndsAt: { gt: now, lte: new Date(now.getTime() + 7 * DAY) } },
      select: { id: true, name: true, subscriptionEndsAt: true },
    }),
    prisma.agency.findMany({
      where: { isDeleted: false, status: AgencyStatus.EXPIRED },
      select: { id: true, name: true, trialEndsAt: true, subscriptionEndsAt: true },
    }),
  ]);

  const candidates: Candidate[] = [];

  // Only the most urgent reminder that applies. If the job was down through
  // the 3-day window, the agency gets the 1-day one, not both at once.
  for (const agency of trials) {
    const left = agency.trialEndsAt!.getTime() - now.getTime();
    candidates.push({
      agencyId: agency.id,
      agencyName: agency.name,
      kind: left <= DAY ? AgencyReminderKind.TRIAL_ENDING_1_DAY : AgencyReminderKind.TRIAL_ENDING_3_DAYS,
      periodEndsAt: agency.trialEndsAt!,
    });
  }

  for (const agency of paid) {
    const left = agency.subscriptionEndsAt!.getTime() - now.getTime();
    candidates.push({
      agencyId: agency.id,
      agencyName: agency.name,
      kind: left <= DAY ? AgencyReminderKind.SUBSCRIPTION_ENDING_1_DAY : AgencyReminderKind.SUBSCRIPTION_ENDING_7_DAYS,
      periodEndsAt: agency.subscriptionEndsAt!,
    });
  }

  for (const agency of expired) {
    // The period that lapsed is the later of the two end dates already past.
    const ended = [agency.trialEndsAt, agency.subscriptionEndsAt]
      .filter((date): date is Date => date !== null && date.getTime() <= now.getTime())
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!ended || now.getTime() - ended.getTime() > EXPIRED_NOTICE_WINDOW) continue;

    candidates.push({ agencyId: agency.id, agencyName: agency.name, kind: AgencyReminderKind.EXPIRED, periodEndsAt: ended });
  }

  return candidates;
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/**
 * Claims a reminder, then emails the agency's admins. The claim is an insert
 * against a unique (agency, kind, period end) key, so when two instances run
 * the job together exactly one of them sends.
 */
const deliver = async (candidate: Candidate): Promise<{ claimed: boolean; sent: number }> => {
  let reminderId: string;
  try {
    const reminder = await prisma.agencyReminder.create({
      data: { agencyId: candidate.agencyId, kind: candidate.kind, periodEndsAt: candidate.periodEndsAt },
      select: { id: true },
    });
    reminderId = reminder.id;
  } catch (error) {
    // Already sent — by an earlier run or by another instance right now.
    if (isUniqueViolation(error)) return { claimed: false, sent: 0 };
    throw error;
  }

  const admins = await prisma.user.findMany({
    where: { agencyId: candidate.agencyId, role: Role.AGENCY_ADMIN, status: UserStatus.ACTIVE, isDeleted: false },
    select: { email: true, name: true },
  });

  const endsOn = formatDay(candidate.periodEndsAt);
  const copy = COPY[candidate.kind](candidate.agencyName, endsOn);
  const billingUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}/dashboard/billing`;

  let sent = 0;
  for (const admin of admins) {
    try {
      await sendEmail({
        to: admin.email,
        subject: copy.subject,
        templateName: "subscription-reminder",
        templateData: { name: admin.name, headline: copy.headline, body: copy.body, ctaUrl: billingUrl },
        text: `Hi ${admin.name},\n\n${copy.body}\n\nChoose a plan: ${billingUrl}`,
      });
      sent += 1;
    } catch (error) {
      // One bad address must not stop the rest; the claim stays, so a broken
      // mailbox is not retried every hour.
      console.error(`Subscription reminder to ${admin.email} failed:`, error);
    }
  }

  await prisma.agencyReminder.update({ where: { id: reminderId }, data: { recipients: sent } });
  return { claimed: true, sent };
};

export interface ILifecycleRunSummary {
  expired: number;
  reminders: number;
  emails: number;
  ranAt: Date;
}

/** One full pass: fix statuses first, so the EXPIRED notice sees them. */
const runSubscriptionLifecycle = async (now = new Date()): Promise<ILifecycleRunSummary> => {
  const expired = await expireLapsedAgencies(now);
  const candidates = await findDueReminders(now);

  let reminders = 0;
  let emails = 0;
  for (const candidate of candidates) {
    try {
      const { claimed, sent } = await deliver(candidate);
      if (claimed) reminders += 1;
      emails += sent;
    } catch (error) {
      // One agency's failure must not stop the others.
      console.error(`Subscription reminder for agency ${candidate.agencyId} failed:`, error);
    }
  }

  return { expired, reminders, emails, ranAt: now };
};

export const AgencyLifecycleService = { expireLapsedAgencies, runSubscriptionLifecycle };
