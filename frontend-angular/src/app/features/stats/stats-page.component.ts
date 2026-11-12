import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PercentPipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { ApiService } from '../../core/api.service';
import { StatsOut } from '../../core/models';

/**
 * Usage stats from the feedback flywheel's flight recorder: per-model,
 * per-day generations, abstention rate, negative-feedback rate, latency,
 * and token counts. The backend returns rates as 0–1 fractions.
 */
@Component({
  selector: 'app-stats-page',
  standalone: true,
  imports: [
    PercentPipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTableModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Usage stats</h1>

    <mat-form-field appearance="outline">
      <mat-label>Window</mat-label>
      <mat-select
        [formControl]="daysControl"
        (selectionChange)="loadStats()"
        aria-label="Stats window in days"
      >
        <mat-option [value]="7">Last 7 days</mat-option>
        <mat-option [value]="14">Last 14 days</mat-option>
        <mat-option [value]="30">Last 30 days</mat-option>
      </mat-select>
    </mat-form-field>

    @if (loading()) {
      <p role="status"><mat-spinner diameter="24"></mat-spinner> Loading stats…</p>
    } @else if (error()) {
      <p class="error" role="alert">
        {{ error() }}
        <button mat-button (click)="loadStats()">Retry</button>
      </p>
    } @else if (stats().length === 0) {
      <p role="status">No generations in this window yet — chat with a document first.</p>
    } @else {
      <table mat-table [dataSource]="stats()" class="stats-table" aria-label="Usage statistics">
        <ng-container matColumnDef="day">
          <th mat-header-cell *matHeaderCellDef>Day</th>
          <td mat-cell *matCellDef="let row">{{ row.day }}</td>
        </ng-container>
        <ng-container matColumnDef="model">
          <th mat-header-cell *matHeaderCellDef>Model</th>
          <td mat-cell *matCellDef="let row">{{ row.model }}</td>
        </ng-container>
        <ng-container matColumnDef="generations">
          <th mat-header-cell *matHeaderCellDef>Generations</th>
          <td mat-cell *matCellDef="let row">{{ row.generations }}</td>
        </ng-container>
        <ng-container matColumnDef="abstain_rate">
          <th mat-header-cell *matHeaderCellDef>Abstained</th>
          <td mat-cell *matCellDef="let row">{{ row.abstain_rate | percent: '1.1-1' }}</td>
        </ng-container>
        <ng-container matColumnDef="negative_feedback_rate">
          <th mat-header-cell *matHeaderCellDef>Negative feedback</th>
          <td mat-cell *matCellDef="let row">{{ row.negative_feedback_rate | percent: '1.1-1' }}</td>
        </ng-container>
        <ng-container matColumnDef="avg_latency_ms">
          <th mat-header-cell *matHeaderCellDef>Avg latency (ms)</th>
          <td mat-cell *matCellDef="let row">{{ row.avg_latency_ms }}</td>
        </ng-container>
        <ng-container matColumnDef="prompt_tokens">
          <th mat-header-cell *matHeaderCellDef>Prompt tokens</th>
          <td mat-cell *matCellDef="let row">{{ row.prompt_tokens }}</td>
        </ng-container>
        <ng-container matColumnDef="completion_tokens">
          <th mat-header-cell *matHeaderCellDef>Completion tokens</th>
          <td mat-cell *matCellDef="let row">{{ row.completion_tokens }}</td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
        <tr mat-row *matRowDef="let row; columns: displayedColumns"></tr>
      </table>
    }
  `,
  styles: [
    `
      .stats-table {
        width: 100%;
      }
      .error {
        color: #b3261e;
      }
    `,
  ],
})
export class StatsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly displayedColumns = [
    'day',
    'model',
    'generations',
    'abstain_rate',
    'negative_feedback_rate',
    'avg_latency_ms',
    'prompt_tokens',
    'completion_tokens',
  ];

  readonly daysControl = new FormControl(7, { nonNullable: true });
  readonly stats = signal<StatsOut[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadStats();
  }

  loadStats(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api
      .usageStats(this.daysControl.value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.loading.set(false);
        },
        error: (err: Error) => {
          this.error.set(err.message);
          this.loading.set(false);
        },
      });
  }
}
