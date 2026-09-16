export interface IError {
  path: string;
  message: string;
}

export interface IErrorResponse {
  statusCode?: number;
  success: boolean;
  message: string;
  errorSource: IError[];
  /** Matches the x-request-id header; quoting it locates the request in the logs. */
  requestId?: string;
  error?: unknown;
  stack?: string;
}
