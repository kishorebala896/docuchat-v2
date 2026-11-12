import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Citation, FeedbackKind } from '../../core/models';
import { CitationListComponent } from '../citation-list/citation-list.component';

/** View model for one row in the chat thread. History messages (from
 * MessageOut) carry no citations or generation id, so those fields are
 * optional — feedback is only offered on fresh answers that have one. */
export interface ChatViewMessage {
  role: 'user' | 'assistant';
  content: string;
  model?: string | null;
  createdAt?: string | null;
  citations?: Citation[];
  abstained?: boolean;
  generationId?: string | null;
  /** True while the optimistic placeholder waits for the API response. */
  pending?: boolean;
}

/**
 * One chat message: user messages right-aligned, assistant messages with
 * citations, an abstention badge when the backend declined to answer, and
 * feedback actions (thumbs up/down, regenerate, rewrite) on fresh answers.
 */
@Component({
  selector: 'app-chat-message',
  standalone: true,
  imports: [
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CitationListComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="message" [class.user]="message().role === 'user'">
      <div class="bubble">
        @if (message().pending) {
          <mat-spinner diameter="20" aria-label="Waiting for answer"></mat-spinner>
        } @else {
          <p class="content">{{ message().content }}</p>
          @if (message().abstained) {
            <mat-chip-set aria-label="Answer status">
              <mat-chip highlighted>
                <mat-icon matChipAvatar>help_outline</mat-icon>
                No grounded answer — not in this document
              </mat-chip>
            </mat-chip-set>
          }
          @if (message().citations?.length) {
            <app-citation-list [citations]="message().citations ?? []" />
          }
          <p class="meta">
            @if (message().model) {
              <span>{{ message().model }}</span>
            }
            @if (message().createdAt) {
              <span>{{ message().createdAt | date: 'shortTime' }}</span>
            }
          </p>
          @if (showFeedback() && message().generationId) {
            <div class="feedback" role="group" aria-label="Feedback on this answer">
              <button
                mat-icon-button
                [color]="feedbackGiven() === 'thumbs_up' ? 'primary' : undefined"
                [disabled]="feedbackGiven() !== null"
                (click)="feedback.emit('thumbs_up')"
                aria-label="Thumbs up"
              >
                <mat-icon>thumb_up</mat-icon>
              </button>
              <button
                mat-icon-button
                [color]="feedbackGiven() === 'thumbs_down' ? 'warn' : undefined"
                [disabled]="feedbackGiven() !== null"
                (click)="feedback.emit('thumbs_down')"
                aria-label="Thumbs down"
              >
                <mat-icon>thumb_down</mat-icon>
              </button>
              <button
                mat-icon-button
                (click)="feedback.emit('regenerate')"
                aria-label="Regenerate answer"
              >
                <mat-icon>refresh</mat-icon>
              </button>
              <button
                mat-icon-button
                (click)="rewrite.emit()"
                aria-label="Rewrite this answer"
              >
                <mat-icon>edit</mat-icon>
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .message {
        display: flex;
        margin: 8px 0;
      }
      .message.user {
        justify-content: flex-end;
      }
      .bubble {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 12px;
        background: #f1f3f4;
        white-space: pre-wrap;
      }
      .message.user .bubble {
        background: #d3e3fd;
      }
      .content {
        margin: 0;
      }
      .meta {
        margin: 6px 0 0;
        font-size: 11px;
        color: rgba(0, 0, 0, 0.54);
        display: flex;
        gap: 8px;
      }
      .feedback {
        margin-top: 4px;
      }
    `,
  ],
})
export class ChatMessageComponent {
  readonly message = input.required<ChatViewMessage>();
  readonly showFeedback = input(true);
  /** The feedback kind already recorded for this answer, if any. */
  readonly feedbackGiven = input<FeedbackKind | null>(null);

  readonly feedback = output<FeedbackKind>();
  readonly rewrite = output<void>();
}
