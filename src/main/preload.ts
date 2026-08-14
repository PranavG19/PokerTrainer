import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('offsuit', {
  loadState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('store:load'),
  saveState: (obj: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('store:save', obj),
  getSeed: (): Promise<number | null> => ipcRenderer.invoke('app:seed'),
  // The tutor lives in main; the renderer only ever sees the answer text and
  // the built payload's key paths, never a model client or a solver field.
  tutorStatus: (): Promise<unknown> => ipcRenderer.invoke('tutor:status'),
  askTutor: (input: unknown): Promise<unknown> => ipcRenderer.invoke('tutor:ask', input),
  // Settings reads the resolved tutor rather than being told about it, so the
  // privacy statement cannot drift from what the app would actually do.
  readSettings: (): Promise<unknown> => ipcRenderer.invoke('settings:read'),
  setTutorEnabled: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('settings:setTutorEnabled', enabled),
  setTheme: (theme: string): Promise<string> => ipcRenderer.invoke('settings:setTheme', theme),
  // The confirmation phrase is re-checked in main; sending it is not authorising it.
  deleteProfile: (confirmation: string): Promise<unknown> =>
    ipcRenderer.invoke('settings:deleteProfile', confirmation),
  // One narration channel. `null` stops the current utterance; a string is a verdict to read.
  // Text only — the renderer cannot name a binary, a voice or a flag, so there is nothing here to
  // aim at anything but macOS's `say`.
  speak: (text: string | null): Promise<{ spoken: boolean; reason: string | null }> =>
    ipcRenderer.invoke('speech:speak', text),

  // Multiplayer (local relay). The socket lives in main behind an opt-in; the renderer only ever
  // sends actions and receives the already-redacted views main pushes on 'mp:event'. host/join are
  // refused in main while the opt-in is off, so nothing here can open a socket on its own.
  mpStatus: (): Promise<{ enabled: boolean; active: boolean }> => ipcRenderer.invoke('mp:status'),
  mpSetEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('mp:setEnabled', enabled),
  mpHost: (opts: { seatCount?: number }): Promise<unknown> => ipcRenderer.invoke('mp:host', opts),
  mpJoin: (address: { host: string; port: number; name?: string }): Promise<unknown> =>
    ipcRenderer.invoke('mp:join', address),
  mpAction: (action: unknown): Promise<void> => ipcRenderer.invoke('mp:action', action),
  mpDeal: (): Promise<void> => ipcRenderer.invoke('mp:deal'),
  mpStop: (): Promise<void> => ipcRenderer.invoke('mp:stop'),
  // Subscribe to pushed relay events (state broadcasts + errors). Returns an unsubscribe function.
  onMpEvent: (handler: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown): void => handler(event);
    ipcRenderer.on('mp:event', listener);
    return () => ipcRenderer.removeListener('mp:event', listener);
  },
});
