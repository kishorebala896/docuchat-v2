import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { JobOut } from '../../core/models';
import { stageProgress } from '../../core/job-polling.service';

/**
 * Live ingest progress for one upload: stage label, determinate progress
 * bar, and the error state (with the backend's message) when ingestion
 * fails. The parent polls via JobPollingService and hands each JobOut here.
 */
@Component({
  selector: 'app-job-progress',
  standalone: true,
  imports: [MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="job-progress" role="status" [attr.aria-label]="'Ingestion status for ' + filename()">
      <div class="job-header">
        @if (job().status === 'failed') {
          <mat-icon color="warn" aria-hidden="true">error</mat-icon>
        } @else if (job().status === 'ready') {
          <mat-icon color="primary" aria-hidden="true">check_circle</mat-icon>
        } @else {
          <mat-icon aria-hidden="true">hourglass_top</mat-icon>
        }
        <span class="filename">{{ filename() }}</span>
        <span class="stage">{{ job().stage }}</span>
      </div>
      <mat-progress-bar
        mode="determinate"
        [value]="progress()"
        [color]="job().status === 'failed' ? 'warn' : 'primary'"
        [attr.aria-valuenow]="progress()"
        aria-label="Ingestion progress"
      ></mat-progress-bar>
      @if (job().error) {
        <p class="error-text">
          Ingestion failed: {{ job().error }} — the file may be scanned-image
          only or corrupted. Fix the file and upload again.
        </p>
      }
    </div>
  `,
  styles: [
    `
      .job-progress {
        padding: 12px 0;
      }
      .job-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .filename {
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .stage {
        margin-left: auto;
        color: rgba(0, 0, 0, 0.6);
        text-transform: capitalize;
      }
      .error-text {
        color: #b3261e;
        font-size: 13px;
        margin: 8px 0 0;
      }
    `,
  ],
})
export class JobProgressComponent {
  readonly job = input.required<JobOut>();
  readonly filename = input.required<string>();

  readonly progress = computed(() => stageProgress(this.job().stage));
}
