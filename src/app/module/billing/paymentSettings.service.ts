import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";

/**
 * Where an agency sends a bKash subscription payment, and the QR it scans.
 *
 * Set by the operator from the admin screen. It used to be an environment
 * variable and a file committed into the web app, which meant changing the
 * number a subscription is paid into took a deploy and an SSH session — for a
 * value that belongs to whoever runs the platform, not to whoever ships it.
 */

/** One row, always. */
const SINGLETON = "singleton";

/** A QR is a small image. Anything larger is somebody uploading the wrong file. */
const MAX_QR_BYTES = 2 * 1024 * 1024;

const ALLOWED_QR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Digits, spaces and the odd +88 an operator will paste. */
const PHONE = /^[\d\s+-]{11,20}$/;

const read = async () =>
  prisma.platformSetting.findUnique({ where: { id: SINGLETON } });

/**
 * What the operator sees on the settings screen.
 *
 * Never the image itself: it is served from its own endpoint so the browser
 * can cache it and the JSON stays small.
 */
const getForOperator = async () => {
  const settings = await read();

  return {
    bkashNumber: settings?.bkashNumber ?? "",
    hasQr: Boolean(settings?.bkashQrData),
    qrSetAt: settings?.bkashQrSetAt ?? null,
    updatedAt: settings?.updatedAt ?? null,
  };
};

/**
 * What an agency's payment dialog needs.
 *
 * `available` is the one thing the screen branches on: both the number and the
 * QR have to be there, because half a set of payment instructions is worse
 * than none — somebody will send money to a number with no reference, or scan
 * a code and not know what to type back.
 */
const getForPayer = async () => {
  const settings = await read();
  const number = settings?.bkashNumber?.trim() ?? "";
  const hasQr = Boolean(settings?.bkashQrData);

  return {
    number,
    hasQr,
    available: number.length > 0 && hasQr,
  };
};

/** The QR itself, with the type it was uploaded as. */
const getQr = async () => {
  const settings = await read();
  if (!settings?.bkashQrData || !settings.bkashQrType) {
    throw new AppError(status.NOT_FOUND, "No bKash QR has been uploaded yet");
  }

  return { data: Buffer.from(settings.bkashQrData), contentType: settings.bkashQrType };
};

const setNumber = async (bkashNumber: string, user: IRequestUser) => {
  const number = bkashNumber.trim();
  if (number.length > 0 && !PHONE.test(number)) {
    throw new AppError(status.BAD_REQUEST, "That does not look like a bKash number");
  }

  await prisma.platformSetting.upsert({
    where: { id: SINGLETON },
    create: { id: SINGLETON, bkashNumber: number, updatedById: user.userId },
    update: { bkashNumber: number, updatedById: user.userId },
  });

  return getForOperator();
};

const setQr = async (
  file: { buffer: Buffer; mimetype: string; size: number },
  user: IRequestUser,
) => {
  if (!ALLOWED_QR_TYPES.has(file.mimetype)) {
    throw new AppError(status.BAD_REQUEST, "Upload the QR as a PNG, JPEG or WebP image");
  }
  if (file.size > MAX_QR_BYTES) {
    throw new AppError(status.BAD_REQUEST, "That image is larger than 2 MB — a QR should be small");
  }

  await prisma.platformSetting.upsert({
    where: { id: SINGLETON },
    create: {
      id: SINGLETON,
      bkashQrData: new Uint8Array(file.buffer),
      bkashQrType: file.mimetype,
      bkashQrSetAt: new Date(),
      updatedById: user.userId,
    },
    update: {
      bkashQrData: new Uint8Array(file.buffer),
      bkashQrType: file.mimetype,
      bkashQrSetAt: new Date(),
      updatedById: user.userId,
    },
  });

  return getForOperator();
};

export const PaymentSettingsService = {
  getForOperator,
  getForPayer,
  getQr,
  setNumber,
  setQr,
};
