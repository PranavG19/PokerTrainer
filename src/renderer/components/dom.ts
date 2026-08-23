/** Create an element with a class and text content — the one shared copy of a
 * helper that was previously duplicated byte-for-byte across the screens. */
export function text(tag: string, className: string, content: string): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = content;
  return el;
}
