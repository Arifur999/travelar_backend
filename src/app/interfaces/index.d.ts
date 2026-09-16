import { IRequestUser } from "./requestUser.interface.js";

declare global {
  namespace Express {
    interface Request {
      user: IRequestUser;
      /** Per-request id, also returned as the x-request-id header. */
      id: string;
      /** performance.now() when the request arrived, for the access log. */
      startedAt: number;
    }
  }
}

export {};
