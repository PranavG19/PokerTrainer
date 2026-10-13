/**
 * The pinned manifest for "Smarter phrasing": exactly which bytes may be downloaded, from where, under which
 * licence. Nothing outside this file names a URL, and nothing is installed unless its size and sha256 match.
 *
 * Model: Qwen3-1.7B Q4_K_M (Apache-2.0), the research's best live candidate (TECH-LOCAL-LLM §4.3: 0 false
 * rewordings in 61, p50 194 ms). Runtime: llama.cpp `llama-server` b11588 (MIT), the release's own sha256
 * digests. Both licences were checked on 2026-10-13 against the Hugging Face API (`license:apache-2.0`, ungated,
 * for `Qwen/Qwen3-1.7B` and `unsloth/Qwen3-1.7B-GGUF`) and the llama.cpp LICENSE file.
 *
 * Only commercially permissive licences may appear here (PERMISSIVE_LICENCES); the manifest test enforces it.
 */

import * as fs from 'node:fs';

export interface PinnedAsset {
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
}

export interface RuntimeAsset extends PinnedAsset {
  /** The archive's top-level directory and the server binary inside it. */
  readonly root: string;
  readonly binary: string;
}

export interface Licence {
  readonly component: string;
  readonly spdx: string;
  readonly holder: string;
  readonly source: string;
  /** What the learner is agreeing to, in a sentence, shown before the download. */
  readonly summary: string;
}

export interface PhrasingManifest {
  readonly id: string;
  readonly name: string;
  readonly model: PinnedAsset;
  /** Keyed `${process.platform}-${process.arch}`. A platform with no entry shows the row as unavailable. */
  readonly runtimes: Readonly<Record<string, RuntimeAsset>>;
  readonly licences: readonly Licence[];
}

/** Licences that allow commercial use without field-of-use or revenue limits. */
export const PERMISSIVE_LICENCES = ['Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause'] as const;

const LLAMA_TAG = 'b11588';

export const PHRASING_MANIFEST: PhrasingManifest = {
  id: 'qwen3-1.7b-q4km+llama-b11588',
  name: 'Qwen3-1.7B (Q4_K_M) on llama.cpp',
  model: {
    url: 'https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/d7f544eead698dbd1f15126ef60b45a1e1933222/Qwen3-1.7B-Q4_K_M.gguf',
    size: 1_107_409_472,
    sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897',
  },
  runtimes: {
    'darwin-arm64': {
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-macos-arm64.tar.gz`,
      size: 12_112_245,
      sha256: '95039180209cb8b9a2fadedd03e061c5131fed17e1eb423b3dcf8c7848d12b9d',
      root: `llama-${LLAMA_TAG}`,
      binary: 'llama-server',
    },
    'darwin-x64': {
      url: `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-macos-x64.tar.gz`,
      size: 11_608_121,
      sha256: 'f9bda3b33fc42d91ffc6caa86e3ca42a720defd84b692065bdbff9a7dca03739',
      root: `llama-${LLAMA_TAG}`,
      binary: 'llama-server',
    },
  },
  licences: [
    {
      component: 'Qwen3-1.7B (the model)',
      spdx: 'Apache-2.0',
      holder: 'Alibaba Cloud (Qwen team); GGUF conversion by Unsloth',
      source: 'huggingface.co/Qwen/Qwen3-1.7B',
      summary: 'Apache License 2.0: free to use, including commercially; keep the licence and notices with copies.',
    },
    {
      component: 'llama.cpp (the runtime)',
      spdx: 'MIT',
      holder: 'The ggml authors',
      source: 'github.com/ggml-org/llama.cpp',
      summary: 'MIT License: free to use, including commercially; keep the copyright notice with copies.',
    },
  ],
};

/** Hosts a download may touch, including the CDNs the two origins redirect to. HTTPS only. */
export const DOWNLOAD_HOSTS: readonly (string | RegExp)[] = [
  'huggingface.co',
  /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.hf\.co$/,
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
];

/** Whether a URL is one a download may fetch (the first request or any redirect). */
export function downloadUrlAllowed(raw: string, testLoopback = false): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (testLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1') return true;
  if (url.protocol !== 'https:' || (url.port !== '' && url.port !== '443')) return false;
  const host = url.hostname.toLowerCase();
  return DOWNLOAD_HOSTS.some((h) => (typeof h === 'string' ? host === h : h.test(host)));
}

/**
 * The manifest in force. An e2e run (OFFSUIT_E2E=1) may point OFFSUIT_E2E_DEE_MANIFEST at a JSON manifest whose
 * every URL is on http://127.0.0.1, so a spec can drive the real download path against a loopback server and
 * prove the click is the only network use. Outside e2e, or with any non-loopback URL, the override is ignored.
 */
export function activeManifest(env: NodeJS.ProcessEnv = process.env, packaged = false): { manifest: PhrasingManifest; testLoopback: boolean } {
  // A packaged build never honours the test override, whatever its environment says.
  const file = env.OFFSUIT_E2E === '1' && !packaged ? env.OFFSUIT_E2E_DEE_MANIFEST : undefined;
  if (file !== undefined && file !== '') {
    try {
      const m = JSON.parse(fs.readFileSync(file, 'utf8')) as PhrasingManifest;
      const urls = [m.model.url, ...Object.values(m.runtimes).map((r) => r.url)];
      if (urls.every((u) => u.startsWith('http://127.0.0.1:'))) return { manifest: m, testLoopback: true };
    } catch {
      // A broken test manifest falls through to the pinned one.
    }
  }
  return { manifest: PHRASING_MANIFEST, testLoopback: false };
}

export const platformKey = (): string => `${process.platform}-${process.arch}`;
