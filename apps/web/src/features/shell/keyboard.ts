/** Input types that don't take typed text: keys pressed on them can be shortcuts. */
const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'file',
  'color',
  'image',
]);

/** True if keys pressed on this element are typing (a text field, text area, select…). */
export function isTextEntry(el: {
  tagName: string;
  type?: string;
  isContentEditable: boolean;
}): boolean {
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el.type ?? '').toLowerCase());
}

/** Keyboard shortcuts never fire while the user is typing in a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return isTextEntry({
    tagName: target.tagName,
    type: target instanceof HTMLInputElement ? target.type : undefined,
    isContentEditable: target.isContentEditable,
  });
}

/** True for a plain key press (no Ctrl/Cmd/Alt) outside a text field. */
export function isPlainShortcut(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target);
}
