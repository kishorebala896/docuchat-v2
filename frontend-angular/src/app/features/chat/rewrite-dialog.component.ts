import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface RewriteDialogData {
  answer: string;
}

/**
 * Rewrite dialog for the feedback flywheel: the user corrects an answer,
 * and the corrected text is logged as a rewrite event (kind=rewrite) so it
 * can become a fine-tuning pair later. Typed Reactive Form, required text.
 */
@Component({
  selector: 'app-rewrite-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Rewrite this answer</h2>
    <mat-dialog-content>
      <p>
        Correct the answer below. Your version is saved as feedback for the
        answer above — it becomes a training signal, not a new chat turn.
      </p>
      <form [formGroup]="form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Corrected answer</mat-label>
          <textarea
            matInput
            formControlName="text"
            rows="6"
            cdkFocusInitial
            aria-label="Corrected answer"
          ></textarea>
          @if (form.controls.text.hasError('required') && form.controls.text.touched) {
            <mat-error>Write the corrected answer first.</mat-error>
          }
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Cancel</button>
      <button mat-button color="primary" [disabled]="form.invalid" (click)="save()">
        Save rewrite
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .full-width {
        width: 100%;
      }
      mat-dialog-content {
        min-width: 420px;
      }
    `,
  ],
})
export class RewriteDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<RewriteDialogComponent, string>);
  readonly data = inject<RewriteDialogData>(MAT_DIALOG_DATA);

  readonly form = new FormGroup({
    text: new FormControl(this.data.answer, {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  close(): void {
    this.dialogRef.close();
  }

  save(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.controls.text.value);
    }
  }
}
