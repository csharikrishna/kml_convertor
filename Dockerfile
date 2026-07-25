FROM python:3.11-slim

WORKDIR /app

# Install system GIS dependencies for GDAL/proj if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgdal-dev \
    proj-bin \
    # Un-comment the line below if installing ODA File Converter
    gdebi-core \
    && rm -rf /var/lib/apt/lists/*

# ==============================================================================
# OPTIONAL: DWG SUPPORT (ODA File Converter)
# To enable DWG to DXF conversion in this Docker container:
# 1. Download the Linux DEB package for ODA File Converter from:
#    https://www.opendesign.com/guestfiles/oda_file_converter
# 2. Place the .deb file in the 'dependencies/' directory.
# 3. Keep the two lines below un-commented to copy and install it.
# ==============================================================================
COPY dependencies/ODAFileConverter*.deb /tmp/oda.deb
RUN apt-get update && apt-get install -y /tmp/oda.deb && rm /tmp/oda.deb

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Install dxf2kml package
RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["python", "main.py", "web", "--host", "0.0.0.0", "--port", "8000"]
