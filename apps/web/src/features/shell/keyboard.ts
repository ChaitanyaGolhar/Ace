/** Keyboard shortcuts never fire while the user is typing in a field. */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** True for a plain key press (no Ctrl/Cmd/Alt) outside a text field. */
export function isPlainShortcut(e: KeyboardEvent): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target);
}
