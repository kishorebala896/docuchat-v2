import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';

/**
 * App shell: toolbar with navigation, a live API health indicator, and the
 * router outlet. The health check runs once at startup — if the backend is
 * down, the badge says so instead of every page failing mysteriously.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar class="toolbar">
      <mat-icon aria-hidden="true">description</mat-icon>
      <span class="title">DocuChat v2</span>
      <nav class="nav" aria-label="Primary">
        <a
          mat-button
          routerLink="/documents"
          routerLinkActive="active-link"
          aria-label="Documents"
        >
          <mat-icon>folder</mat-icon> Documents
        </a>
        <a
          mat-button
          routerLink="/stats"
          routerLinkActive="active-link"
          aria-label="Usage stats"
        >
          <mat-icon>bar_chart</mat-icon> Usage stats
        </a>
      </nav>
      <span class="spacer"></span>
      @if (apiStatus() === 'ok') {
        <span class="api-badge api-ok" role="status">
          <mat-icon aria-hidden="true">check_circle</mat-icon> API connected
        </span>
      } @else if (apiStatus() === 'down') {
        <span class="api-badge api-down" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon> API unreachable
        </span>
      }
    </mat-toolbar>

    <main class="page">
      <router-outlet />
    </main>

    <footer class="footer">
      DocuChat v2 — grounded document Q&A. Angular 19 frontend talking to the
      FastAPI backend on localhost:8000.
    </footer>
  `,
  styles: [
    `
      /* color="primary" does not paint the toolbar background under the M3
         prebuilt theme, so the background is set explicitly from the theme
         tokens — without this the white nav links are invisible on the
         default light toolbar. */
      .toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }
      .title {
        margin-left: 8px;
        font-weight: 500;
      }
      .nav {
        margin-left: 24px;
        display: flex;
        gap: 4px;
      }
      .nav a {
        color: white;
      }
      .active-link {
        background: rgba(255, 255, 255, 0.15);
      }
      .spacer {
        flex: 1;
      }
      .api-badge {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 13px;
      }
      .api-badge mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .api-down {
        color: #ff8a80;
      }
      .page {
        max-width: 1100px;
        margin: 0 auto;
        padding: 24px 16px 48px;
      }
      .footer {
        text-align: center;
        padding: 16px;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.54);
        border-top: 1px solid rgba(0, 0, 0, 0.12);
      }
    `,
  ],
})
export class AppComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly apiStatus = signal<'unknown' | 'ok' | 'down'>('unknown');

  ngOnInit(): void {
    this.api
      .health()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.apiStatus.set('ok'),
        error: () => this.apiStatus.set('down'),
      });
  }
}
