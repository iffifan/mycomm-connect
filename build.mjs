// Writes dist/: the readable module, minified copies (module and a classic <script> bundle) with source maps, the type
// declarations, and prints the SRI hash of each file to paste into the changelog and the release notes.
//
// The published bundles do not accept http://localhost session links. `MYCOMM_CONNECT_DEV=1 node build.mjs` keeps them.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const dev = process.env.MYCOMM_CONNECT_DEV === '1';
const define = { __MYCOMM_CONNECT_DEV__: String(dev) };
const common = { bundle: true, target: 'es2020', legalComments: 'none', define };

mkdirSync('dist', { recursive: true });
copyFileSync('src/mycomm-connect.d.ts', 'dist/mycomm-connect.d.ts');

// Readable module, with the dev switch resolved.
await build({ ...common, entryPoints: ['src/mycomm-connect.js'], outfile: 'dist/mycomm-connect.js', format: 'esm', sourcemap: true });
// Minified module for `<script type="module">`.
await build({ ...common, entryPoints: ['src/mycomm-connect.js'], outfile: 'dist/mycomm-connect.min.js', format: 'esm', minify: true, sourcemap: true });
// Classic script: sets window.MyCommConnect.
writeFileSync('dist/iife-entry.js', "import MyCommConnect from '../src/mycomm-connect.js';\nglobalThis.MyCommConnect = MyCommConnect;\n");
await build({ ...common, entryPoints: ['dist/iife-entry.js'], outfile: 'dist/mycomm-connect.iife.min.js', format: 'iife', minify: true, sourcemap: true });

rmSync('dist/iife-entry.js');

for (const file of ['mycomm-connect.js', 'mycomm-connect.min.js', 'mycomm-connect.iife.min.js']) {
  const hash = createHash('sha384').update(readFileSync(`dist/${file}`)).digest('base64');
  console.log(`dist/${file}  sha384-${hash}`);
}
if (dev) {
  console.log('Built with MYCOMM_CONNECT_DEV=1: http://localhost session links are accepted. Do not publish this build.');
}
