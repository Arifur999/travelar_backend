import { env } from "../../config/env.js";
import { Role, UserStatus } from "../../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

/**
 * Creates the platform operator on first boot.
 *
 * The super admin belongs to no agency — it is the account that manages
 * tenants, not one that lives inside one. That is why agencyId stays null and
 * every tenant guard short-circuits for this role.
 *
 * Safe to run on every start: it does nothing once one exists.
 */
export const seedSuperAdmin = async () => {
  const existing = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN, isDeleted: false },
  });

  if (existing) return;

  let createdUserId: string | null = null;

  try {
    const signUp = await auth.api.signUpEmail({
      body: {
        name: env.SUPER_ADMIN_NAME,
        email: env.SUPER_ADMIN_EMAIL,
        password: env.SUPER_ADMIN_PASSWORD,
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        agencyId: null,
        needPasswordChange: false,
        isDeleted: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    createdUserId = signUp.user.id;

    // better-auth writes its defaults on sign-up, so the role has to be set
    // explicitly afterwards — and the operator never has an email to verify.
    await prisma.user.update({
      where: { id: signUp.user.id },
      data: { role: Role.SUPER_ADMIN, emailVerified: true, agencyId: null },
    });

    console.log(`Seeded super admin: ${env.SUPER_ADMIN_EMAIL}`);
  } catch (error) {
    // A half-created operator would block every later boot from trying again.
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } }).catch(() => undefined);
    }
    console.error("Failed to seed the super admin:", error);
  }
};
