/* CAD2KML Converter Web Client JS */

let map;
let geojsonLayerGroup;
let selectedMarker;
let uploadedFile = null;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDropzone();
  setupFormSubmit();
});

// Initialize Leaflet Satellite Map
function initMap() {
  // Center near Kurnool / UTM 44N area by default
  map = L.map('map', {
    zoomControl: false
  }).setView([15.8281, 78.0373], 11);

  // Add zoom control top-left
  L.control.zoom({ position: 'topleft' }).addTo(map);

  // Esri World Imagery Satellite Tile Layer
  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }
  ).addTo(map);

  // Esri Reference Places/Labels overlay layer
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Esri'
    }
  ).addTo(map);

  geojsonLayerGroup = L.layerGroup().addTo(map);

  // Click on map to pick location and update UTM zone
  map.on('click', (e) => {
    updateUTMFromLatLng(e.latlng.lat, e.latlng.lng);
  });

  document.getElementById('selectLocationLink').addEventListener('click', (e) => {
    e.preventDefault();
    alert('Click anywhere on the map on the right to set your location and auto-detect your UTM zone!');
  });
}

// Update UTM zone via API from lat/lng
async function updateUTMFromLatLng(lat, lng) {
  try {
    if (selectedMarker) {
      map.removeLayer(selectedMarker);
    }
    selectedMarker = L.marker([lat, lng]).addTo(map)
      .bindPopup(`Selected Location: ${lat.toFixed(4)}, ${lng.toFixed(4)}`).openPopup();

    const formData = new FormData();
    formData.append('lat', lat);
    formData.append('lon', lng);

    const res = await fetch('/api/utm-zone', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data.epsg) {
      const selectBox = document.getElementById('input_epsg');
      let found = false;
      for (let option of selectBox.options) {
        if (option.value === data.epsg) {
          option.selected = true;
          found = true;
          break;
        }
      }
      if (!found) {
        // Add option if not present
        const opt = document.createElement('option');
        opt.value = data.epsg;
        opt.innerText = `${data.description} / ${data.epsg}`;
        opt.selected = true;
        selectBox.appendChild(opt);
      }
    }
  } catch (err) {
    console.error('Error auto-detecting UTM zone:', err);
  }
}

// Map Location Search
async function searchLocation() {
  const query = document.getElementById('mapSearchInput').value.trim();
  if (!query) return;

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const results = await res.json();

    if (results && results.length > 0) {
      const first = results[0];
      const lat = parseFloat(first.lat);
      const lon = parseFloat(first.lon);

      map.setView([lat, lon], 13);
      updateUTMFromLatLng(lat, lon);
    } else {
      alert('Location not found. Please try another search query.');
    }
  } catch (err) {
    console.error('Search error:', err);
    alert('Error connecting to location search service.');
  }
}

// Get User Browser Geolocation
function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        map.setView([lat, lon], 13);
        updateUTMFromLatLng(lat, lon);
      },
      (err) => {
        alert('Could not retrieve your current location. Please grant location permissions or search on the map.');
      }
    );
  } else {
    alert('Geolocation is not supported by your browser.');
  }
}

// Conversion Type Pill Toggle
function setConversionType(type) {
  const pillStandard = document.getElementById('pillStandard');
  const pillRaw = document.getElementById('pillRaw');
  const inputType = document.getElementById('conversion_type');
  const bannerTitle = document.getElementById('typeInfoTitle');
  const bannerDesc = document.getElementById('typeInfoDesc');

  inputType.value = type;

  if (type === 'standard') {
    pillStandard.classList.add('active');
    pillRaw.classList.remove('active');
    bannerTitle.innerText = 'Standard Conversion Selected';
    bannerDesc.innerText = 'Streamlined export. Converts core CAD polylines, boundary polygons, and essential geometries.';
  } else {
    pillRaw.classList.add('active');
    pillStandard.classList.remove('active');
    bannerTitle.innerText = 'Raw Conversion Selected';
    bannerDesc.innerText = 'Full detail export. Includes text labels, exploded block references, circles, points, and complex geometry.';
  }
}

// Drag and Drop Upload Setup
function setupDropzone() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }, false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });
}

function handleFileSelected(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'dwg') {
    alert('⚠️ Binary .DWG file detected!\n\nThis converter requires open ASCII .DXF format.\n\nPlease convert your file:\n1. Open your drawing in AutoCAD (or any free CAD viewer).\n2. Click File > Save As...\n3. Select "AutoCAD DXF (*.dxf)" from the dropdown.\n4. Upload the resulting .dxf file here!');
    removeSelectedFile();
    return;
  }

  uploadedFile = file;
  document.getElementById('fileName').innerText = file.name;
  document.getElementById('fileSize').innerText = `${(file.size / 1024).toFixed(1)} KB`;
  document.getElementById('fileCard').style.display = 'flex';
}

function removeSelectedFile() {
  uploadedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('fileCard').style.display = 'none';
}

// Accordion Toggle
function toggleAccordion() {
  const content = document.getElementById('accordionContent');
  const arrow = document.getElementById('accordionArrow');
  content.classList.toggle('open');
  arrow.innerText = content.classList.contains('open') ? '▲' : '▼';
}

// Form Submit & Conversion API Call
function setupFormSubmit() {
  const form = document.getElementById('convertForm');
  const convertBtn = document.getElementById('convertBtn');
  const successBanner = document.getElementById('successBanner');
  const downloadBtn = document.getElementById('downloadBtn');
  const successSummary = document.getElementById('successSummary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!uploadedFile) {
      alert('Please upload a .DXF or .DWG file first.');
      return;
    }

    convertBtn.disabled = true;
    convertBtn.innerHTML = `
      <svg class="animate-spin" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      Converting CAD Drawing...
    `;

    successBanner.classList.remove('active');
    geojsonLayerGroup.clearLayers();

    try {
      const formData = new FormData(form);
      formData.set('file', uploadedFile);
      formData.set('merge_lines', document.getElementById('merge_lines').checked ? 'true' : 'false');
      formData.set('ignore_large_polygons', document.getElementById('ignore_large_polygons').checked ? 'true' : 'false');
      formData.set('export_text', document.getElementById('export_text').checked ? 'true' : 'false');
      formData.set('export_points', document.getElementById('export_points').checked ? 'true' : 'false');

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Conversion failed');
      }

      // Render GeoJSON preview on Satellite map
      if (data.geojson && data.geojson.features) {
        const geojsonLayer = L.geoJSON(data.geojson, {
          style: (feature) => {
            return {
              color: feature.properties.stroke || '#ef4444',
              weight: feature.properties['stroke-width'] || 2.5,
              opacity: 0.9,
              fillColor: feature.properties.fill || '#ef4444',
              fillOpacity: feature.properties['fill-opacity'] || 0.2
            };
          },
          pointToLayer: (feature, latlng) => {
            if (feature.properties.type === 'text') {
              return L.marker(latlng, {
                icon: L.divIcon({
                  className: 'map-text-label',
                  html: `<span style="color: #ffffff; background: rgba(0,0,0,0.7); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap;">${feature.properties.title}</span>`,
                  iconSize: [100, 20]
                })
              });
            }
            return L.circleMarker(latlng, {
              radius: 6,
              fillColor: '#10b981',
              color: '#ffffff',
              weight: 1.5,
              opacity: 1,
              fillOpacity: 0.9
            });
          },
          onEachFeature: (feature, layer) => {
            if (feature.properties && feature.properties.layer) {
              layer.bindPopup(`<strong>Layer:</strong> ${feature.properties.layer}<br>${feature.properties.title || ''}`);
            }
          }
        });

        geojsonLayerGroup.addLayer(geojsonLayer);

        // Auto-fit map to drawing extent
        const bounds = geojsonLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40] });
        }
      }

      // Show success banner & download link
      downloadBtn.href = data.download_url;
      if (data.filename) {
        downloadBtn.setAttribute('download', data.filename);
      }
      successSummary.innerText = `Successfully projected ${data.stats.total_shapes} shapes and ${data.stats.total_markers} markers into Google Earth format.`;
      successBanner.classList.add('active');

    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Convert DXF to KML
      `;
    }
  });
}
