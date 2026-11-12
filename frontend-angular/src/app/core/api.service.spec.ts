import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApiService } from './api.service';
import { ChatResponse, DocumentOut, JobOut } from './models';

const BASE = 'http://localhost:8000';

describe('ApiService', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), ApiService],
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('lists documents with a GET', () => {
    const docs: DocumentOut[] = [
      {
        id: 'd1',
        filename: 'report.pdf',
        status: 'ready',
        parser: 'layout',
        chunk_count: 42,
        created_at: '2026-11-12T10:00:00',
      },
    ];
    service.listDocuments().subscribe((res) => expect(res).toEqual(docs));
    const req = httpMock.expectOne(`${BASE}/documents`);
    expect(req.request.method).toBe('GET');
    req.flush(docs);
  });

  it('uploads a document as multipart form data', () => {
    const file = new File(['%PDF-fake'], 'report.pdf', { type: 'application/pdf' });
    service
      .uploadDocument(file)
      .subscribe((res) => expect(res.document_id).toBe('d1'));
    const req = httpMock.expectOne(`${BASE}/documents/upload`);
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    const sent = body.get('file') as File;
    expect(sent.name).toBe('report.pdf');
    expect(sent.type).toBe('application/pdf');
    req.flush({ document_id: 'd1', job_id: 'j1', status: 'processing' });
  });

  it('fetches job status by id', () => {
    const job: JobOut = {
      id: 'j1',
      document_id: 'd1',
      status: 'processing',
      stage: 'embedding',
      error: null,
    };
    service.jobStatus('j1').subscribe((res) => expect(res).toEqual(job));
    const req = httpMock.expectOne(`${BASE}/jobs/j1`);
    expect(req.request.method).toBe('GET');
    req.flush(job);
  });

  it('deletes a document by id', () => {
    service.deleteDocument('d1').subscribe((res) => expect(res.deleted).toBe('d1'));
    const req = httpMock.expectOne(`${BASE}/documents/d1`);
    expect(req.request.method).toBe('DELETE');
    req.flush({ deleted: 'd1' });
  });

  it('posts a chat question with session and provider', () => {
    const response: ChatResponse = {
      answer: 'Page 3 says so.',
      citations: [{ page: 3, section: 'Results', block_type: 'text', snippet: 'says so' }],
      abstained: false,
      session_id: 's1',
      model: 'gpt-4o-mini',
      generation_id: 'g1',
    };
    service
      .chat('d1', { question: 'What?', session_id: 's1', provider: 'gpt4o-mini' })
      .subscribe((res) => expect(res).toEqual(response));
    const req = httpMock.expectOne(`${BASE}/documents/d1/chat`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      question: 'What?',
      session_id: 's1',
      provider: 'gpt4o-mini',
    });
    req.flush(response);
  });

  it('submits feedback for a generation', () => {
    service.submitFeedback('g1', { kind: 'thumbs_up' }).subscribe();
    const req = httpMock.expectOne(`${BASE}/generations/g1/feedback`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ kind: 'thumbs_up' });
    req.flush({});
  });

  it('passes the days window to usage stats', () => {
    service.usageStats(30).subscribe();
    const req = httpMock.expectOne(`${BASE}/stats/usage?days=30`);
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('summarizes a document', () => {
    service.summarize('d1').subscribe((res) => expect(res.cached).toBeTrue());
    const req = httpMock.expectOne(`${BASE}/documents/d1/summarize`);
    expect(req.request.method).toBe('POST');
    req.flush({ summary: 'TL;DR', cached: true, model: 'gpt-4o-mini' });
  });
});
