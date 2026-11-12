import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

/**
 * Turns HTTP failures into plain Errors with a human-readable message.
 * FastAPI puts the reason in `detail` — a string for HTTPException, or an
 * array of {msg} objects for request-validation (422) errors. Network
 * failures (status 0) get a "can't reach the API" message instead of a
 * cryptic progress-event dump. Errors are never swallowed: the message
 * reaches the component, which decides how to show it.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: HttpErrorResponse) => throwError(() => new Error(toMessage(err)))),
  );

export function toMessage(err: HttpErrorResponse): string {
  if (err.status === 0) {
    return 'Cannot reach the API — is the backend running on localhost:8000?';
  }
  const detail: unknown = (err.error as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail) {
    return detail;
  }
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d as { msg?: unknown } | null)?.msg)
      .filter((m): m is string => typeof m === 'string');
    if (msgs.length > 0) {
      return msgs.join('; ');
    }
  }
  return `Request failed (${err.status} ${err.statusText})`.trim();
}
