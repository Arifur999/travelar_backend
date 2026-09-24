/**
 * Moves the platform operator onto a new email and password.
 *
 * Why this exists: seedSuperAdmin() only runs when no SUPER_ADMIN is present,
 * so editing SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD after the first boot
 * changes nothing. Once the operator account exists, this is the way to change
 * what signs into it — without deleting the row, and without a restart.
 *
 * It is run through deploy/set-operator.sh, which reads the values and pipes
 * them in. Input arrives on stdin rather than as arguments or environment, so
 * the password never reaches a process list, a shell history or docker
 * inspect. One value per line, in this order:
 *
 *   email
 *   password
 *   name          (optional, blank leaves it alone)
 *   moveHolderTo  (optional, blank refuses an address already taken)
 *
 * Lines rather than JSON because the caller is bash: quoting a password that
 * contains a backslash or a double quote into JSON is exactly where that goes
 * wrong, and a password cannot contain a newline.
 *
 * An address already held by somebody else is refused, because on a live
 * platform that somebody is a real agency. moveHolderTo says to move them
 * instead — deliberately, and naming where they go.
 */
import status from "http-status";
import { Role } from "../generated/prisma/enums.js";
import { auth } from "../app/lib/auth.js";
import { prisma } from "../app/lib/prisma.js";
import AppError from "../app/errorHelpers/AppError.js";

interface OperatorInput {
  email: string;
  password: string;
  name?: string;
  /** Where to move an existing holder of `email`, when there is one. */
  moveHolderTo?: string;
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const parseInput = (raw: string): OperatorInput => {
  // Only the trailing newline goes, plus a CR per line for a Windows terminal.
  // Nothing else is stripped from the password: a space at either end is a
  // character someone typed, and dropping it silently would lock them out.
  const lines = raw.replace(/\n$/, "").split("\n").map((line) => line.replace(/\r$/, ""));
  const [email = "", password = "", name = "", moveHolderTo = ""] = lines;

  if (!email.trim() || !email.includes("@")) {
    throw new AppError(status.BAD_REQUEST, "first line must be the operator's email address");
  }
  // The floor better-auth is configured with, checked here so the failure names
  // the field instead of surfacing as a hashing error.
  if (password.length < 8) {
    throw new AppError(
      status.BAD_REQUEST,
      "second line must be a password of at least 8 characters",
    );
  }

  return {
    email: email.trim(),
    password,
    name: name.trim() || undefined,
    moveHolderTo: moveHolderTo.trim() || undefined,
  };
};

const run = async () => {
  const input = parseInput(await readStdin());

  const operator = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN, isDeleted: false },
    select: { id: true, email: true },
  });

  if (!operator) {
    throw new AppError(
      status.NOT_FOUND,
      "no super admin exists. Restart the API and seedSuperAdmin() will create one from SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD.",
    );
  }

  const holder = await prisma.user.findFirst({
    where: { email: input.email, NOT: { id: operator.id } },
    select: { id: true, name: true, role: true, agency: { select: { name: true } } },
  });

  if (holder && !input.moveHolderTo) {
    throw new AppError(
      status.CONFLICT,
      `${input.email} already belongs to ${holder.name} (${holder.role}` +
        `${holder.agency ? `, agency "${holder.agency.name}"` : ""}). ` +
        "Choose another address for the operator, or give a fourth line saying where to move that account.",
    );
  }

  if (holder && input.moveHolderTo) {
    const aliasTaken = await prisma.user.findFirst({
      where: { email: input.moveHolderTo },
      select: { id: true },
    });
    if (aliasTaken) {
      throw new AppError(status.CONFLICT, `${input.moveHolderTo} is already in use as well`);
    }
  }

  // better-auth's own hasher, so sign-in verifies against the same algorithm.
  // A hash written by hand is how one of these ends up silently unusable.
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(input.password);

  const credential = await prisma.account.findFirst({
    where: { userId: operator.id, providerId: "credential" },
    select: { id: true },
  });

  // Freeing the address and taking it must not be separable: half of this
  // leaves either two accounts claiming one email or an operator with none.
  await prisma.$transaction(async (tx) => {
    if (holder && input.moveHolderTo) {
      await tx.user.update({ where: { id: holder.id }, data: { email: input.moveHolderTo } });
    }

    await tx.user.update({
      where: { id: operator.id },
      data: {
        email: input.email,
        emailVerified: true,
        ...(input.name ? { name: input.name } : {}),
      },
    });

    if (credential) {
      await tx.account.update({ where: { id: credential.id }, data: { password: hashed } });
    } else {
      // No credential row means the operator has only ever been an OAuth identity.
      await tx.account.create({
        data: {
          id: crypto.randomUUID(),
          accountId: operator.id,
          providerId: "credential",
          userId: operator.id,
          password: hashed,
        },
      });
    }

    // Whoever held the old password must not keep a live session.
    await tx.session.deleteMany({ where: { userId: operator.id } });
  });

  if (holder && input.moveHolderTo) {
    console.log(`moved ${holder.name} (${holder.role}) to ${input.moveHolderTo}`);
  }
  console.log(`operator is now ${input.email}; password set, sessions dropped`);
};

try {
  await run();
  await prisma.$disconnect();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exit(1);
}
