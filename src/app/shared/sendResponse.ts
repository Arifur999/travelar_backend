import { Response } from "express";

interface IResponseData<T> {
  httpStatus: number;
  success: boolean;
  data?: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  message: string;
}

/// The single place a success response leaves the app. Envelope key order is
/// success, data, meta, message — the frontend's ApiResponse<T> mirrors it.
export const sendResponse = <T>(res: Response, responseData: IResponseData<T>) => {
  const { httpStatus, success, data, meta, message } = responseData;
  res.status(httpStatus).json({ success, data, meta, message });
};
