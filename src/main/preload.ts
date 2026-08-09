import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('offsuit', {
  loadState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('store:load'),
  saveState: (obj: Record<string, unknown>): Promise<void> => ipcRenderer.invoke('store:save', obj),
  getSeed: (): Promise<number | null> => ipcRenderer.invoke('app:seed'),
});
