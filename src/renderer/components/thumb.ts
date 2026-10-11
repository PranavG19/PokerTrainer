/**
 * The one selection material: a sliding thumb under the selected item of a segmented control or the tab
 * strip (DECISIONS.md, "One selection material"). The selected item itself carries no fill; the thumb
 * is a separate absolutely-positioned span that moves to it, so a selection change slides instead of
 * jumping. Purely visual: the container keeps its own selected flag (data-active / aria-checked /
 * aria-pressed / data-selected), which is what tests and assistive tech read.
 *
 * The thumb follows the selection on its own: attribute changes inside the container and size changes
 * of the container re-place it. A container rebuilt by a screen re-render gets a new thumb at the new
 * position (no slide), which is the honest outcome when the DOM itself was replaced.
 */
const SELECTED = '[data-active="true"], [aria-checked="true"], [aria-pressed="true"], [data-selected="true"]';

export function attachThumb(container: HTMLElement, itemSelector = 'button'): HTMLElement {
  container.classList.add('has-thumb');
  const thumb = document.createElement('span');
  thumb.className = 'sel-thumb';
  thumb.setAttribute('aria-hidden', 'true');
  container.prepend(thumb);

  const place = (): void => {
    const on = [...container.querySelectorAll<HTMLElement>(itemSelector)].find((el) => el.matches(SELECTED));
    if (!on || on.offsetWidth === 0) {
      thumb.style.display = 'none';
      return;
    }
    thumb.style.display = '';
    // offsetLeft is relative to the offset parent; the container is position:relative (.has-thumb).
    thumb.style.left = `${on.offsetLeft}px`;
    thumb.style.top = `${on.offsetTop}px`;
    thumb.style.width = `${on.offsetWidth}px`;
    thumb.style.height = `${on.offsetHeight}px`;
  };

  place();
  requestAnimationFrame(place);
  new MutationObserver(place).observe(container, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-active', 'aria-checked', 'aria-pressed', 'data-selected', 'hidden'],
  });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(place).observe(container);
  return thumb;
}
