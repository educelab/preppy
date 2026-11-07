# syntax=docker/dockerfile:1
#
# Preppy delivery-pipeline image. Bundles the full external toolchain
# (ImageMagick, KTX-Software, gltfpack, Node) + the Python package with the
# `preview` extra so the default thumbnail is a rendered model preview.
#
# Derived from singularity/preppy.def. Multi-arch (linux/amd64, linux/arm64) via
# the buildx-provided TARGETARCH.
ARG BASE_IMAGE=python:3.11-slim

# KTX-Software version and the patches it is built with. KTX_PATCHES must name
# exactly the files in docker/patches/ktx-software/ (NNNN-<id>.patch -> <id>);
# the build stage checks that. preppy refuses ETC1S without the encoder patch.
ARG KTX_VERSION=5.0.0-rc2
ARG KTX_PATCHES=basisu-etc1-optimizer-double-average

# --- Stage 1: KTX-Software from source, patched (preppy#5) --------------------
# The basis_universal ETC1S encoder that KTX-Software vendors sums a cluster's
# colours in float32, so large bright areas can be encoded as flat grey blocks.
# The release .debs carry that bug, so `ktx` is built here with the fix. Drop
# this stage for a release .deb once KTX-Software vendors a fixed basis_universal.
FROM ${BASE_IMAGE} AS ktx-build
ARG TARGETARCH
ARG KTX_VERSION
ARG KTX_PATCHES
# Optional cap on build parallelism (empty = all cores).
ARG KTX_BUILD_JOBS=
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates cmake g++ git ninja-build \
    && rm -rf /var/lib/apt/lists/*
COPY docker/patches/ktx-software/ /patches/
RUN set -eux; \
    found="$(ls /patches/*.patch | sed -E 's#.*/[0-9]+-(.*)\.patch$#\1#' | sort | xargs)"; \
    declared="$(echo ${KTX_PATCHES} | tr ', ' '\n\n' | sed '/^$/d' | sort | xargs)"; \
    [ "$found" = "$declared" ] || { echo "KTX_PATCHES ($declared) != patch files ($found)" >&2; exit 1; }; \
    git clone --depth 1 --branch "v${KTX_VERSION}" \
        https://github.com/KhronosGroup/KTX-Software.git /src; \
    for p in /patches/*.patch; do git -C /src apply --verbose "$p"; done; \
    case "${TARGETARCH}" in \
        amd64) sse=ON ;; \
        arm64) sse=OFF ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    # Release options as in KTX-Software's own Linux package job, tools only.
    cmake -S /src -B /build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/opt/ktx \
        -DKTX_FEATURE_TOOLS=ON -DKTX_FEATURE_TOOLS_CTS=OFF \
        -DKTX_FEATURE_TESTS=OFF -DKTX_FEATURE_LOADTEST_APPS=OFF \
        -DKTX_FEATURE_DOC=OFF -DKTX_FEATURE_JNI=OFF -DKTX_FEATURE_PY=OFF \
        -DBASISU_SSE="$sse" -DBASISU_OPENCL=OFF; \
    cmake --build /build ${KTX_BUILD_JOBS:+--parallel ${KTX_BUILD_JOBS}}; \
    cmake --install /build; \
    rm -rf /opt/ktx/include /opt/ktx/lib/cmake

# --- Stage 2: the preppy image -------------------------------------------------
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="Preppy"
LABEL org.opencontainers.image.description="Mesh preparation for DRI Voyager: source OBJs + textures -> web-ready self-contained glb per variant + manifest."
LABEL org.opencontainers.image.authors="Seth Parker <c.seth.parker@uky.edu>"
LABEL org.opencontainers.image.source="https://github.com/educelab/preppy"
LABEL org.opencontainers.image.licenses="GPL-3.0-or-later"

# TARGETARCH is injected by Docker buildx (amd64 | arm64).
ARG TARGETARCH

ENV DEBIAN_FRONTEND=noninteractive \
    # Headless offscreen GL backend for the pyrender model-preview thumbnail.
    # (libosmesa6 is installed below; if GL fails on a host the thumbnail falls
    # back to a texture crop.)
    PYOPENGL_PLATFORM=osmesa \
    PIP_NO_CACHE_DIR=1

# System dependencies:
#   imagemagick        -> texture normalization (magick/mogrify)
#   libosmesa6, libgl1 -> offscreen GL for the rendered model-preview thumbnail
#   curl/git/gcc/g++/make -> fetch installers + build any sdist-only wheels
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        gcc \
        g++ \
        git \
        make \
        tzdata \
        imagemagick \
        libosmesa6 \
        libgl1 \
    && rm -rf /var/lib/apt/lists/*

# ImageMagick resource limits. The stock Debian policy.xml caps the pixel cache
# (1GiB memory / 2GiB map / 2GiB disk, 256MP area) well below our gigapixel
# textures: a 16384x16384 source is 268MP, so it spills to disk and then dies
# with "cache resources exhausted". Policy values are per-instance *maximums*,
# so a deployment can still tighten them at runtime via MAGICK_MEMORY_LIMIT and
# friends. Disk spill lands in MAGICK_TMPDIR (else TMPDIR, else /tmp) — point
# that at scratch, not a small tmpfs, when processing 32K sources.
RUN set -eux; \
    policy="$(ls /etc/ImageMagick-*/policy.xml)"; \
    sed -i -E \
        -e 's|(name="memory" value=)"[^"]*"|\1"16GiB"|' \
        -e 's|(name="map" value=)"[^"]*"|\1"32GiB"|' \
        -e 's|(name="disk" value=)"[^"]*"|\1"128GiB"|' \
        -e 's|(name="area" value=)"[^"]*"|\1"4GP"|' \
        -e 's|(name="width" value=)"[^"]*"|\1"128KP"|' \
        -e 's|(name="height" value=)"[^"]*"|\1"128KP"|' \
        "$policy"; \
    identify -list resource

# Node.js (24 LTS) for gltfpack and the KTX2 embed helper.
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && node -v

# KTX-Software (provides `ktx create`; `toktx` was removed in v5), built and
# patched in the ktx-build stage. PREPPY_KTX_PATCHES declares the patches to
# preppy: they go into the asset hash, and ETC1S refuses to run without the
# encoder fix (preppy#5).
ARG KTX_PATCHES
COPY --from=ktx-build /opt/ktx/ /usr/local/
ENV PREPPY_KTX_PATCHES=${KTX_PATCHES}
RUN ldconfig && ktx --version

# Node CLI tools: gltfpack (geometry). obj2gltf/gltf-pipeline are the deprecated
# legacy path, kept until it is removed.
RUN npm install -g gltfpack obj2gltf gltf-pipeline

WORKDIR /usr/local/educelab/preppy
COPY . .

# Install the embed helper's npm deps (@gltf-transform/core + meshoptimizer) and
# the Python package with the `preview` extra (trimesh + pyrender). The install
# is editable so the embed helper resolves node_modules relative to the package
# source (assemble.NODE_DIR) — the same reason the .def uses --editable.
RUN npm install --prefix preppy/node \
    && python3 -m pip install --upgrade pip wheel setuptools \
    && python3 -m pip install --editable '.[preview]'

# No restrictive ENTRYPOINT: any console script (preppy, preppy-check-tools,
# preppy-obj2glb, preppy-merge-items) can be used as the command. Bare
# `docker run <image>` prints the pipeline's help.
CMD ["preppy", "-h"]
