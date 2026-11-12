import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { DocumentOut, SummaryResponse } from '../../core/models';
import { DocumentCardComponent } from '../../shared/document-card/document-card.component';

/**
 * Document summary. The backend caches the summary on the document row, so
 * repeat visits are instant — the "Cached" chip says which one you got.
 * Generating a fresh summary calls the LLM, so it can take a while and can
 * fail if no provider is configured; the error is shown, not swallowed.
 */
@Component({
  selector: 'app-summary-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DocumentCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (docLoading()) {
      <p role="status"><mat-spinner diameter="24"></mat-spinner> Loading document…</p>
    } @else if (docError()) {
      <p class="error" role="alert">
        {{ docError() }}
        <button mat-button (click)="goToDocuments()">Back to documents</button>
      </p>
    } @else if (doc()) {
      <app-document-card [document]="doc()!" [showActions]="false" />

      <button
        mat-raised-button
        color="primary"
        (click)="generate()"
        [disabled]="generating() || doc()!.status !== 'ready'"
      >
        @if (generating()) {
          <mat-spinner diameter="18"></mat-spinner>
        } @else {
          <mat-icon>subject</mat-icon>
        }
        {{ generating() ? 'Summarizing…' : (summary() ? 'Regenerate summary' : 'Generate summary') }}
      </button>

      @if (summary()) {
        <mat-card class="summary-card">
          <mat-card-header>
            <mat-card-title>Summary</mat-card-title>
            <mat-card-subtitle>
              @if (summary()!.model) {
                <span>Model: {{ summary()!.model }}</span>
              }
            </mat-card-subtitle>
          </mat-card-header>
          <mat-card-content>
            <mat-chip-set aria-label="Summary status">
              @if (summary()!.cached) {
                <mat-chip highlighted>Cached — generated earlier</mat-chip>
              } @else {
                <mat-chip>Freshly generated</mat-chip>
              }
            </mat-chip-set>
            <p class="summary-text">{{ summary()!.summary }}</p>
          </mat-card-content>
        </mat-card>
      } @else if (!generating()) {
        <p class="hint">
          No summary yet. Generating one reads the document's chunks and asks
          the answering model to condense them.
        </p>
      }
    }
  `,
  styles: [
    `
      .summary-card {
        margin-top: 16px;
      }
      .summary-text {
        white-space: pre-wrap;
        margin-top: 12px;
      }
      .hint {
        color: rgba(0, 0, 0, 0.6);
        margin-top: 16px;
      }
      .error {
        color: #b3261e;
      }
    `,
  ],
})
export class SummaryPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly doc = signal<DocumentOut | null>(null);
  readonly docLoading = signal(true);
  readonly docError = signal<string | null>(null);
  readonly summary = signal<SummaryResponse | null>(null);
  readonly generating = signal(false);

  private docId = '';

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('docId') ?? ''),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((docId) => {
        this.docId = docId;
        this.summary.set(null);
        this.loadDocument(docId);
      });
  }

  goToDocuments(): void {
    void this.router.navigate(['/documents']);
  }

  generate(): void {
    this.generating.set(true);
    this.api
      .summarize(this.docId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary);
          this.generating.set(false);
        },
        error: (err: Error) => {
          this.generating.set(false);
          this.snackBar.open(`Could not summarize: ${err.message}`, 'Dismiss', {
            duration: 6000,
          });
        },
      });
  }

  private loadDocument(docId: string): void {
    // No GET /documents/{id} endpoint: find the document in the library list.
    this.docLoading.set(true);
    this.docError.set(null);
    this.api
      .listDocuments()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (docs) => {
          const found = docs.find((d) => d.id === docId) ?? null;
          this.doc.set(found);
          this.docLoading.set(false);
          if (!found) {
            this.docError.set('Document not found — it may have been deleted.');
          }
        },
        error: (err: Error) => {
          this.docError.set(err.message);
          this.docLoading.set(false);
        },
      });
  }
}
