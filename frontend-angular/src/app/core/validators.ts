import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { catchError, first, map, Observable, of } from 'rxjs';
import { ApiService } from './api.service';

/** Sync validator: the selected file must be a PDF (extension or MIME type). */
export function pdfFileValidator(control: AbstractControl): ValidationErrors | null {
  const file = control.value as File | null;
  if (!file) {
    return null;
  }
  const isPdf =
    file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
  return isPdf ? null : { notPdf: true };
}

/**
 * Async validator: the filename must not already exist in the document
 * library. Runs against GET /documents after the sync validators pass.
 * If the check itself fails (API down), it passes — a failed uniqueness
 * check must not block an upload; the backend is the final authority.
 */
export function uniqueFilenameValidator(api: ApiService): AsyncValidatorFn {
  return (control: AbstractControl): Observable<ValidationErrors | null> => {
    const file = control.value as File | null;
    if (!file) {
      return of(null);
    }
    return api.listDocuments().pipe(
      map((docs) =>
        docs.some((d) => d.filename.toLowerCase() === file.name.toLowerCase())
          ? { filenameTaken: { filename: file.name } }
          : null,
      ),
      catchError(() => of(null)),
      first(),
    );
  };
}
