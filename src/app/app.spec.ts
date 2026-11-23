import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('shows the empty state with no accounts', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Destroy Your Debt');
    expect(el.textContent).toContain('No accounts yet');
    expect(el.querySelector('.site-footer')?.textContent).toContain('© Charles R. Clark, 2026');
  });
});
