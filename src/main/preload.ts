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
  // The confirmation phrase is re-checked in main; sending it is not authorising it.
  deleteProfile: (confirmation: string): Promise<unknown> =>
    ipcRenderer.invoke('settings:deleteProfile', confirmation),
});
