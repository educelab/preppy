# DRI Voyager Preppy

Prepares captured, textured meshes of physical artifacts (Herculaneum papyri) for
display in a web 3D viewer. Turns large source OBJs + textures into
web-deliverable geometry and texture assets plus the manifest a viewer consumes.

## Language

**Object**:
The physical artifact being displayed (e.g. *P.Herc. 1061 Cr. 5*). One object is
imaged in several ways.
_Avoid_: model, mesh, fragment (reserve "mesh" for a specific OBJ file)

**Variant**:
One displayable version of an object — a distinct mesh with its texture(s) that
the viewer can switch to while holding the camera fixed. An object has several
variants. They may differ in imaging modality (RGB, IR1050, PGS, spectral, …),
in processing, or in geometry; the spectral framing is one *source* of variants,
not the definition. One variant is the default (shown first).
A variant's texture is **one or more image files** — a single mesh can carry a
multi-chart / atlas-split UV layout spread across several textures (the MVS
texturing step commonly emits `material_00`, `material_01`, …). Texture *count*
is an internal detail; a variant still ships as one self-contained glb.
_Avoid_: band (too spectral-specific), view (collides with the camera
viewpoint), version (implies temporal revisions), layer, channel

**Scene**:
The set of an object's variants the viewer widget loads together — i.e. one
object's manifest. The widget shows exactly one scene (one object) at a time and
displays one variant at a time; browsing *between* objects is the host page's
concern, not the widget's.
_Avoid_: document (a Voyager term we are leaving behind)

**Geometry group**:
A set of an object's variants whose meshes have **byte-identical vertex positions
*and* UV coordinates** — the same underlying scan, differing only in texture
image. Real but rare (matching UVs are hard to produce). A property of the data,
*not* a delivered asset: each variant ships as its own self-contained geometry,
so a geometry group is an observation, not something the format exploits.
_Avoid_: LOD (about texture identity, not resolution)
