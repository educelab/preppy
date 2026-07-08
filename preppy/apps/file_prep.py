"""``voyager-preppy`` — batch orchestrator for the delivery pipeline.

For each object in the input config, and for **each variant independently** (no
geometry grouping — ADR-0002 amended), run the validated chain:

1. Resolve the variant's texture(s) transitively from its OBJ's ``map_Kd``
   (``obj_helpers.parse_material_textures``) — one or many (multi-chart UV).
2. Normalize each texture to 8-bit sRGB PNG (dilating over ``nodataFill`` when
   resolved) and encode it to KTX2 (``texture``).
3. gltfpack the OBJ to decimated, meshopt-compressed geometry (``geometry``).
4. Embed every KTX2 into the geometry glb **by material name** -> one
   self-contained variant glb (``assemble``).

Then emit a per-object ``manifest.json`` (``manifest``) and, across objects, an
optional top-level ``index.json``. Output layout::

    out/
      index.json                         # optional host archive listing
      <prefix>/
        manifest.json                    # variants[].uri = "<prefix>_<suffix>[.<hash>].glb"
        <prefix>_<suffix>[.<hash>].glb   # one self-contained glb per variant

Asset filenames carry an inputs+config content hash by default (``--hash-names``)
so they can be served ``immutable``; ``manifest.json`` / ``index.json`` keep
stable names and hold the current hashed URIs (``cache``).

CLI flags for KTX2 mode, decimation error, no-data fill, and ``--prune`` land in
Phase 4; this phase wires the output layout, hashing, and ``--uri`` prefixing and
uses validated defaults for the rest.
"""

import argparse
import json
import shutil
from pathlib import Path
from typing import Dict, List, Mapping, Optional

from tqdm import tqdm

from preppy import assemble, cache, geometry, manifest, texture, tools
from preppy.geometry import DEFAULT_TARGET_ERROR
from preppy.obj_helpers import _mtllibs, parse_material_textures

#: External tools whose versions are folded into the content hash.
_HASH_TOOLS = ('magick', 'ktx', 'gltfpack', 'node')


def tool_versions() -> Dict[str, str]:
    """Version strings of the pipeline tools, for the content hash."""
    statuses = tools.check_all(_HASH_TOOLS)
    return {n: st.version_str for n, st in statuses.items() if st.version_str}


def resolve_obj_path(obj: str, data_root: Path) -> Path:
    """Resolve a config ``obj`` path (absolute, or relative to ``data_root``)."""
    p = Path(obj)
    return p if p.is_absolute() else (data_root / p)


def resolve_nodata_fill(variant: Mapping, object_cfg: Mapping,
                        cli_default: Optional[str]) -> Optional[str]:
    """No-data fill color, resolved *variant ?? object ?? CLI default*.

    A key **present** on the variant wins even if its value is ``null`` (which
    disables an inherited object/CLI default); absence falls through. Absent
    everywhere -> ``None`` (no dilation).
    """
    if 'nodataFill' in variant:
        return variant['nodataFill']
    if 'nodataFill' in object_cfg:
        return object_cfg['nodataFill']
    return cli_default


def hash_inputs(obj_path: Path, textures: Mapping[str, Path]) -> List[Path]:
    """Files whose bytes define a variant's output: OBJ + its MTLs + textures."""
    files = [obj_path]
    files.extend(_mtllibs(obj_path))
    files.extend(textures.values())
    return files


def process_variant(object_cfg: Mapping, variant: Mapping, *,
                    prefix: str, data_root: Path, obj_out_dir: Path,
                    tmp_dir: Path, opts: argparse.Namespace) -> Dict:
    """Run the full chain for one variant; return ``{suffix, name, uri}``.

    ``name`` is the emitted glb basename (hashed unless ``--no-hash-names``);
    ``uri`` is that name prefixed by ``--uri`` (relative within the object folder
    by default).
    """
    suffix = variant['suffix']
    obj_path = resolve_obj_path(variant['obj'], data_root)
    if not obj_path.is_file():
        raise FileNotFoundError(f'variant {suffix!r}: OBJ not found: {obj_path}')

    var_tmp = tmp_dir / suffix
    var_tmp.mkdir(parents=True, exist_ok=True)

    # 1. Resolve textures transitively (material name -> image), by name so the
    #    embed matches gltfpack's declaration-ordered materials (F1).
    ktx2_textures = parse_material_textures(obj_path)
    if not ktx2_textures:
        raise ValueError(
            f'variant {suffix!r}: no textured materials (map_Kd) found in '
            f'{obj_path}')

    nodata = resolve_nodata_fill(variant, object_cfg, opts.nodata_fill)

    # 2. Per texture: normalize -> KTX2. Keep the first normalized PNG as the
    #    thumbnail source (used only if this is the default variant).
    ktx2_by_material: Dict[str, Path] = {}
    thumb_src: Optional[Path] = None
    for name, img in ktx2_textures.items():
        png = texture.normalize(img, tmp_dir=var_tmp, max_dim=opts.max_dim,
                                nodata_fill=nodata)
        if thumb_src is None:
            thumb_src = png
        ktx2_by_material[name] = texture.encode_ktx2(
            png, dst=var_tmp / f'{name}.ktx2', mode=opts.ktx2_mode)

    # 3. gltfpack -> decimated meshopt geometry glb (UVs kept "used").
    geom = geometry.obj_to_geometry_glb(
        obj_path, var_tmp / 'geom.glb', target_error=opts.target_error)

    # 3b. Optional Hausdorff gate on the decimation (opt-in; pymeshlab can't read
    #     the meshopt glb, so validate a plain re-pack at the same -si). Runs
    #     before the asset is written, so an over-budget variant fails clean.
    if opts.validate and opts.target_error is not None:
        plain = geometry.obj_to_geometry_glb(
            obj_path, var_tmp / 'geom_plain.glb', target_error=opts.target_error,
            meshopt=False, quantize=False)
        res = geometry.validate(obj_path, plain, budget=opts.deviation_budget)
        detail = f'max={res.max_distance:.4g}'
        if res.max_fraction_of_diagonal is not None:
            detail += f' ({res.max_fraction_of_diagonal * 100:.3g}% of bbox)'
        if res.within_budget is False:
            raise RuntimeError(
                f'variant {suffix!r}: decimation deviation {detail} exceeds '
                f'--deviation-budget {opts.deviation_budget}')
        print(f'  validated {suffix}: Hausdorff {detail}')

    # 4. Name the output asset (content hash over inputs+config, never output).
    digest = None
    if opts.hash_names:
        config = {'target_error': opts.target_error, 'ktx2_mode': opts.ktx2_mode,
                  'max_dim': opts.max_dim, 'nodata_fill': nodata}
        digest = cache.content_hash(
            hash_inputs(obj_path, ktx2_textures), config=config,
            tool_versions=opts.tool_versions)
    name = cache.hashed_name(prefix, suffix, digest)

    # 5. Embed KTX2 (by name) -> one self-contained variant glb.
    assemble.embed(geom, ktx2_by_material, obj_out_dir / name)

    return {'suffix': suffix, 'name': name, 'uri': f'{opts.uri}{name}',
            'thumb_src': thumb_src}


def process_object(object_cfg: Mapping, *, data_root: Path, out_dir: Path,
                   tmp_dir: Path, opts: argparse.Namespace,
                   progress: Optional[tqdm] = None) -> Dict:
    """Process one object: emit its variant glbs + ``manifest.json``; return an
    ``index.json`` entry for it."""
    object_id = object_cfg['id']
    prefix = object_cfg.get('prefix', object_id)
    variants = object_cfg.get('variants') or []
    if not variants:
        raise ValueError(f'object {object_id!r} declares no variants')

    obj_out_dir = out_dir / prefix
    obj_out_dir.mkdir(parents=True, exist_ok=True)
    obj_tmp = tmp_dir / prefix

    default_idx = manifest.default_variant_index(variants)
    if progress is not None:
        progress.reset(len(variants))

    entries = []
    asset_names = []
    default_thumb_src = None
    for i, variant in enumerate(variants):
        if progress is not None:
            progress.set_description_str(variant.get('label', variant['suffix']))
        result = process_variant(
            object_cfg, variant, prefix=prefix, data_root=data_root,
            obj_out_dir=obj_out_dir, tmp_dir=obj_tmp, opts=opts)
        entries.append(manifest.variant_entry(
            variant, result['uri'], default=(i == default_idx)))
        asset_names.append(result['name'])
        if i == default_idx:
            default_thumb_src = result['thumb_src']
        if progress is not None:
            progress.update()

    man = manifest.build_manifest(object_cfg, entries)
    manifest.write_json(man, obj_out_dir / 'manifest.json')

    # Thumbnail: a downscaled center-crop of the default variant's texture (A5).
    thumb_rel = None
    if opts.thumbnails and default_thumb_src is not None:
        thumb_name = f'{prefix}_thumb.jpg'
        texture.thumbnail(default_thumb_src, obj_out_dir / thumb_name,
                          size=opts.thumbnail_size)
        thumb_rel = f'{prefix}/{thumb_name}'
        asset_names.append(thumb_name)

    if opts.prune:
        removed = cache.prune(obj_out_dir, keep=asset_names)
        if removed:
            print(f'  pruned {len(removed)} stale asset(s) from {prefix}/')

    return manifest.index_entry(
        object_id, man.get('title', object_id),
        manifest_uri=f'{prefix}/manifest.json', thumb=thumb_rel)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Prepare OBJ datasets for DRI Voyager: one self-contained '
                    'glb per variant + a per-object manifest.')
    parser.add_argument('-i', '--input', type=str, metavar='FILE', required=True,
                        help='JSON config: array of objects, each with variants')
    parser.add_argument('-o', '--output', type=str, metavar='DIR',
                        default='out', help='Output directory (default: out/)')
    parser.add_argument('--data-root', type=str, metavar='DIR', default=None,
                        help='Root that relative obj paths resolve against '
                             '(default: current working directory)')

    tex_opts = parser.add_argument_group('texture options')
    tex_opts.add_argument('--ktx2-mode', choices=['etc1s', 'uastc'],
                          default='etc1s',
                          help='KTX2/Basis codec (default: etc1s)')
    tex_opts.add_argument('-d', '--max-dim', type=int, default=8192,
                          metavar='INT',
                          help='Downsize textures larger than this (default: 8192)')
    tex_opts.add_argument('--nodata-fill', default=None, metavar='COLOR',
                          help='Default atlas no-data fill color to dilate over '
                               '(overridden per object/variant by nodataFill)')

    geo_opts = parser.add_argument_group('geometry options')
    geo_opts.add_argument('-s', '--decimate-error', type=float,
                          default=DEFAULT_TARGET_ERROR, metavar='FLOAT',
                          help='gltfpack -si error-bounded simplification target '
                               f'(default: {DEFAULT_TARGET_ERROR})')
    geo_opts.add_argument('--no-decimate', action='store_true',
                          help='Meshopt-compress without simplifying (skip -si)')
    geo_opts.add_argument('--validate', action='store_true',
                          help='Hausdorff-validate each decimation (needs the '
                               'pymeshlab extra; adds a plain gltfpack pass)')
    geo_opts.add_argument('--deviation-budget', type=float, default=None,
                          metavar='FLOAT',
                          help='Max allowed Hausdorff deviation in mesh units; '
                               'over budget fails the run (report-only if unset)')

    out_opts = parser.add_argument_group('output options')
    out_opts.add_argument('--hash-names', default=True,
                          action=argparse.BooleanOptionalAction,
                          help='Insert an inputs+config content hash into asset '
                               'filenames (served immutable). Default: on.')
    out_opts.add_argument('--uri', default='',
                          help='URI prefix prepended to each variant glb name in '
                               'the manifest (default: relative, within folder)')
    out_opts.add_argument('--prune', action='store_true',
                          help='After writing, delete hashed asset files in each '
                               'object folder no longer referenced by its manifest')
    out_opts.add_argument('--thumbnails', default=True,
                          action=argparse.BooleanOptionalAction,
                          help='Emit a <prefix>_thumb.jpg per object (cropped '
                               'from the default variant texture). Default: on.')
    out_opts.add_argument('--thumbnail-size', type=int, default=512,
                          metavar='INT',
                          help='Square thumbnail edge in px (default: 512)')

    adv_opts = parser.add_argument_group('advanced options')
    adv_opts.add_argument('--keep-tmp', default=False,
                          action=argparse.BooleanOptionalAction,
                          help='Keep the temporary files directory')

    return parser


def _normalize_args(args: argparse.Namespace) -> argparse.Namespace:
    """Map raw CLI names to the knobs the processing code reads."""
    args.target_error = None if args.no_decimate else args.decimate_error
    # Relative obj paths resolve against --data-root, defaulting to the CWD.
    args.data_root = (Path(args.data_root).resolve() if args.data_root
                      else Path.cwd())
    # Normalize --uri to end in a separator when non-empty.
    if args.uri and not args.uri.endswith('/'):
        args.uri += '/'
    return args


def main():
    args = _normalize_args(_build_parser().parse_args())

    config_path = Path(args.input)
    print('Loading input config...')
    with config_path.open() as f:
        config = json.load(f)
    if not isinstance(config, list):
        raise SystemExit('Input config must be a JSON array of objects.')

    num_variants = sum(len(o.get('variants') or []) for o in config)
    print(f'Loaded: {len(config)} object(s), {num_variants} variant(s)')
    print(f'Resolving relative obj paths against {args.data_root}')

    out_dir = Path(args.output)
    tmp_dir = out_dir / 'tmp'
    out_dir.mkdir(parents=True, exist_ok=True)

    # Tool versions are stable across the run; compute once for the hash.
    args.tool_versions = tool_versions() if args.hash_names else {}

    index_objects = []
    outer = tqdm(config, desc='Objects')
    inner = tqdm(desc='Variants', leave=False)
    for object_cfg in outer:
        outer.set_description_str(f'Object {object_cfg.get("id", "?")}')
        index_objects.append(process_object(
            object_cfg, data_root=args.data_root, out_dir=out_dir,
            tmp_dir=tmp_dir, opts=args, progress=inner))
    inner.close()
    outer.close()

    print('Writing index.json')
    manifest.write_json(manifest.build_index(index_objects),
                        out_dir / 'index.json')

    if not args.keep_tmp and tmp_dir.exists():
        print('Cleaning up')
        shutil.rmtree(tmp_dir)
    print('Done')


if __name__ == '__main__':
    main()
