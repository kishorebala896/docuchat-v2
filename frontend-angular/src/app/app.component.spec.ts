import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, NoopAnimationsModule],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function createAndFlushHealth(ok: boolean): void {
    fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const req = httpMock.expectOne('http://localhost:8000/health');
    if (ok) {
      req.flush({
        status: 'ok',
        parser: 'layout',
        llm_provider: 'gpt4o-mini',
        time: '2026-11-12T00:00:00',
      });
    } else {
      req.error(new ProgressEvent('error'));
    }
    fixture.detectChanges();
  }

  it('should create the app', () => {
    createAndFlushHealth(true);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the API connected badge when health succeeds', () => {
    createAndFlushHealth(true);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('API connected');
  });

  it('shows the API unreachable badge when health fails', () => {
    createAndFlushHealth(false);
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('API unreachable');
  });
});
