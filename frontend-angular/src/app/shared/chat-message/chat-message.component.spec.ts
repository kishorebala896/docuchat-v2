import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
  ChatMessageComponent,
  ChatViewMessage,
} from './chat-message.component';

describe('ChatMessageComponent', () => {
  let fixture: ComponentFixture<ChatMessageComponent>;
  let component: ChatMessageComponent;

  function setup(message: ChatViewMessage, feedbackGiven: 'thumbs_up' | null = null): void {
    TestBed.configureTestingModule({
      imports: [ChatMessageComponent, NoopAnimationsModule],
    });
    fixture = TestBed.createComponent(ChatMessageComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('message', message);
    fixture.componentRef.setInput('feedbackGiven', feedbackGiven);
    fixture.detectChanges();
  }

  it('renders the message content', () => {
    setup({ role: 'user', content: 'What is the revenue?' });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('What is the revenue?');
  });

  it('shows the abstention badge when the backend abstained', () => {
    setup({
      role: 'assistant',
      content: "I don't have information on that in this document.",
      abstained: true,
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No grounded answer');
  });

  it('renders citations under an assistant answer', () => {
    setup({
      role: 'assistant',
      content: 'The revenue grew 12%.',
      citations: [
        { page: 4, section: 'Results', block_type: 'table', snippet: 'revenue +12%' },
      ],
    });
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Sources (1)');
    expect(text).toContain('revenue +12%');
  });

  it('shows a spinner while the answer is pending', () => {
    setup({ role: 'assistant', content: '', pending: true });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('mat-spinner')).not.toBeNull();
  });

  it('emits feedback when a thumbs button is clicked', () => {
    setup({
      role: 'assistant',
      content: 'An answer.',
      generationId: 'g1',
    });
    const emitted: string[] = [];
    component.feedback.subscribe((kind) => emitted.push(kind));
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[aria-label="Thumbs up"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    button.click();
    expect(emitted).toEqual(['thumbs_up']);
  });

  it('hides feedback buttons on history messages without a generation id', () => {
    setup({ role: 'assistant', content: 'An old answer.', model: 'gpt-4o-mini' });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('button[aria-label="Thumbs up"]')).toBeNull();
  });
});
