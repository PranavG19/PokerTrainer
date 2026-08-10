import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('offsuit', {
  loadState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('store:load'),
  saveState: (obj: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('store:save', obj),
  getSeed: (): Promise<number | null> => ipcRenderer.invoke('app:seed'),
  // The tutor lives in main; the renderer only ever sees the answer text and
  // the built payload's key paths, never a model client or a solver field.
  tutorStatus: (): Promise<unknown> => ipcRenderer.invoke('tutor:status'),
  askTutor: (input: unknown): Promise<unknown> => ipcRenderer.invoke('tutor:ask', input),
});
