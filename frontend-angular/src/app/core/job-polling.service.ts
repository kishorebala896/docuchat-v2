import { inject, Injectable } from '@angular/core';
import { fromEvent, merge, Observable, retry, switchMap, takeWhile, timer } from 'rxjs';
import { ApiService } from './api.service';
import { INGEST_STAGES, JobOut } from './models';

export interface PollOptions {
  /** Delay between polls. Defaults to 2000ms. */
  intervalMs?: number;
  /** Retries per poll before the stream errors. Defaults to 2 (backoff 1s, 2s). */
  retriesPerPoll?: number;
}

/**
 * Polls an ingest job until it reaches a terminal status (ready/failed).
 *
 * - `timer` + `switchMap`: one in-flight request at a time; a slow response
 *   never stacks up behind the next tick.
 * - Per-poll `retry` with exponential backoff (1s, 2s) for transient errors.
 * - Re-fetches immediately on the browser `online` event, so a reconnected
 *   tab recovers stale state instead of waiting for the next tick.
 * - The stream completes (inclusive) on the terminal job; the component
 *   refreshes its document list from that emission.
 */
@Injectable({ providedIn: 'root' })
export class JobPollingService {
  private readonly api = inject(ApiService);

  pollJob(jobId: string, options: PollOptions = {}): Observable<JobOut> {
    const intervalMs = options.intervalMs ?? 2000;
    const retries = options.retriesPerPoll ?? 2;
    const tick$ = merge(
      timer(0, intervalMs),
      fromEvent(window, 'online'),
    );
    return tick$.pipe(
      switchMap(() =>
        this.api.jobStatus(jobId).pipe(
          retry({
            count: retries,
            delay: (_err, retryCount) => timer(1000 * 2 ** (retryCount - 1)),
          }),
        ),
      ),
      takeWhile((job) => job.status !== 'ready' && job.status !== 'failed', true),
    );
  }
}

/** Maps an ingest stage to a 0–100 progress value for the progress bar. */
export function stageProgress(stage: string): number {
  if (stage === 'ready') {
    return 100;
  }
  const index = (INGEST_STAGES as readonly string[]).indexOf(stage);
  if (index < 0) {
    return 0;
  }
  // queued starts at 5%; each stage advances toward 100%.
  return 5 + Math.round((index / INGEST_STAGES.length) * 90);
}
