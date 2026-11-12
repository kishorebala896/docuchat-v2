import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { DocumentOut } from '../../core/models';

/**
 * One document, as a card: filename, ingest status, parser, chunk count,
 * upload time, and the actions that make sense for its state. Used as the
 * header on the chat and summary pages; the documents page uses the table
 * for the full library and this card is the shared summary view.
 */
@Component({
  selector: 'app-document-card',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatCardModule, MatChipsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card class="doc-card">
      <mat-card-header>
        <mat-icon mat-card-avatar aria-hidden="true">description</mat-icon>
        <mat-card-title>{{ document().filename }}</mat-card-title>
        <mat-card-subtitle>
          Uploaded {{ document().created_at | date: 'medium' }}
        </mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <mat-chip-set aria-label="Document status">
          <mat-chip [highlighted]="document().status === 'ready'">
            {{ document().status }}
          </mat-chip>
          @if (document().parser) {
            <mat-chip>parser: {{ document().parser }}</mat-chip>
          }
          @if (document().chunk_count !== null) {
            <mat-chip>{{ document().chunk_count }} chunks</mat-chip>
          }
        </mat-chip-set>
      </mat-card-content>
      @if (showActions()) {
        <mat-card-actions>
          <button
            mat-button
            color="primary"
            [disabled]="document().status !== 'ready'"
            (click)="chat.emit()"
            [attr.aria-label]="'Chat with ' + document().filename"
          >
            <mat-icon>chat</mat-icon> Chat
          </button>
          <button
            mat-button
            [disabled]="document().status !== 'ready'"
            (click)="summarize.emit()"
            [attr.aria-label]="'Summarize ' + document().filename"
          >
            <mat-icon>subject</mat-icon> Summarize
          </button>
          <button
            mat-button
            color="warn"
            (click)="delete.emit()"
            [attr.aria-label]="'Delete ' + document().filename"
          >
            <mat-icon>delete</mat-icon> Delete
          </button>
        </mat-card-actions>
      }
    </mat-card>
  `,
  styles: [
    `
      .doc-card {
        margin-bottom: 16px;
      }
      mat-chip-set {
        margin-top: 8px;
      }
    `,
  ],
})
export class DocumentCardComponent {
  readonly document = input.required<DocumentOut>();
  readonly showActions = input(true);

  readonly chat = output<void>();
  readonly summarize = output<void>();
  readonly delete = output<void>();
}
