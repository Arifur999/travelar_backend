import status from "http-status";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";

type Tx = Prisma.TransactionClient;

/**
 * Takes a row lock so a "read the total, then decide" guard actually holds.
 *
 * Reading inside a transaction is not enough. Under PostgreSQL's default READ
 * COMMITTED isolation two concurrent transactions both see the world as it was
 * before either started, and inserts do not conflict — so every simultaneous
 * payment summed the same total, passed the same check and committed. A 1,000
 * ticket took 2,000, and a 1,000 account was transferred out five times.
 *
 * Locking the parent row first makes those transactions queue: the second one
 * blocks here until the first commits, and then sums a total that includes it.
 *
 * INVARIANT: every writer takes at most ONE row lock, always the row the guard
 * is about — the source account for a transfer, the ticket/case/booking for a
 * payment. Nothing therefore holds one lock while waiting for another, so this
 * cannot deadlock. Keep it that way; a second lock needs a global ordering.
 */

/**
 * The physical table for each lockable parent. These must match the schema's
 * `@@map`, and `test/rowLock.test.ts` asserts every one of them exists with the
 * columns used below — a rename would otherwise turn the lock into a runtime
 * error nobody sees until two people click at once.
 */
export const LOCKABLE_ROWS = {
  cashAccount: { table: "cash_accounts", notFound: "Cash account not found" },
  ticket: { table: "tickets", notFound: "Ticket not found" },
  visaCase: { table: "visa_cases", notFound: "Visa case not found" },
  hajjBooking: { table: "hajj_bookings", notFound: "Booking not found" },
} as const;

export type LockableRow = keyof typeof LOCKABLE_ROWS;

/**
 * Locks one row for the rest of the caller's transaction. Must be called with
 * the transaction client — on the shared client it would lock and immediately
 * release, which is no lock at all.
 *
 * Throws the same 404 the caller's own lookup would, so a row belonging to
 * another agency is indistinguishable from one that does not exist.
 */
export const lockRow = async (client: Tx, kind: LockableRow, id: string, agencyId: string) => {
  const { table, notFound } = LOCKABLE_ROWS[kind];

  // Prisma.raw is safe here: the table name comes from the map above, never
  // from a caller. The id and agencyId are bound parameters.
  const rows = await client.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)}
               WHERE id = ${id} AND "agencyId" = ${agencyId} AND "isDeleted" = false
               FOR UPDATE`,
  );

  if (rows.length === 0) throw new AppError(status.NOT_FOUND, notFound);
};
