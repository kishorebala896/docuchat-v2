import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../core/api.service';
import { UploadResponse } from '../../core/models';
import { DropZoneDirective } from '../../core/drop-zone.directive';
import { pdfFileValidator, uniqueFilenameValidator } from '../../core/validators';

/**
 * PDF upload: drag-and-drop or file picker, with a typed Reactive Form.
 * Sync validation requires a PDF; the async validator checks the filename
 * against GET /documents so a duplicate upload is caught before it starts.
 * On success the parent starts job polling from the returned job id.
 */
@Component({
  selector: 'app-document-upload',
  standalone: true,
  imports: [
    DecimalPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DropZoneDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" class="upload-form">
      <div
        class="drop-zone"
        appDropZone
        (fileDropped)="onFile($event)"
        role="button"
        tabindex="0"
        aria-label="Drop a PDF here or press Enter to choose a file"
        (click)="fileInput().nativeElement.click()"
        (keydown.enter)="fileInput().nativeElement.click()"
      >
        <mat-icon aria-hidden="true">cloud_upload</mat-icon>
        <p>
          Drop a PDF here, or
          <button
            mat-button
            type="button"
            color="primary"
            (click)="$event.stopPropagation(); fileInput().nativeElement.click()"
          >
            choose a file
          </button>
        </p>
        <input
          #filePicker
          type="file"
          accept=".pdf,application/pdf"
          class="visually-hidden"
          aria-label="Choose a PDF file"
          (change)="onPickerChange($event)"
        />
      </div>

      @if (selectedFile()) {
        <p class="selected" role="status">
          Selected: <strong>{{ selectedFile()!.name }}</strong>
          ({{ selectedFile()!.size | number }} bytes)
        </p>
      }

      @if (fileControl.invalid && fileControl.touched) {
        <p class="error" role="alert">
          @if (fileControl.hasError('required')) {
            Choose a PDF file to upload.
          } @else if (fileControl.hasError('notPdf')) {
            Only PDF files are supported.
          } @else if (fileControl.hasError('filenameTaken')) {
            A document named "{{ fileControl.getError('filenameTaken').filename }}"
            is already in the library.
          }
        </p>
      }
      @if (fileControl.pending) {
        <p class="checking" role="status">
          <mat-spinner diameter="16"></mat-spinner> Checking filename…
        </p>
      }

      <button
        mat-raised-button
        color="primary"
        type="submit"
        [disabled]="form.invalid || form.pending || uploading()"
      >
        @if (uploading()) {
          <mat-spinner diameter="18"></mat-spinner>
        } @else {
          <mat-icon>upload</mat-icon>
        }
        {{ uploading() ? 'Uploading…' : 'Index document' }}
      </button>
    </form>
  `,
  styles: [
    `
      .upload-form {
        margin-bottom: 24px;
      }
      .drop-zone {
        border: 2px dashed rgba(0, 0, 0, 0.3);
        border-radius: 8px;
        padding: 24px;
        text-align: center;
        cursor: pointer;
      }
      .drop-zone.drag-over {
        border-color: #1565c0;
        background: #e3f2fd;
      }
      .drop-zone mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        color: rgba(0, 0, 0, 0.54);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      }
      .selected {
        margin: 12px 0 0;
      }
      .error {
        color: #b3261e;
        margin: 8px 0 0;
      }
      .checking {
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(0, 0, 0, 0.6);
      }
      button[type='submit'] {
        margin-top: 12px;
      }
    `,
  ],
})
export class DocumentUploadComponent {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly fileInput =
    viewChild.required<ElementRef<HTMLInputElement>>('filePicker');

  readonly uploaded = output<{ response: UploadResponse; filename: string }>();

  readonly uploading = signal(false);
  readonly selectedFile = signal<File | null>(null);

  readonly form = new FormGroup({
    file: new FormControl<File | null>(
      null,
      {
        validators: [Validators.required, pdfFileValidator],
        asyncValidators: [uniqueFilenameValidator(this.api)],
      },
    ),
  });

  get fileControl(): FormControl<File | null> {
    return this.form.controls.file;
  }

  onFile(file: File): void {
    this.selectedFile.set(file);
    this.fileControl.setValue(file);
    this.fileControl.markAsTouched();
  }

  onPickerChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      this.onFile(file);
    }
  }

  submit(): void {
    const file = this.fileControl.value;
    if (!file || this.form.invalid || this.uploading()) {
      this.fileControl.markAsTouched();
      return;
    }
    this.uploading.set(true);
    this.api
      .uploadDocument(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.uploading.set(false);
          this.uploaded.emit({ response, filename: file.name });
          this.form.reset();
          this.selectedFile.set(null);
          this.fileInput().nativeElement.value = '';
        },
        error: (err: Error) => {
          this.uploading.set(false);
          this.snackBar.open(`Upload failed: ${err.message}`, 'Dismiss', {
            duration: 6000,
          });
        },
      });
  }
}
