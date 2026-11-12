import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { JobPollingService } from '../../core/job-polling.service';
import { DocumentOut, JobOut, UploadResponse } from '../../core/models';
import { JobProgressComponent } from '../../shared/job-progress/job-progress.component';
import { DeleteConfirmDialogComponent } from './delete-confirm-dialog.component';
import { DocumentUploadComponent } from './document-upload.component';

interface UploadJob {
  jobId: string;
  filename: string;
  job: JobOut | null;
  pollError: string | null;
}

interface PendingDelete {
  doc: DocumentOut;
  timer: ReturnType<typeof setTimeout>;
}

/** Window (ms) in which a delete can be undone before the real DELETE fires. */
const UNDO_WINDOW_MS = 5000;

/**
 * Document library: upload, live ingest progress, and the Material table of
 * documents. Delete is optimistic with a 5-second snackbar Undo — the row
 * disappears immediately and the API call only fires after the window, so a
 * slip of the mouse costs nothing. If the DELETE itself fails, the row comes
 * back with an error message.
 */
@Component({
  selector: 'app-documents-page',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    JobProgressComponent,
    DocumentUploadComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Documents</h1>

    <app-document-upload (uploaded)="onUploaded($event)" />

    @if (uploadJobs().length > 0) {
      <section aria-label="Uploads in progress">
        @for (upload of uploadJobs(); track upload.jobId) {
          <div class="upload-job">
            @if (upload.job) {
              <app-job-progress [job]="upload.job" [filename]="upload.filename" />
            } @else if (upload.pollError) {
              <p class="error" role="alert">
                Could not track ingestion for {{ upload.filename }}:
                {{ upload.pollError }}
              </p>
            } @else {
              <p role="status">Starting ingestion for {{ upload.filename }}…</p>
            }
            @if (upload.job?.status === 'ready' || upload.job?.status === 'failed') {
              <button mat-button (click)="dismissUpload(upload.jobId)">
                Dismiss
              </button>
            }
          </div>
        }
      </section>
    }

    @if (loading()) {
      <p role="status"><mat-spinner diameter="24"></mat-spinner> Loading documents…</p>
    } @else if (error()) {
      <p class="error" role="alert">
        {{ error() }}
        <button mat-button (click)="loadDocuments()">Retry</button>
      </p>
    } @else if (documents().length === 0) {
      <p role="status">No documents yet — upload a PDF to get started.</p>
    } @else {
      <table mat-table [dataSource]="documents()" class="docs-table" aria-label="Documents">
        <ng-container matColumnDef="filename">
          <th mat-header-cell *matHeaderCellDef>File</th>
          <td mat-cell *matCellDef="let doc">{{ doc.filename }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Status</th>
          <td mat-cell *matCellDef="let doc">
            <mat-chip [highlighted]="doc.status === 'ready'">{{ doc.status }}</mat-chip>
          </td>
        </ng-container>
        <ng-container matColumnDef="parser">
          <th mat-header-cell *matHeaderCellDef>Parser</th>
          <td mat-cell *matCellDef="let doc">{{ doc.parser ?? '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="chunk_count">
          <th mat-header-cell *matHeaderCellDef>Chunks</th>
          <td mat-cell *matCellDef="let doc">{{ doc.chunk_count ?? '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="created_at">
          <th mat-header-cell *matHeaderCellDef>Uploaded</th>
          <td mat-cell *matCellDef="let doc">{{ doc.created_at | date: 'short' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>Actions</th>
          <td mat-cell *matCellDef="let doc">
            <button
              mat-button
              color="primary"
              [disabled]="doc.status !== 'ready'"
              (click)="openChat(doc)"
              [attr.aria-label]="'Chat with ' + doc.filename"
            >
              <mat-icon>chat</mat-icon> Chat
            </button>
            <button
              mat-button
              [disabled]="doc.status !== 'ready'"
              (click)="openSummary(doc)"
              [attr.aria-label]="'Summarize ' + doc.filename"
            >
              <mat-icon>subject</mat-icon> Summary
            </button>
            <button
              mat-icon-button
              color="warn"
              (click)="confirmDelete(doc)"
              [attr.aria-label]="'Delete ' + doc.filename"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
      </table>
    }
  `,
  styles: [
    `
      .docs-table {
        width: 100%;
      }
      .upload-job {
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 8px;
        padding: 0 16px 8px;
        margin-bottom: 12px;
      }
      .error {
        color: #b3261e;
      }
    `,
  ],
})
export class DocumentsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly polling = inject(JobPollingService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly displayedColumns = [
    'filename',
    'status',
    'parser',
    'chunk_count',
    'created_at',
    'actions',
  ];

  readonly documents = signal<DocumentOut[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly uploadJobs = signal<UploadJob[]>([]);

  private readonly pendingDeletes = new Map<string, PendingDelete>();

  ngOnInit(): void {
    this.loadDocuments();
  }

  loadDocuments(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .listDocuments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (docs) => {
          this.documents.set(docs);
          this.loading.set(false);
        },
        error: (err: Error) => {
          this.error.set(err.message);
          this.loading.set(false);
        },
      });
  }

  onUploaded(event: { response: UploadResponse; filename: string }): void {
    const { response, filename } = event;
    this.uploadJobs.update((jobs) => [
      ...jobs,
      { jobId: response.job_id, filename, job: null, pollError: null },
    ]);
    this.polling
      .pollJob(response.job_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (job) => {
          this.uploadJobs.update((jobs) =>
            jobs.map((j) => (j.jobId === job.id ? { ...j, job } : j)),
          );
          if (job.status === 'ready') {
            this.loadDocuments();
          }
        },
        error: (err: Error) => {
          this.uploadJobs.update((jobs) =>
            jobs.map((j) =>
              j.jobId === response.job_id ? { ...j, pollError: err.message } : j,
            ),
          );
        },
      });
  }

  dismissUpload(jobId: string): void {
    this.uploadJobs.update((jobs) => jobs.filter((j) => j.jobId !== jobId));
  }

  openChat(doc: DocumentOut): void {
    void this.router.navigate(['/chat', doc.id]);
  }

  openSummary(doc: DocumentOut): void {
    void this.router.navigate(['/summary', doc.id]);
  }

  confirmDelete(doc: DocumentOut): void {
    const ref = this.dialog.open(DeleteConfirmDialogComponent, {
      data: { filename: doc.filename },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) {
          this.startDelete(doc);
        }
      });
  }

  private startDelete(doc: DocumentOut): void {
    // Optimistic removal; the real DELETE fires after the undo window.
    this.documents.update((docs) => docs.filter((d) => d.id !== doc.id));
    const timer = setTimeout(() => this.commitDelete(doc), UNDO_WINDOW_MS);
    this.pendingDeletes.set(doc.id, { doc, timer });
    const snackRef = this.snackBar.open(`Deleted ${doc.filename}`, 'Undo', {
      duration: UNDO_WINDOW_MS,
    });
    snackRef
      .onAction()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.undoDelete(doc.id));
  }

  private undoDelete(docId: string): void {
    const pending = this.pendingDeletes.get(docId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingDeletes.delete(docId);
    this.documents.update((docs) =>
      [...docs, pending.doc].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }

  private commitDelete(doc: DocumentOut): void {
    this.pendingDeletes.delete(doc.id);
    this.api
      .deleteDocument(doc.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.snackBar.open(`Deleted ${doc.filename}`, 'Dismiss', { duration: 3000 });
        },
        error: (err: Error) => {
          // The delete failed server-side: put the row back, say so.
          this.documents.update((docs) =>
            [...docs, doc].sort((a, b) => b.created_at.localeCompare(a.created_at)),
          );
          this.snackBar.open(`Could not delete ${doc.filename}: ${err.message}`, 'Dismiss', {
            duration: 6000,
          });
        },
      });
  }
}
