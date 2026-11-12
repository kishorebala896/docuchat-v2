import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { JobPollingService, stageProgress } from './job-polling.service';
import { JobOut } from './models';

const BASE = 'http://localhost:8000';

function job(overrides: Partial<JobOut> = {}): JobOut {
  return {
    id: 'j1',
    document_id: 'd1',
    status: 'processing',
    stage: 'queued',
    error: null,
    ...overrides,
  };
}

describe('JobPollingService', () => {
  let service: JobPollingService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), JobPollingService],
    });
    service = TestBed.inject(JobPollingService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('polls immediately and at the interval until the job is ready', fakeAsync(() => {
    const seen: JobOut[] = [];
    let completed = false;
    service
      .pollJob('j1', { intervalMs: 1000 })
      .subscribe({ next: (j) => seen.push(j), complete: () => (completed = true) });

    // t=0: first poll (timer(0) needs a tick to fire in fakeAsync)
    tick(0);
    let req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ stage: 'parsing' }));

    tick(1000);
    req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ stage: 'embedding' }));

    tick(1000);
    req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ status: 'ready', stage: 'ready' }));

    expect(seen.map((j) => j.stage)).toEqual(['parsing', 'embedding', 'ready']);
    expect(completed).toBeTrue();
  }));

  it('completes on a failed job too, carrying the error', fakeAsync(() => {
    const seen: JobOut[] = [];
    let completed = false;
    service
      .pollJob('j1', { intervalMs: 1000 })
      .subscribe({ next: (j) => seen.push(j), complete: () => (completed = true) });

    tick(0);
    const req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ status: 'failed', stage: 'failed', error: 'ValueError: bad pdf' }));

    expect(seen.length).toBe(1);
    expect(seen[0].error).toContain('bad pdf');
    expect(completed).toBeTrue();
  }));

  it('retries a failed poll with backoff, then continues polling', fakeAsync(() => {
    const seen: JobOut[] = [];
    let completed = false;
    service
      .pollJob('j1', { intervalMs: 5000, retriesPerPoll: 1 })
      .subscribe({ next: (j) => seen.push(j), complete: () => (completed = true) });

    // t=0: poll fails
    tick(0);
    let req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.error(new ProgressEvent('error'));

    // Retry after 1s backoff succeeds.
    tick(1000);
    req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ stage: 'parsing' }));

    // Next scheduled tick completes the job.
    tick(4000);
    req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.flush(job({ status: 'ready', stage: 'ready' }));

    expect(seen.map((j) => j.stage)).toEqual(['parsing', 'ready']);
    expect(completed).toBeTrue();
  }));

  it('errors the stream when retries are exhausted', fakeAsync(() => {
    let error: unknown;
    service
      .pollJob('j1', { intervalMs: 5000, retriesPerPoll: 1 })
      .subscribe({ error: (e) => (error = e) });

    tick(0);
    const req = httpMock.expectOne(`${BASE}/jobs/j1`);
    req.error(new ProgressEvent('error'));
    tick(1000);
    const retryReq = httpMock.expectOne(`${BASE}/jobs/j1`);
    retryReq.error(new ProgressEvent('error'));

    expect(error).toBeTruthy();
  }));
});

describe('stageProgress', () => {
  it('maps stages to increasing percentages', () => {
    expect(stageProgress('queued')).toBe(5);
    expect(stageProgress('parsing')).toBeGreaterThan(stageProgress('queued'));
    expect(stageProgress('embedding')).toBeGreaterThan(stageProgress('parsing'));
    expect(stageProgress('ready')).toBe(100);
  });

  it('returns 0 for an unknown stage', () => {
    expect(stageProgress('something-else')).toBe(0);
  });
});
