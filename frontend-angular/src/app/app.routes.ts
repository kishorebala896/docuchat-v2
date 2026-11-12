import { Routes } from '@angular/router';

/** Lazy feature routes — each page loads only when visited. */
export const routes: Routes = [
  { path: '', redirectTo: 'documents', pathMatch: 'full' },
  {
    path: 'documents',
    loadComponent: () =>
      import('./features/documents/documents-page.component').then(
        (m) => m.DocumentsPageComponent,
      ),
  },
  {
    path: 'chat/:docId',
    loadComponent: () =>
      import('./features/chat/chat-page.component').then((m) => m.ChatPageComponent),
  },
  {
    path: 'summary/:docId',
    loadComponent: () =>
      import('./features/summary/summary-page.component').then(
        (m) => m.SummaryPageComponent,
      ),
  },
  {
    path: 'stats',
    loadComponent: () =>
      import('./features/stats/stats-page.component').then((m) => m.StatsPageComponent),
  },
  { path: '**', redirectTo: 'documents' },
];
