import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  FormControl,
  FormGroup,
  FormGroupDirective,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  ChatSessionOut,
  DocumentOut,
  FeedbackKind,
  MessageOut,
  ProvidersResponse,
} from '../../core/models';
import {
  ChatMessageComponent,
  ChatViewMessage,
} from '../../shared/chat-message/chat-message.component';
import { DocumentCardComponent } from '../../shared/document-card/document-card.component';
import { RewriteDialogComponent } from './rewrite-dialog.component';

/**
 * Chat with one document. Sessions on the left, the thread on the right.
 *
 * - Sending is optimistic: the user message and a pending assistant bubble
 *   appear immediately; on success the bubble fills with the grounded
 *   answer, on error both are rolled back and the error is shown.
 * - Feedback (thumbs up/down, regenerate, rewrite) is only offered on
 *   answers received in this view — history messages carry no generation
 *   id, so there is nothing to attach feedback to. That is an API limit,
 *   not a UI choice; see the README.
 * - Enter sends, Shift+Enter adds a newline; focus returns to the question
 *   box after every send.
 */
@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    ChatMessageComponent,
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
      <app-document-card
        [document]="doc()!"
        [showActions]="false"
      />

      <div class="chat-layout">
        <aside class="sessions" aria-label="Chat sessions">
          <button mat-raised-button color="primary" (click)="newSession()">
            <mat-icon>add</mat-icon> New chat
          </button>
          <mat-list>
            @for (session of sessions(); track session.id) {
              <mat-list-item>
                <button
                  mat-button
                  [color]="session.id === sessionId() ? 'primary' : undefined"
                  (click)="selectSession(session.id)"
                  [attr.aria-label]="'Open session from ' + (session.created_at | date: 'short')"
                >
                  {{ session.created_at | date: 'short' }}
                </button>
              </mat-list-item>
            }
          </mat-list>
          @if (sessions().length === 0) {
            <p class="hint">No sessions yet — ask the first question.</p>
          }
        </aside>

        <section class="thread-pane">
          <div #thread class="thread" role="log" aria-live="polite" aria-label="Chat messages">
            @if (loadingHistory()) {
              <p role="status"><mat-spinner diameter="24"></mat-spinner> Loading messages…</p>
            } @else if (messages().length === 0) {
              <p class="hint" role="status">
                Ask a question about this document. Answers come only from the
                document — if it is not in there, the assistant says so.
              </p>
            }
            @for (message of messages(); track $index) {
              <app-chat-message
                [message]="message"
                [feedbackGiven]="feedbackFor(message)"
                (feedback)="onFeedback($event, message)"
                (rewrite)="onRewrite(message)"
              />
            }
          </div>

          <form [formGroup]="form" (ngSubmit)="send()" class="composer">
            <mat-form-field appearance="outline" class="question-field">
              <mat-label>Ask about this document</mat-label>
              <textarea
                #questionInput
                matInput
                formControlName="question"
                rows="2"
                aria-label="Your question"
                (keydown.enter)="onEnter($event)"
              ></textarea>
              @if (form.controls.question.hasError('required') && form.controls.question.touched) {
                <mat-error>Type a question first.</mat-error>
              }
              @if (form.controls.question.hasError('maxlength')) {
                <mat-error>Keep questions under 2000 characters.</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline" class="provider-field">
              <mat-label>Answering model</mat-label>
              <mat-select formControlName="provider" aria-label="Answering model">
                <mat-option value="">Default ({{ providers()?.default ?? '…' }})</mat-option>
                @for (provider of providers()?.available ?? []; track provider) {
                  <mat-option [value]="provider">{{ provider }}</mat-option>
                }
              </mat-select>
            </mat-form-field>

            <button
              mat-fab
              color="primary"
              type="submit"
              [disabled]="form.invalid || sending()"
              aria-label="Send question"
            >
              @if (sending()) {
                <mat-spinner diameter="20"></mat-spinner>
              } @else {
                <mat-icon>send</mat-icon>
              }
            </button>
          </form>
        </section>
      </div>
    }
  `,
  styles: [
    `
      .chat-layout {
        display: flex;
        gap: 16px;
        align-items: flex-start;
      }
      .sessions {
        width: 220px;
        flex-shrink: 0;
      }
      .thread-pane {
        flex: 1;
        min-width: 0;
      }
      .thread {
        min-height: 300px;
        max-height: 55vh;
        overflow-y: auto;
        padding: 8px;
        border: 1px solid rgba(0, 0, 0, 0.12);
        border-radius: 8px;
      }
      .composer {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        margin-top: 12px;
      }
      .question-field {
        flex: 1;
      }
      .provider-field {
        width: 180px;
      }
      .hint {
        color: rgba(0, 0, 0, 0.6);
      }
      .error {
        color: #b3261e;
      }
      @media (max-width: 800px) {
        .chat-layout {
          flex-direction: column;
        }
        .sessions {
          width: 100%;
        }
      }
    `,
  ],
})
export class ChatPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  private readonly threadEl = viewChild<ElementRef<HTMLDivElement>>('thread');
  private readonly questionInputEl =
    viewChild<ElementRef<HTMLTextAreaElement>>('questionInput');
  private readonly formDirective = viewChild.required(FormGroupDirective);

  readonly doc = signal<DocumentOut | null>(null);
  readonly docLoading = signal(true);
  readonly docError = signal<string | null>(null);
  readonly sessions = signal<ChatSessionOut[]>([]);
  readonly sessionId = signal<string | null>(null);
  readonly messages = signal<ChatViewMessage[]>([]);
  readonly loadingHistory = signal(false);
  readonly sending = signal(false);
  readonly providers = signal<ProvidersResponse | null>(null);

  /** generationId -> feedback kind already recorded. */
  private readonly feedbackGivenMap = signal(new Map<string, FeedbackKind>());

  readonly form = new FormGroup({
    question: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(2000)],
    }),
    provider: new FormControl('', { nonNullable: true }),
  });

  private docId = '';

  constructor() {
    // Keep the newest message visible after every thread update.
    effect(() => {
      void this.messages();
      const el = this.threadEl()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map((params) => params.get('docId') ?? ''),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((docId) => {
        this.docId = docId;
        this.sessionId.set(null);
        this.messages.set([]);
        this.loadDocument(docId);
        this.loadSessions(docId);
      });
    this.api
      .providers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providers) => this.providers.set(providers),
        error: () => this.providers.set(null), // picker falls back to "Default"
      });
  }

  feedbackFor(message: ChatViewMessage): FeedbackKind | null {
    if (!message.generationId) {
      return null;
    }
    return this.feedbackGivenMap().get(message.generationId) ?? null;
  }

  goToDocuments(): void {
    void this.router.navigate(['/documents']);
  }

  newSession(): void {
    this.sessionId.set(null);
    this.messages.set([]);
    this.focusQuestion();
  }

  selectSession(sessionId: string): void {
    if (sessionId === this.sessionId()) {
      return;
    }
    this.sessionId.set(sessionId);
    this.loadHistory(sessionId);
  }

  onEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.send();
    }
  }

  send(): void {
    const question = this.form.controls.question.value.trim();
    if (!question || this.form.invalid || this.sending()) {
      this.form.controls.question.markAsTouched();
      return;
    }
    this.ask(question, true);
    // Reset via the directive, not the control: control.reset() leaves the
    // form's submitted flag set, so the empty required field renders in its
    // red error state after every send. resetForm() clears submitted too.
    this.formDirective().resetForm({
      question: '',
      provider: this.form.controls.provider.value,
    });
  }

  onFeedback(kind: FeedbackKind, message: ChatViewMessage): void {
    if (!message.generationId) {
      return;
    }
    if (kind === 'regenerate') {
      this.regenerate(message);
      return;
    }
    this.api
      .submitFeedback(message.generationId, { kind })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.feedbackGivenMap.update((map) => {
            const next = new Map(map);
            next.set(message.generationId!, kind);
            return next;
          });
          this.snackBar.open('Feedback saved — thank you.', 'Dismiss', { duration: 3000 });
        },
        error: (err: Error) =>
          this.snackBar.open(`Could not save feedback: ${err.message}`, 'Dismiss', {
            duration: 5000,
          }),
      });
  }

  onRewrite(message: ChatViewMessage): void {
    if (!message.generationId) {
      return;
    }
    const ref = this.dialog.open(RewriteDialogComponent, {
      data: { answer: message.content },
    });
    ref
      .afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((text: string | undefined) => {
        if (text === undefined || text === message.content) {
          return;
        }
        this.api
          .submitFeedback(message.generationId!, { kind: 'rewrite', text })
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.feedbackGivenMap.update((map) => {
                const next = new Map(map);
                next.set(message.generationId!, 'rewrite');
                return next;
              });
              this.messages.update((msgs) =>
                msgs.map((m) =>
                  m.generationId === message.generationId ? { ...m, content: text } : m,
                ),
              );
              this.snackBar.open('Rewrite saved as feedback.', 'Dismiss', { duration: 3000 });
            },
            error: (err: Error) =>
              this.snackBar.open(`Could not save rewrite: ${err.message}`, 'Dismiss', {
                duration: 5000,
              }),
          });
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

  private loadSessions(docId: string): void {
    this.api
      .listSessions(docId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sessions) => this.sessions.set(sessions),
        error: () => this.sessions.set([]),
      });
  }

  private loadHistory(sessionId: string): void {
    this.loadingHistory.set(true);
    this.api
      .sessionMessages(sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows: MessageOut[]) => {
          this.messages.set(rows.map((m) => this.toViewMessage(m)));
          this.loadingHistory.set(false);
        },
        error: (err: Error) => {
          this.loadingHistory.set(false);
          this.snackBar.open(`Could not load messages: ${err.message}`, 'Dismiss', {
            duration: 5000,
          });
        },
      });
  }

  private toViewMessage(m: MessageOut): ChatViewMessage {
    return {
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.content,
      model: m.model,
      createdAt: m.created_at,
    };
  }

  private regenerate(message: ChatViewMessage): void {
    const msgs = this.messages();
    const index = msgs.indexOf(message);
    const lastUser = [...msgs.slice(0, index)].reverse().find((m) => m.role === 'user');
    if (!lastUser || !message.generationId) {
      return;
    }
    this.api
      .submitFeedback(message.generationId, { kind: 'regenerate' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.ask(lastUser.content, false),
        error: (err: Error) =>
          this.snackBar.open(`Could not log regenerate: ${err.message}`, 'Dismiss', {
            duration: 5000,
          }),
      });
  }

  /**
   * One chat turn. Optimistic: the user message (unless echoUser is false,
   * for regenerate) and a pending assistant bubble appear immediately; on
   * success the bubble is replaced with the grounded answer, on error both
   * are removed and the failure is shown.
   */
  private ask(question: string, echoUser: boolean): void {
    this.sending.set(true);
    const pendingIndex = this.messages().length + (echoUser ? 1 : 0);
    this.messages.update((msgs) => [
      ...msgs,
      ...(echoUser
        ? [{ role: 'user' as const, content: question }]
        : []),
      { role: 'assistant' as const, content: '', pending: true },
    ]);
    const provider = this.form.controls.provider.value || null;
    this.api
      .chat(this.docId, {
        question,
        session_id: this.sessionId(),
        provider,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.sending.set(false);
          this.sessionId.set(response.session_id);
          this.messages.update((msgs) =>
            msgs.map((m, i) =>
              i === pendingIndex
                ? {
                    role: 'assistant' as const,
                    content: response.answer,
                    model: response.model,
                    citations: response.citations,
                    abstained: response.abstained,
                    generationId: response.generation_id,
                  }
                : m,
            ),
          );
          this.loadSessions(this.docId);
          this.focusQuestion();
        },
        error: (err: Error) => {
          this.sending.set(false);
          // Roll back the optimistic messages.
          this.messages.update((msgs) => msgs.slice(0, pendingIndex - (echoUser ? 1 : 0)));
          this.snackBar.open(`Could not get an answer: ${err.message}`, 'Dismiss', {
            duration: 6000,
          });
          this.focusQuestion();
        },
      });
  }

  private focusQuestion(): void {
    this.questionInputEl()?.nativeElement.focus();
  }
}
