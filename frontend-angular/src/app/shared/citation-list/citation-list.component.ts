import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Citation } from '../../core/models';

/**
 * Grounded-answer citations: page, section, and the retrieved snippet.
 * Rendered under an assistant message so the answer can be checked against
 * the document instead of taken on trust.
 */
@Component({
  selector: 'app-citation-list',
  standalone: true,
  imports: [MatIconModule, MatListModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (citations().length > 0) {
      <div class="citations" role="region" aria-label="Sources">
        <p class="citations-heading">
          <mat-icon aria-hidden="true">link</mat-icon>
          Sources ({{ citations().length }})
        </p>
        <mat-list>
          @for (citation of citations(); track citation.page + '-' + citation.snippet) {
            <mat-list-item>
              <span matListItemTitle>
                p. {{ citation.page }} — {{ citation.section }}
                @if (citation.block_type) {
                  <span class="block-type">({{ citation.block_type }})</span>
                }
              </span>
              <span matListItemLine class="snippet">{{ citation.snippet }}</span>
            </mat-list-item>
          }
        </mat-list>
      </div>
    }
  `,
  styles: [
    `
      .citations {
        margin-top: 8px;
        border-top: 1px solid rgba(0, 0, 0, 0.12);
        padding-top: 4px;
      }
      .citations-heading {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
        font-weight: 500;
        margin: 8px 0 0;
      }
      .citations-heading mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      .block-type {
        color: rgba(0, 0, 0, 0.54);
      }
      .snippet {
        white-space: normal;
      }
    `,
  ],
})
export class CitationListComponent {
  readonly citations = input.required<Citation[]>();
}
