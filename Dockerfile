# syntax=docker/dockerfile:1
#
# Production image for the dxf2kml web converter, including DWG support through the
# ODA File Converter. DWG support is only possible in a container (or a VM): ODA ships
# a Qt6 GUI binary that needs system X11/GL/font libraries and a virtual display, none
# of which a native PaaS Python runtime (e.g. Render "runtime: python") can install.
#
#   docker build -t dxf2kml .                    # with DWG support (default)
#   docker build --build-arg INSTALL_ODA=0 -t dxf2kml-dxf-only .
#   docker build --target test .                 # run the full test suite in the image
#   docker run -p 8000:8000 dxf2kml
#
# The ODA .deb is NOT stored in git. It is taken from dependencies/ when present in the
# build context (offline builds), otherwise downloaded from opendesign.com. Either way
# its SHA-256 is verified, so a changed or tampered package fails the build loudly.

FROM python:3.12-slim-bookworm AS base

ARG INSTALL_ODA=1
ARG ODA_DEB=ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb
ARG ODA_SHA256=c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    DXF2KML_TEMP_DIR=/tmp/dxf2kml_web \
    PORT=8000

WORKDIR /app

# ODA File Converter + the runtime libraries its bundled Qt6 (xcb platform) needs.
# The .deb declares no dependencies, so they must be listed explicitly.
COPY dependencies/ /tmp/deps/
RUN set -eux; \
    if [ "$INSTALL_ODA" = "1" ]; then \
        apt-get update; \
        apt-get install -y --no-install-recommends ca-certificates curl xvfb xauth \
            libgl1 libegl1 libopengl0 libglib2.0-0 libdbus-1-3 libfontconfig1 libfreetype6 \
            libx11-6 libx11-xcb1 libxext6 libxrender1 libxi6 libsm6 libice6 libxkbcommon0 \
            libxkbcommon-x11-0 libxcb1 libxcb-cursor0 libxcb-glx0 libxcb-icccm4 libxcb-image0 \
            libxcb-keysyms1 libxcb-randr0 libxcb-render0 libxcb-render-util0 libxcb-shape0 \
            libxcb-shm0 libxcb-sync1 libxcb-util1 libxcb-xfixes0 libxcb-xinerama0 libxcb-xkb1; \
        if [ -f "/tmp/deps/${ODA_DEB}" ]; then cp "/tmp/deps/${ODA_DEB}" /tmp/oda.deb; \
        else curl -fsSL --retry 5 --retry-delay 3 --retry-all-errors -A "Mozilla/5.0 (X11; Linux x86_64)" -o /tmp/oda.deb "https://www.opendesign.com/guestfiles/get?filename=${ODA_DEB}"; fi; \
        echo "${ODA_SHA256}  /tmp/oda.deb" | sha256sum -c -; \
        apt-get install -y --no-install-recommends /tmp/oda.deb; \
        rm -f /tmp/oda.deb; \
        apt-get purge -y curl; \
        apt-get autoremove -y; \
        rm -rf /var/lib/apt/lists/*; \
    fi; \
    rm -rf /tmp/deps

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY dxf2kml/ dxf2kml/
COPY web_app/ web_app/
COPY main.py pyproject.toml README.md ./

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p "$DXF2KML_TEMP_DIR" && chown appuser:appuser "$DXF2KML_TEMP_DIR"


# ---------------------------------------------------------------------------------
# Test stage: `docker build --target test .` runs the complete suite inside the image,
# including the real-ODA DWG test that is skipped on machines without the converter.
FROM base AS test
USER root
COPY requirements-dev.txt .
RUN pip install -r requirements-dev.txt
COPY tests/ tests/
COPY examples/ examples/
COPY benchmarks/ benchmarks/
RUN chown -R appuser:appuser /app
USER appuser
RUN python -m pytest -q -p no:cacheprovider tests/


# ---------------------------------------------------------------------------------
# Production runtime stage: The final stage is what Render and standard `docker build`
# produces by default. It stays lean and avoids running 186 unit tests during every deploy.
FROM base AS runtime
USER appuser

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health', timeout=4)"

# One worker: conversions are memory-heavy; concurrency is bounded inside the app
# (MAX_CONCURRENT_CONVERSIONS). $PORT is provided by Render/Heroku-style platforms.
CMD ["sh", "-c", "exec uvicorn web_app.app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 30"]

