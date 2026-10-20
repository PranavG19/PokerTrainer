import { dialog, type BrowserWindow } from 'electron';
import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * You › Style's "Save card image": capture the card's rect from the window and write it as a PNG where the learner
 * picks, through the native save dialog. Nothing is sent anywhere; nothing is written without the dialog's answer.
 * Under e2e a spec stubs `dialog.showSaveDialog` from the test process, as the Pro import does with the open dialog.
 */

export type SaveCardResult = 'saved' | 'cancelled' | 'failed';

/** A rect from the renderer, checked: finite, positive and no larger than a window. */
export function cardRect(raw: unknown): Electron.Rectangle | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const [x, y, width, height] = [n(r.x), n(r.y), n(r.width), n(r.height)];
  if (x === null || y === null || width === null || height === null) return null;
  if (x < 0 || y < 0 || width < 1 || height < 1 || width > 4000 || height > 4000) return null;
  return { x: Math.floor(x), y: Math.floor(y), width: Math.ceil(width), height: Math.ceil(height) };
}

/** The part of the rect inside the window's content, or null when none of it is. */
export function withinContent(r: Electron.Rectangle, content: { width: number; height: number }): Electron.Rectangle | null {
  const width = Math.min(r.width, content.width - r.x);
  const height = Math.min(r.height, content.height - r.y);
  return width >= 1 && height >= 1 ? { x: r.x, y: r.y, width, height } : null;
}

export async function saveStyleCard(win: BrowserWindow | null, raw: unknown, picturesDir: string): Promise<SaveCardResult> {
  const css = cardRect(raw);
  if (win === null || win.isDestroyed() || css === null) return 'failed';
  // The renderer measures in CSS pixels; the capture is in window pixels, which differ by the page zoom.
  const zoom = win.webContents.getZoomFactor();
  const asked = { x: Math.floor(css.x * zoom), y: Math.floor(css.y * zoom), width: Math.ceil(css.width * zoom), height: Math.ceil(css.height * zoom) };
  const rect = withinContent(asked, win.getContentBounds());
  if (rect === null) return 'failed';
  try {
    const image = await win.webContents.capturePage(rect);
    if (image.isEmpty()) return 'failed';
    const options: Electron.SaveDialogOptions = {
      title: 'Save your style card',
      defaultPath: path.join(picturesDir, 'Offsuit style.png'),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    };
    const picked = await dialog.showSaveDialog(win, options);
    if (picked.canceled || !picked.filePath) return 'cancelled';
    await writeFile(picked.filePath, image.toPNG());
    return 'saved';
  } catch {
    return 'failed';
  }
}
