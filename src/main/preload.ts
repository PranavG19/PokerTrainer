import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('offsuit', {
  loadState: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('store:load'),
  /** `{ saved: false, readOnly }` when main refused the write (a newer or externally changed profile). */
  saveState: (obj: Record<string, unknown>): Promise<{ saved: boolean; readOnly: string | null; failed?: string }> =>
    ipcRenderer.invoke('store:save', obj),
  getSeed: (): Promise<number | null> => ipcRenderer.invoke('app:seed'),
  saveStyleCard: (rect: { x: number; y: number; width: number; height: number }): Promise<string> =>
    ipcRenderer.invoke('style:saveCard', rect),
  // e2e only: the test clock and the onboarding switch (main answers the real defaults otherwise).
  testHooks: (): Promise<{ now: number | null; onboarding: boolean }> => ipcRenderer.invoke('app:testHooks'),
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

  // Dee chat's optional phrasing model. Only a template id and typed slots cross; main re-renders and re-checks
  // them. download() needs the literal consent flag and the licence ids the learner was shown.
  deePhrasingStatus: (): Promise<unknown> => ipcRenderer.invoke('dee:phrasing:status'),
  deePhrasingDownload: (consent: boolean, licences: string): Promise<unknown> =>
    ipcRenderer.invoke('dee:phrasing:download', consent, licences),
  deePhrasingCancel: (): Promise<unknown> => ipcRenderer.invoke('dee:phrasing:cancel'),
  deePhrasingDelete: (): Promise<unknown> => ipcRenderer.invoke('dee:phrasing:delete'),
  deePhrasingSetEnabled: (on: boolean): Promise<unknown> => ipcRenderer.invoke('dee:phrasing:setEnabled', on),
  deeChatWarm: (): Promise<void> => ipcRenderer.invoke('dee:chat:warm'),
  deeChatPhrase: (req: { templateId: string; slots: Record<string, string> }): Promise<unknown> =>
    ipcRenderer.invoke('dee:chat:phrase', req),
  onDeePhrasing: (handler: (status: unknown) => void): (() => void) => {
    const listener = (_e: unknown, status: unknown): void => handler(status);
    ipcRenderer.on('dee:phrasing', listener);
    return () => ipcRenderer.removeListener('dee:phrasing', listener);
  },

  // Multiplayer (local relay). The socket lives in main behind an opt-in; the renderer only ever
  // sends actions and receives the already-redacted views main pushes on 'mp:event'. host/join are
  // refused in main while the opt-in is off, so nothing here can open a socket on its own.
  mpStatus: (): Promise<{ enabled: boolean; active: boolean }> => ipcRenderer.invoke('mp:status'),
  mpSetEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('mp:setEnabled', enabled),
  mpHost: (opts: { seatCount?: number; name?: string }): Promise<unknown> => ipcRenderer.invoke('mp:host', opts),
  mpJoin: (request: { invite: string; name?: string }): Promise<unknown> => ipcRenderer.invoke('mp:join', request),
  mpAction: (action: unknown): Promise<void> => ipcRenderer.invoke('mp:action', action),
  mpDeal: (): Promise<void> => ipcRenderer.invoke('mp:deal'),
  mpStop: (): Promise<void> => ipcRenderer.invoke('mp:stop'),
  // Licensing. Main verifies and decides; the renderer gets a display snapshot and sends a pasted key
  // or a plan name, never a URL and never a grant. Refresh and restore are the only calls that use the
  // network, and only when the learner presses them.
  licenceStatus: (): Promise<unknown> => ipcRenderer.invoke('licence:status'),
  licenceActivate: (key: string): Promise<unknown> => ipcRenderer.invoke('licence:activate', key),
  licenceRemove: (): Promise<unknown> => ipcRenderer.invoke('licence:remove'),
  licenceOpenCheckout: (plan: 'monthly' | 'annual'): Promise<{ opened: boolean }> =>
    ipcRenderer.invoke('licence:openCheckout', plan),
  licenceOpenManage: (): Promise<{ opened: boolean }> => ipcRenderer.invoke('licence:openManage'),
  licenceRefresh: (): Promise<unknown> => ipcRenderer.invoke('licence:refresh'),
  licenceRestore: (input: { orderId: string; email: string }): Promise<unknown> =>
    ipcRenderer.invoke('licence:restore', input),
  licenceDeepLinkPreview: (): Promise<unknown> => ipcRenderer.invoke('licence:deeplinkPreview'),
  // `id` is the one the preview returned: main installs only the key the learner was shown.
  licenceDeepLinkConfirm: (accept: boolean, id: string): Promise<unknown> =>
    ipcRenderer.invoke('licence:deeplinkConfirm', accept, id),
  onLicenceDeepLink: (handler: () => void): (() => void) => {
    const listener = (): void => handler();
    ipcRenderer.on('licence:deeplink', listener);
    return () => ipcRenderer.removeListener('licence:deeplink', listener);
  },
  // Online play (an Offsuit server). Main holds the socket and the device key; the renderer sends
  // requests and receives events. Nothing here opens a connection until onlineConnect, which main
  // refuses unless online play is on, a server is set and the player confirmed they are 18 or over.
  onlineStatus: (): Promise<unknown> => ipcRenderer.invoke('online:status'),
  onlineConfigure: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('online:configure', patch),
  onlineConnect: (request: unknown): Promise<unknown> => ipcRenderer.invoke('online:connect', request),
  onlineRequest: (op: string, fields?: unknown): Promise<unknown> => ipcRenderer.invoke('online:request', op, fields),
  onlineAction: (action: unknown): Promise<void> => ipcRenderer.invoke('online:action', action),
  onlineEmote: (emote: string): Promise<void> => ipcRenderer.invoke('online:emote', emote),
  onlineLeave: (): Promise<void> => ipcRenderer.invoke('online:leave'),
  onlineDisconnect: (): Promise<void> => ipcRenderer.invoke('online:disconnect'),
  onlineExportIdentity: (): Promise<string | null> => ipcRenderer.invoke('online:exportIdentity'),
  onOnlineEvent: (handler: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown): void => handler(event);
    ipcRenderer.on('online:event', listener);
    return () => ipcRenderer.removeListener('online:event', listener);
  },
  // Profile export and import. Main opens the dialogs; nothing here names a path. An import is a pick (a
  // checked preview under an id) then a confirm naming that id; main copies the current profile aside first.
  profileExport: (): Promise<unknown> => ipcRenderer.invoke('profile:export'),
  profileImportPick: (): Promise<unknown> => ipcRenderer.invoke('profile:importPick'),
  profileImportConfirm: (id: string, accept: boolean): Promise<unknown> =>
    ipcRenderer.invoke('profile:importConfirm', id, accept),
  // Pro tools. Main opens the file dialog itself and reads only what it returns: nothing here names a path.
  // Each answers { locked } without Pro, except deleting imported hands, which is never locked.
  proImportHands: (): Promise<unknown> => ipcRenderer.invoke('pro:importHands'),
  proHandsReport: (): Promise<unknown> => ipcRenderer.invoke('pro:handsReport'),
  proClearHands: (): Promise<unknown> => ipcRenderer.invoke('pro:clearHands'),
  proShove: (request: unknown): Promise<unknown> => ipcRenderer.invoke('pro:shove', request),
  // Subscribe to pushed relay events (state broadcasts + errors). Returns an unsubscribe function.
  onMpEvent: (handler: (event: unknown) => void): (() => void) => {
    const listener = (_e: unknown, event: unknown): void => handler(event);
    ipcRenderer.on('mp:event', listener);
    return () => ipcRenderer.removeListener('mp:event', listener);
  },
});
