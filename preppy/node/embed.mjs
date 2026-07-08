// Embed pre-encoded KTX2 textures into a gltfpack geometry glb, matching each
// KTX2 to its material BY NAME (gltfpack's material order follows MTL
// declaration order, which is not numeric order — see Phase 0 finding F1).
//
// Registering MeshoptEncoder as a write dependency is what preserves
// EXT_meshopt_compression across the read/write round-trip (finding F3);
// KHR_texture_transform survives untouched because we only swap the image.
//
// Usage:
//   node embed.mjs --geom <geom.glb> --out <variant.glb> \
//        --map <materialName>=<texture.ktx2> [--map ...] [--opaque]
//
// --opaque forces alphaMode=OPAQUE and baseColorFactor.a=1 on each remapped
// material, a defensive fix for OpenMVS 'Tr 1.0' opacity ambiguity (F2).

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const opts = { map: {}, opaque: false, geom: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--geom') opts.geom = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--opaque') opts.opaque = true;
    else if (a === '--map') {
      const kv = argv[++i];
      const eq = kv.indexOf('=');
      if (eq < 0) throw new Error(`--map expects name=path, got "${kv}"`);
      opts.map[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!opts.geom || !opts.out) throw new Error('--geom and --out are required');
  if (Object.keys(opts.map).length === 0) throw new Error('at least one --map required');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });

  const doc = await io.read(opts.geom);
  const root = doc.getRoot();
  const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true);

  const materials = root.listMaterials();
  const names = materials.map((m) => m.getName());
  for (const name of Object.keys(opts.map)) {
    if (!names.includes(name)) {
      throw new Error(
        `material "${name}" not found in ${opts.geom}; available: ${names.join(', ')}`);
    }
  }

  for (const mat of materials) {
    const name = mat.getName();
    const file = opts.map[name];
    if (!file) {
      // A material we were not asked to remap (e.g. an unused MTL 'default'
      // with no map_Kd). Leave it untouched.
      if (mat.getBaseColorTexture()) {
        console.error(`note: material "${name}" not in map; keeping its original texture`);
      }
      continue;
    }
    const tex = mat.getBaseColorTexture();
    if (!tex) throw new Error(`material "${name}" has no baseColorTexture to replace`);
    tex.setImage(new Uint8Array(readFileSync(file))).setMimeType('image/ktx2');
    if (opts.opaque) {
      const f = mat.getBaseColorFactor();
      f[3] = 1.0;
      mat.setBaseColorFactor(f).setAlphaMode('OPAQUE');
    }
    console.error(`embedded ${file} -> material "${name}"`);
  }

  await io.write(opts.out, doc);
  console.error(`wrote ${opts.out}`);
}

main().catch((e) => {
  console.error(`embed.mjs error: ${e.message}`);
  process.exit(1);
});
