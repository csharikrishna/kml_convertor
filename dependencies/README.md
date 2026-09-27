# dependencies/

The ODA File Converter package (`ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb`, ~54 MB) is
**not committed to git**. It is a closed-source third-party binary (see the ODA terms at
<https://www.opendesign.com/guestfiles/oda_file_converter>) and too large for the repository.

The `Dockerfile` handles it automatically:

1. If the `.deb` exists in this directory, it is used (offline builds).
2. Otherwise it is downloaded from
   `https://www.opendesign.com/guestfiles/get?filename=ODAFileConverter_QT6_lnxX64_8.3dll_27.1.deb`.

In both cases the SHA-256 is verified against `ODA_SHA256` in the Dockerfile:

```
c71363cd54758177af47a365154f180dc50a1e2b52a131994fda541c13a36766
```

To upgrade ODA, download the new Linux Qt6 `.deb`, compute `sha256sum`, and pass both via
`--build-arg ODA_DEB=<file name> --build-arg ODA_SHA256=<hash>` (or update the defaults).
ODA removes old versions from its download server, so an old pinned version eventually
fails to download; the build then stops with a clear checksum/download error.

For local Windows development, install ODA File Converter from the ODA website; it is
detected automatically under `C:\Program Files\ODA\ODAFileConverter*`, or set the
`ODA_FILE_CONVERTER` environment variable to the executable path.
