# syntax=docker/dockerfile:1
#
# Preppy delivery-pipeline image. Bundles the full external toolchain
# (ImageMagick, KTX-Software, gltfpack, Node) + the Python package with the
# `preview` extra so the default thumbnail is a rendered model preview.
#
# Derived from singularity/preppy.def. Multi-arch (linux/amd64, linux/arm64):
# the KTX-Software .deb is selected per-arch via the buildx-provided TARGETARCH.
ARG BASE_IMAGE=python:3.11-slim
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

# KTX-Software (provides `ktx create`; `toktx` was removed in v5). We require
# >= v5, which has no final tag yet, so pin the newest v5 pre-release shipping
# both amd64 and arm64 .debs. Bump to 5.0.0 when it ships.
# Assets: https://github.com/KhronosGroup/KTX-Software/releases
ARG KTX_VERSION=5.0.0-rc2
RUN set -eux; \
    case "${TARGETARCH}" in \
        amd64) ktx_arch="x86_64" ;; \
        arm64) ktx_arch="arm64" ;; \
        *) echo "unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/ktx.deb \
        "https://github.com/KhronosGroup/KTX-Software/releases/download/v${KTX_VERSION}/KTX-Software-${KTX_VERSION}-Linux-${ktx_arch}.deb"; \
    apt-get update; \
    apt-get install -y /tmp/ktx.deb; \
    rm -f /tmp/ktx.deb; \
    rm -rf /var/lib/apt/lists/*; \
    ktx --version

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
