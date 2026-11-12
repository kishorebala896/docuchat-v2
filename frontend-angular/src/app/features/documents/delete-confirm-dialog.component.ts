import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';

export interface DeleteDialogData {
  filename: string;
}

/** Confirm dialog before a document delete. Confirming starts the 5-second
 * undo window on the documents page — the real DELETE only fires after it. */
@Component({
  selector: 'app-delete-confirm-dialog',
  standalone: true,
  imports: [MatButtonModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Delete document?</h2>
    <mat-dialog-content>
      <p>
        Delete <strong>{{ data.filename }}</strong>? This removes the document,
        its chunks, and its chat history. You will have 5 seconds to undo.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close(false)">Cancel</button>
      <button mat-button color="warn" (click)="close(true)" cdkFocusInitial>
        Delete
      </button>
    </mat-dialog-actions>
  `,
})
export class DeleteConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<DeleteConfirmDialogComponent, boolean>);
  readonly data = inject<DeleteDialogData>(MAT_DIALOG_DATA);

  close(confirmed: boolean): void {
    this.dialogRef.close(confirmed);
  }
}
