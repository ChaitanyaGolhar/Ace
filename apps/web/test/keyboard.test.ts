import { describe, expect, it } from 'vitest';
import { isTextEntry } from '../src/features/shell/keyboard';

// Shortcuts never fire while the user is typing (§6.3), but a focused checkbox or radio
// isn't typing: after ticking a key point with the mouse, digits and Enter still work.

const el = (tagName: string, type = '', isContentEditable = false) => ({
  tagName,
  type,
  isContentEditable,
});

describe('isTextEntry', () => {
  it('text fields, text areas, selects and editable content are typing targets', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']) {
      expect(isTextEntry(el('INPUT', type)), type).toBe(true);
    }
    expect(isTextEntry(el('TEXTAREA'))).toBe(true);
    expect(isTextEntry(el('SELECT'))).toBe(true);
    expect(isTextEntry(el('DIV', '', true))).toBe(true);
  });

  it('checkboxes, radios, buttons and other elements are not', () => {
    for (const type of ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file']) {
      expect(isTextEntry(el('INPUT', type)), type).toBe(false);
    }
    expect(isTextEntry(el('BUTTON'))).toBe(false);
    expect(isTextEntry(el('DIV'))).toBe(false);
  });
});
