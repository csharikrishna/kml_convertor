FROM python:3.11-slim

WORKDIR /app

# Install system GIS dependencies for GDAL/proj if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgdal-dev \
    proj-bin \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Install dxf2kml package
RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["python", "main.py", "web", "--host", "0.0.0.0", "--port", "8000"]
