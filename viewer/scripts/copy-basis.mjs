// Copy the Basis Universal transcoder (JS + wasm) out of the installed three.js
// package into public/basis/ so both `vite dev` and the library build serve it as
// a same-origin sibling asset. KTX2Loader.setTranscoderPath() needs both files in
// one directory under their canonical names — hence a directory copy, not `?url`
// imports. This is the pipeline's "no runtime CDN" rule: the transcoder ships with
// the widget, it is never fetched from unpkg/jsdelivr at runtime.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../node_modules/three/examples/jsm/libs/basis');
const dest = resolve(here, '../public/basis');

const FILES = ['basis_transcoder.js', 'basis_transcoder.wasm'];

await mkdir(dest, { recursive: true });
for (const name of FILES) {
  await copyFile(resolve(src, name), resolve(dest, name));
}
console.log(`copied Basis transcoder (${FILES.join(', ')}) → public/basis/`);
