import { Response } from "express";
import { StatusCodes } from "http-status-codes";

export interface ApiResponsePayload<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data?: T | null;
  errorCode?: string;
  errors?: Array<{
    field?: string;
    message: string;
  }>;
}

export class ApiResponse {
  public static success<T>(
    res: Response,
    statusCode: StatusCodes,
    message: string,
    data?: T | null
  ): Response<ApiResponsePayload<T>> {
    const payload: ApiResponsePayload<T> = {
      success: true,
      statusCode,
      message,
      data: data || null
    };

    return res.status(statusCode).json(payload);
  }

  public static created<T>(
    res: Response,
    message: string,
    data?: T | null
  ): Response<ApiResponsePayload<T>> {
    return this.success(res, StatusCodes.CREATED, message, data);
  }

  public static ok<T>(
    res: Response,
    message: string,
    data?: T | null
  ): Response<ApiResponsePayload<T>> {
    return this.success(res, StatusCodes.OK, message, data);
  }

  public static badRequest(
    res: Response,
    message: string,
    errors?: Array<{ field?: string; message: string }>
  ): Response<ApiResponsePayload<null>> {
    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.BAD_REQUEST,
      message,
      data: null,
      errorCode: "BadRequest",
      errors
    };

    return res.status(StatusCodes.BAD_REQUEST).json(payload);
  }

  public static unauthorized(
    res: Response,
    message: string = "Unauthorized access"
  ): Response<ApiResponsePayload<null>> {
    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.UNAUTHORIZED,
      message,
      data: null,
      errorCode: "Unauthorized"
    };

    return res.status(StatusCodes.UNAUTHORIZED).json(payload);
  }

  public static forbidden(
    res: Response,
    message: string = "Access forbidden"
  ): Response<ApiResponsePayload<null>> {
    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.FORBIDDEN,
      message,
      data: null,
      errorCode: "Forbidden"
    };

    return res.status(StatusCodes.FORBIDDEN).json(payload);
  }

  public static notFound(
    res: Response,
    message: string = "Resource not found"
  ): Response<ApiResponsePayload<null>> {
    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.NOT_FOUND,
      message,
      data: null,
      errorCode: "NotFound"
    };

    return res.status(StatusCodes.NOT_FOUND).json(payload);
  }

  public static error<T = null>(
    res: Response,
    statusCode: StatusCodes,
    message: string,
    errorCode: string = "ServerError",
    data?: T | null
  ): Response<ApiResponsePayload<T>> {
    const payload: ApiResponsePayload<T> = {
      success: false,
      statusCode,
      message,
      errorCode,
      data: data || null
    };

    return res.status(statusCode).json(payload);
  }

  public static internalError(
    res: Response,
    message: string = "Internal server error"
  ): Response<ApiResponsePayload<null>> {
    const payload: ApiResponsePayload<null> = {
      success: false,
      statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
      message,
      data: null,
      errorCode: "InternalServerError"
    };

    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json(payload);
  }
}
