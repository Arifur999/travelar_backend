export interface IError {
  path: string;
  message: string;
}

export interface IErrorResponse {
  statusCode?: number;
  success: boolean;
  message: string;
  errorSource: IError[];
  error?: unknown;
  stack?: string;
}
