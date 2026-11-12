import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  ChatRequest,
  ChatResponse,
  ChatSessionOut,
  DocumentOut,
  FeedbackRequest,
  HealthResponse,
  JobOut,
  MessageOut,
  ProvidersResponse,
  StatsOut,
  SummaryResponse,
  UploadResponse,
} from './models';

/**
 * Typed HttpClient wrapper for the DocuChat v2 API — one method per endpoint.
 * All errors pass through the error interceptor first, so subscribers see a
 * plain Error with a human-readable message.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  health(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${this.baseUrl}/health`);
  }

  uploadDocument(file: File): Observable<UploadResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<UploadResponse>(`${this.baseUrl}/documents/upload`, form);
  }

  listDocuments(): Observable<DocumentOut[]> {
    return this.http.get<DocumentOut[]>(`${this.baseUrl}/documents`);
  }

  deleteDocument(docId: string): Observable<{ deleted: string }> {
    return this.http.delete<{ deleted: string }>(
      `${this.baseUrl}/documents/${encodeURIComponent(docId)}`,
    );
  }

  jobStatus(jobId: string): Observable<JobOut> {
    return this.http.get<JobOut>(`${this.baseUrl}/jobs/${encodeURIComponent(jobId)}`);
  }

  providers(): Observable<ProvidersResponse> {
    return this.http.get<ProvidersResponse>(`${this.baseUrl}/providers`);
  }

  chat(docId: string, request: ChatRequest): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(
      `${this.baseUrl}/documents/${encodeURIComponent(docId)}/chat`,
      request,
    );
  }

  listSessions(docId: string): Observable<ChatSessionOut[]> {
    return this.http.get<ChatSessionOut[]>(
      `${this.baseUrl}/documents/${encodeURIComponent(docId)}/sessions`,
    );
  }

  sessionMessages(sessionId: string): Observable<MessageOut[]> {
    return this.http.get<MessageOut[]>(
      `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
  }

  summarize(docId: string): Observable<SummaryResponse> {
    return this.http.post<SummaryResponse>(
      `${this.baseUrl}/documents/${encodeURIComponent(docId)}/summarize`,
      {},
    );
  }

  submitFeedback(generationId: string, request: FeedbackRequest): Observable<unknown> {
    return this.http.post(
      `${this.baseUrl}/generations/${encodeURIComponent(generationId)}/feedback`,
      request,
    );
  }

  usageStats(days = 7): Observable<StatsOut[]> {
    const params = new HttpParams().set('days', days);
    return this.http.get<StatsOut[]>(`${this.baseUrl}/stats/usage`, { params });
  }
}
