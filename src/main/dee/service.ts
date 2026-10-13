/**
 * "Smarter phrasing": the opt-in install, and the sidecar's lifecycle. Main process only.
 *
 * Install: on the learner's consent click only, the runtime archive then the model are fetched (download.ts),
 * verified against the pinned manifest, the archive's entries checked (no absolute or `..` paths) and unpacked
 * with the system `tar`, and an install receipt written with the server binary's own sha256. Everything lives
 * in `<userData>/dee-model/`; Delete removes that directory.
 *
 * Run: the sidecar starts lazily when the chat panel opens (`warm`), does one throwaway rewording so the first
 * real answer is not the cold one, stops after ten idle minutes and on quit, and is restarted at most once per
 * session after a crash; after that, the scripted answers carry the rest of the session. Before every start the
 * binary's hash is checked against the receipt, so a swapped binary never runs.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fetchVerified, sha256File, type Progress } from './download.js';
import { platformKey, type PhrasingManifest, type RuntimeAsset } from './manifest.js';
import { Phraser, PERSONA, type PhraseModel, type PhraseRequest, type PhraseResult } from './phrasing.js';
import { LlamaSidecar } from './sidecar.js';

/**
 * `execFile` as a promise of its stdout. Written out rather than `util.promisify`: the test-mode network oracle
 * wraps `execFile` (netOracle.ts), which drops promisify's custom `{ stdout, stderr }` form.
 */
function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}
export const IDLE_STOP_MS = 10 * 60_000;
const TAR = '/usr/bin/tar';

export type InstallState = 'unavailable' | 'absent' | 'downloading' | 'installed' | 'error';

export interface PhrasingStatus {
  readonly state: InstallState;
  readonly enabled: boolean;
  readonly received: number;
  readonly total: number;
  readonly error: string | null;
  readonly sizeBytes: number;
  readonly licences: PhrasingManifest['licences'];
  readonly name: string;
  /** Whether the sidecar is up right now (for the settings row's caption). */
  readonly running: boolean;
}

interface Receipt {
  readonly manifestId: string;
  readonly modelSha256: string;
  readonly binarySha256: string;
  readonly binary: string;
}

export interface PhrasingDeps {
  readonly dir: string;
  readonly manifest: PhrasingManifest;
  readonly testLoopback: boolean;
  readonly loadEnabled: () => boolean;
  readonly saveEnabled: (on: boolean) => void;
  readonly onStatus: (s: PhrasingStatus) => void;
  /** How long a start may take to answer /health (tests shorten it). */
  readonly readyTimeoutMs?: number;
  /** For tests: what to run instead of the real sidecar. */
  readonly makeModel?: (binary: string, model: string) => PhraseModel & { start(): Promise<void>; stop(): void; onExit: ((code: number | null) => void) | null; readonly running: boolean };
}

export class PhrasingService {
  private progress: Progress = { received: 0, total: 0 };
  private downloading: AbortController | null = null;
  private error: string | null = null;
  private sidecar: ReturnType<NonNullable<PhrasingDeps['makeModel']>> | null = null;
  private restarts = 0;
  private failedThisSession = false;
  private idle: ReturnType<typeof setTimeout> | null = null;
  /** True while warm() is starting the sidecar: a death then is counted once, by warm's own catch. */
  private starting = false;
  readonly phraser: Phraser;

  constructor(private readonly deps: PhrasingDeps) {
    this.phraser = new Phraser(() => this.activeModel());
  }

  private get runtime(): RuntimeAsset | undefined {
    return this.deps.manifest.runtimes[platformKey()];
  }
  private get modelFile(): string {
    return path.join(this.deps.dir, 'model.gguf');
  }
  private get receiptFile(): string {
    return path.join(this.deps.dir, 'installed.json');
  }

  private receipt(): Receipt | null {
    try {
      const r = JSON.parse(fs.readFileSync(this.receiptFile, 'utf8')) as Receipt;
      if (r.manifestId !== this.deps.manifest.id || r.modelSha256 !== this.deps.manifest.model.sha256) return null;
      if (!fs.existsSync(r.binary) || fs.statSync(this.modelFile).size !== this.deps.manifest.model.size) return null;
      return r;
    } catch {
      return null;
    }
  }

  status(): PhrasingStatus {
    const installed = this.receipt() !== null;
    const state: InstallState =
      this.runtime === undefined ? 'unavailable' : this.downloading ? 'downloading' : installed ? 'installed' : this.error ? 'error' : 'absent';
    return {
      state,
      enabled: installed && this.deps.loadEnabled(),
      received: this.progress.received,
      total: this.progress.total,
      error: this.error,
      sizeBytes: this.deps.manifest.model.size + (this.runtime?.size ?? 0),
      licences: this.deps.manifest.licences,
      name: this.deps.manifest.name,
      running: this.sidecar?.running ?? false,
    };
  }

  private emit(): void {
    this.deps.onStatus(this.status());
  }

  /**
   * The only network use. `consent` must be the literal `true` and `licences` the manifest's SPDX ids, so a
   * renderer bug that calls this without the learner's click (and the licence they were shown) does nothing.
   */
  async download(consent: unknown, licences: unknown): Promise<PhrasingStatus> {
    const expected = this.deps.manifest.licences.map((l) => l.spdx).join('+');
    const runtime = this.runtime;
    if (consent !== true || licences !== expected || runtime === undefined || this.downloading || this.receipt()) return this.status();
    const controller = new AbortController();
    this.downloading = controller;
    this.error = null;
    const total = runtime.size + this.deps.manifest.model.size;
    this.progress = { received: 0, total };
    this.emit();
    const staging = path.join(this.deps.dir, 'staging');
    try {
      fs.mkdirSync(this.deps.dir, { recursive: true, mode: 0o700 });
      fs.rmSync(staging, { recursive: true, force: true });
      fs.mkdirSync(staging, { mode: 0o700 });
      const archive = path.join(staging, 'runtime.tar.gz');
      await fetchVerified(runtime, archive, {
        signal: controller.signal,
        testLoopback: this.deps.testLoopback,
        onProgress: (p) => {
          this.progress = { received: p.received, total };
          this.emit();
        },
      });
      const binary = await this.unpack(archive, staging, runtime);
      await fetchVerified(this.deps.manifest.model, this.modelFile, {
        signal: controller.signal,
        testLoopback: this.deps.testLoopback,
        onProgress: (p) => {
          this.progress = { received: runtime.size + p.received, total };
          this.emit();
        },
      });
      const receipt: Receipt = { manifestId: this.deps.manifest.id, modelSha256: this.deps.manifest.model.sha256, binarySha256: await sha256File(binary), binary };
      fs.writeFileSync(this.receiptFile, JSON.stringify(receipt, null, 2), { mode: 0o600 });
      this.deps.saveEnabled(true);
    } catch (e) {
      this.error = controller.signal.aborted ? 'cancelled' : e instanceof Error ? e.message : String(e);
      this.removeFiles({ keepError: true });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      this.downloading = null;
      this.emit();
    }
    return this.status();
  }

  /** List, then unpack, the verified archive; returns the installed binary's path. */
  private async unpack(archive: string, staging: string, runtime: RuntimeAsset): Promise<string> {
    const stdout = await run(TAR, ['-tzf', archive]);
    const entries = stdout.split('\n').filter(Boolean);
    if (entries.some((e) => path.isAbsolute(e) || e.split('/').includes('..') || !e.startsWith(`${runtime.root}/`))) {
      throw new Error('runtime archive has an unexpected path');
    }
    await run(TAR, ['-xzf', archive, '-C', staging, '--no-same-owner']);
    fs.rmSync(archive, { force: true });
    const unpacked = path.join(staging, runtime.root);
    const target = path.join(this.deps.dir, 'runtime');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { mode: 0o700 });
    fs.renameSync(unpacked, path.join(target, runtime.root));
    const binary = path.join(target, runtime.root, runtime.binary);
    if (!fs.statSync(binary).isFile()) throw new Error('runtime archive has no server binary');
    fs.chmodSync(binary, 0o755);
    return binary;
  }

  cancel(): PhrasingStatus {
    this.downloading?.abort();
    return this.status();
  }

  remove(): PhrasingStatus {
    this.downloading?.abort();
    this.removeFiles({ keepError: false });
    this.emit();
    return this.status();
  }

  private removeFiles(opts: { keepError: boolean }): void {
    this.stop();
    fs.rmSync(this.deps.dir, { recursive: true, force: true });
    this.progress = { received: 0, total: 0 };
    if (!opts.keepError) this.error = null;
  }

  setEnabled(on: unknown): PhrasingStatus {
    this.deps.saveEnabled(on === true);
    if (on !== true) this.stop();
    this.emit();
    return this.status();
  }

  /** The model to reword with right now, or null: the scripted answers. Never starts a process by itself. */
  private activeModel(): PhraseModel | null {
    if (this.failedThisSession || !this.status().enabled || this.sidecar === null) return null;
    this.touch();
    return this.sidecar;
  }

  /** The chat panel opened: start the sidecar if it is installed and on, and warm it with one throwaway rewording. */
  async warm(): Promise<void> {
    const receipt = this.receipt();
    if (this.failedThisSession || receipt === null || !this.deps.loadEnabled()) return;
    if (this.sidecar === null) {
      if ((await sha256File(receipt.binary)) !== receipt.binarySha256) {
        this.failedThisSession = true;
        this.error = 'the runtime binary changed on disk; reinstall smarter phrasing';
        this.emit();
        return;
      }
      const make =
        this.deps.makeModel ?? ((binary: string, model: string) => new LlamaSidecar({ binary, model }, this.deps.manifest.id, this.deps.readyTimeoutMs));
      const sidecar = make(receipt.binary, this.modelFile);
      sidecar.onExit = () => {
        this.sidecar = null;
        // A crash: one restart per session, then the written lines for the rest of it.
        if (!this.starting && ++this.restarts > 1) this.failedThisSession = true;
        this.emit();
      };
      this.sidecar = sidecar;
    }
    this.touch();
    this.starting = true;
    try {
      await this.sidecar.start();
      await this.sidecar.rewrite({ persona: PERSONA, scripted: 'The price is the call over the pot after the call.', facts: [] }, new AbortController().signal);
    } catch {
      // A failed start is counted like a crash and torn down here, so nothing relaunches it unchecked: the next
      // start goes through warm() again (binary hash first), once per session, then the written lines.
      this.stop();
      // Turning phrasing off mid-start stops it on purpose; that is not a failure.
      if (this.deps.loadEnabled() && ++this.restarts > 1) this.failedThisSession = true;
    } finally {
      this.starting = false;
    }
    this.emit();
  }

  phrase(req: PhraseRequest): Promise<PhraseResult> {
    return this.phraser.phrase(req);
  }

  private touch(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => this.stop(), IDLE_STOP_MS);
    this.idle.unref?.();
  }

  stop(): void {
    if (this.idle) clearTimeout(this.idle);
    this.idle = null;
    const s = this.sidecar;
    this.sidecar = null;
    if (s) {
      s.onExit = null;
      s.stop();
    }
  }
}
