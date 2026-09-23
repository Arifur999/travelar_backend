import { createHash } from "node:crypto";
import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { ImportStage, ImportStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { FoundationsImportService } from "./foundations.service.js";
import { HistoryImportService } from "./history.service.js";
import { isImportableTab } from "./import.constant.js";
import { importMemoryProblem } from "./memoryLimit.js";
import { IImportProgress, IImportStarted } from "./import.interface.js";
import { ImportRunService } from "./importRun.service.js";
import { readWorkbook } from "./sheetReader.js";

/**
 * One upload, one button, one thing to undo.
 *
 * The two stages exist because the history refers to the lists by name, but
 * that is our problem, not the agency's: they have a spreadsheet and they want
 * their business in the app. So this runs both, back to back, against a single
 * import record.
 *
 * It does not run inside the request. A year of business is a few thousand
 * ledger postings and takes minutes, which is longer than any proxy between
 * the browser and this process will hold a connection open. The upload
 * therefore answers straight away with the id of a run that has already
 * started, and the screen watches that run: which step, how many rows of it,
 * and a percentage that means something because it is counted, not guessed.
 *
 * The cost of working outside the request is that a restart mid-run leaves a
 * run marked RUNNING for ever. That is why every row is written down as it is
 * created: a half-finished import is still a complete list of what it did, and
 * still reversible.
 */

/**
 * Every step, in the order they happen, which is what turns "row 1,240 of
 * 3,180 of the tickets" into a figure for the whole run.
 */
const STEPS = [
  "Accounts",
  "Expense categories",
  "Airlines",
  "Routes",
  "Suppliers",
  "Customers",
  "Owner investment",
  "Air tickets",
  "Customer collections",
  "Supplier payments",
  "Expenses",
  "Profit withdrawals",
] as const;

const fileHashOf = (file: Buffer) => createHash("sha256").update(file).digest("hex");

/**
 * A declared shape, on its way into a Json column.
 *
 * Prisma wants an index signature there and an interface has none. The cast is
 * the whole point of writing these as interfaces: the shape is checked where
 * it is built and where it is read, and only loses its name in the column.
 */
const asJson = (value: unknown) => value as Prisma.InputJsonValue;

const progressOf = (step: string, done: number, total: number): IImportProgress => {
  const stepNumber = Math.max(STEPS.indexOf(step as (typeof STEPS)[number]), 0) + 1;
  const withinStep = total > 0 ? Math.min(done / total, 1) : 1;

  return {
    step,
    stepNumber,
    stepCount: STEPS.length,
    done,
    total,
    // Steps are weighted equally. They are not equal — the tickets are most of
    // any real workbook — but a bar that moves steadily and finishes is worth
    // more than one that is accurate and appears to stall.
    percent: Math.min(99, Math.round(((stepNumber - 1 + withinStep) / STEPS.length) * 100)),
  };
};

/**
 * Writes progress to the run, but not on every row.
 *
 * Three thousand tickets would otherwise be three thousand extra updates
 * competing with the import's own writes. A percent only changes a hundred
 * times, so that is how often this writes.
 */
const reporterFor = (importId: string) => {
  let lastPercent = -1;
  let lastStep = "";

  return (step: string, done: number, total: number) => {
    const progress = progressOf(step, done, total);
    if (progress.percent === lastPercent && progress.step === lastStep) return;

    lastPercent = progress.percent;
    lastStep = progress.step;

    // Deliberately not awaited: progress is a courtesy to whoever is watching,
    // and the import must not wait on it or fail because of it.
    void prisma.dataImport
      .update({ where: { id: importId }, data: { progress: asJson(progress) } })
      .catch(() => undefined);
  };
};

const work = async (
  importId: string,
  agencyId: string,
  filename: string,
  file: Buffer,
  user: IRequestUser,
) => {
  try {
    // Read once, for both stages. Reading one of these workbooks is the most
    // expensive thing here by a wide margin, and doing it twice was enough to
    // put the process over the memory it is allowed and have it killed part of
    // the way through the import.
    const sheets = await readWorkbook(file, isImportableTab);
    const ctx = { importId, report: reporterFor(importId), sheets };

    const lists = await FoundationsImportService.importFoundations(agencyId, filename, file, user, ctx);
    const history = await HistoryImportService.importHistory(agencyId, filename, file, user, ctx);

    await prisma.dataImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.COMPLETED,
        counts: { ...lists.counts, ...history.counts },
        progress: asJson({ ...progressOf("Profit withdrawals", 1, 1), percent: 100 }),
        result: asJson({
          totals: history.totals,
          skipped: history.skipped,
          problems: history.problems,
        }),
      },
    });
  } catch (error) {
    // The rows it managed to write stay, and stay listed against this run, so
    // the owner can undo what happened or fix the sheet and upload it again —
    // the second run skips everything the first one already brought in.
    await prisma.dataImport
      .update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          note: error instanceof Error ? error.message : "The import stopped unexpectedly",
        },
      })
      .catch(() => undefined);
  }
};

/**
 * Starts a run and answers immediately.
 *
 * The same file twice is refused rather than merged. Every row would be
 * recognised and skipped, so nothing would break — but "0 created, 3,180
 * skipped" is a confusing answer to a button press, and the honest one is that
 * this workbook is already in.
 */
const start = async (
  agencyId: string,
  filename: string,
  file: Buffer,
  user: IRequestUser,
  options?: { force?: boolean },
): Promise<IImportStarted> => {
  if (!file || file.length === 0) throw new AppError(status.BAD_REQUEST, "The file is empty");

  // Checked before anything is written, because the alternative is the kernel
  // stopping it halfway with nothing on screen to explain why.
  const tooBig = importMemoryProblem(file.length);
  if (tooBig) throw new AppError(status.INSUFFICIENT_STORAGE, tooBig);

  // A run the server was killed in the middle of still says RUNNING, and would
  // block every import after it for ever.
  await ImportRunService.markStaleRuns(agencyId);

  const running = await prisma.dataImport.findFirst({
    where: { agencyId, status: ImportStatus.RUNNING },
    orderBy: { createdAt: "desc" },
  });
  if (running) {
    throw new AppError(
      status.CONFLICT,
      "An import is already running for this agency. Wait for it to finish before starting another.",
    );
  }

  const fileHash = fileHashOf(file);

  if (!options?.force) {
    const already = await prisma.dataImport.findFirst({
      where: { agencyId, fileHash, status: ImportStatus.COMPLETED },
      orderBy: { createdAt: "desc" },
    });

    if (already) {
      return { importId: already.id, alreadyImported: await ImportRunService.getRun(agencyId, already.id) };
    }
  }

  const run = await prisma.dataImport.create({
    data: {
      agencyId,
      filename,
      fileHash,
      stage: ImportStage.EVERYTHING,
      status: ImportStatus.RUNNING,
      counts: {},
      progress: asJson(progressOf(STEPS[0], 0, 0)),
      createdById: user.userId,
    },
  });

  void work(run.id, agencyId, filename, file, user);

  return { importId: run.id, alreadyImported: null };
};

export const ImportRunnerService = { start, STEPS };
