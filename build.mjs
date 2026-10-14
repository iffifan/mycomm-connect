// Writes dist/: the readable module, a minified copy and the type declarations.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
copyFileSync('src/mycomm-connect.js', 'dist/mycomm-connect.js');
copyFileSync('src/mycomm-connect.d.ts', 'dist/mycomm-connect.d.ts');
await build({
  entryPoints: ['src/mycomm-connect.js'],
  outfile: 'dist/mycomm-connect.min.js',
  format: 'esm',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
