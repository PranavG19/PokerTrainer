// Lets `node` run a script that imports src/ modules: src/ writes `./x.js` for files that are `./x.ts`
// on disk (the bundler and tsc remap it; plain Node does not). Use: node --import ./scripts/ts-js-resolve.mjs <script.ts>
//
// It also transpiles every .ts file with the repo's own TypeScript (already a dependency), because Node's built-in
// type stripping refuses syntax src/ uses (an `enum`, in core/evaluate.ts) and Node 26 has no transform flag. Types are
// erased exactly as tsc would; nothing is type-checked here (that is `npm run typecheck`).
import { createRequire, registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0, -3) + '.ts', context);
      throw error;
    }
  },
  load(url, context, next) {
    if (!url.startsWith('file:') || !url.endsWith('.ts')) return next(url, context);
    const file = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf-8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, sourceMap: false },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  },
});
