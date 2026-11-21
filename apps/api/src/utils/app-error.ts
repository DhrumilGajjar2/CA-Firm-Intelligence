export interface ErrorDetail {
  field?: string;
  message: string;
}

/** Throw from anywhere in a request; the global error handler turns it into the standard error body. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly errors: ErrorDetail[];

  constructor(
    statusCode: number,
    code: string,
    message: string,
    errors: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
  }

  static badRequest(message = "Bad request", errors?: ErrorDetail[]) {
    return new AppError(400, "BAD_REQUEST", message, errors);
  }
  static validation(errors: ErrorDetail[], message = "Validation failed") {
    return new AppError(400, "VALIDATION_ERROR", message, errors);
  }
  static unauthenticated(message = "Authentication required") {
    return new AppError(401, "UNAUTHENTICATED", message);
  }
  static forbidden(message = "You do not have permission to perform this action") {
    return new AppError(403, "FORBIDDEN", message);
  }
  static notFound(message = "Resource not found") {
    return new AppError(404, "NOT_FOUND", message);
  }
  static conflict(message = "Resource already exists") {
    return new AppError(409, "CONFLICT", message);
  }
  static unavailable(message = "Service unavailable") {
    return new AppError(503, "SERVICE_UNAVAILABLE", message);
  }
}
