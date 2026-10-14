// Lets `node` run a script that imports src/ modules: src/ writes `./x.js` for files that are `./x.ts`
// on disk (the bundler and tsc remap it; plain Node does not). Use: node --import ./scripts/ts-js-resolve.mjs <script.ts>
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) return next(specifier.slice(0, -3) + '.ts', context);
      throw error;
    }
  },
});
