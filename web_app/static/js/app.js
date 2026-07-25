/* CAD2KML Converter Web Client JS — v2.0 */

let map;
let geojsonLayerGroup;
let selectedMarker;
let uploadedFile = null;
let lastConversionGeoJSON = null;  // Store for live preview re-render
let layerVisibility = {};          // Track layer show/hide state

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDropzone();
  setupFormSubmit();
  setupLivePreviewListeners();
  setupFillToggle();
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
  if (ext !== 'dxf' && ext !== 'dwg') {
    showError('Invalid File Type', 'Please upload an AutoCAD .DXF or .DWG file.');
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

// Fill polygon toggle
function setupFillToggle() {
  const fillCheckbox = document.getElementById('fill_polygons');
  const fillColorRow = document.getElementById('fillColorRow');
  
  fillCheckbox.addEventListener('change', () => {
    fillColorRow.style.display = fillCheckbox.checked ? 'flex' : 'none';
    // Re-render preview if data available
    if (lastConversionGeoJSON) {
      renderGeoJSONPreview(lastConversionGeoJSON);
    }
  });
}

// Error/Success banner helpers
function showError(title, message) {
  const errorBanner = document.getElementById('errorBanner');
  document.getElementById('errorTitle').innerText = title;
  document.getElementById('errorMessage').innerText = message;
  errorBanner.classList.add('active');
  document.getElementById('successBanner').classList.remove('active');
}

function hideError() {
  document.getElementById('errorBanner').classList.remove('active');
}

// ==========================================
// Live Preview: Re-render on setting change
// ==========================================
function setupLivePreviewListeners() {
  const settingIds = ['label_scale', 'export_text', 'export_points', 'fill_polygons', 'fill_color', 'fill_opacity'];
  settingIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        if (lastConversionGeoJSON) {
          renderGeoJSONPreview(lastConversionGeoJSON);
        }
      });
      if (el.type === 'range' || el.type === 'color') {
        el.addEventListener('input', () => {
          if (lastConversionGeoJSON) {
            renderGeoJSONPreview(lastConversionGeoJSON);
          }
        });
      }
    }
  });
}

// ==========================================
// GeoJSON Preview Rendering
// ==========================================
function renderGeoJSONPreview(geojson) {
  geojsonLayerGroup.clearLayers();

  const showText = document.getElementById('export_text').checked;
  const showPoints = document.getElementById('export_points').checked;
  const labelScale = parseFloat(document.getElementById('label_scale').value) || 0.5;
  const fillPolygons = document.getElementById('fill_polygons').checked;
  const fillColor = document.getElementById('fill_color').value;
  const fillOpacity = parseFloat(document.getElementById('fill_opacity').value) / 100;

  // Collect unique layers
  const layerSet = new Set();

  const filteredFeatures = geojson.features.filter(f => {
    const type = f.properties.type;
    if (type === 'text' && !showText) return false;
    if (type === 'point' && !showPoints) return false;
    const layerName = f.properties.layer || 'Default';
    layerSet.add(layerName);
    if (layerVisibility[layerName] === false) return false;
    return true;
  });

  const geojsonLayer = L.geoJSON({ type: 'FeatureCollection', features: filteredFeatures }, {
    style: (feature) => {
      const baseStyle = {
        color: feature.properties.stroke || '#ef4444',
        weight: feature.properties['stroke-width'] || 2.5,
        opacity: 0.9,
      };

      if (feature.geometry.type === 'Polygon') {
        baseStyle.fillColor = fillPolygons ? fillColor : (feature.properties.fill || '#ef4444');
        baseStyle.fillOpacity = fillPolygons ? fillOpacity : (feature.properties['fill-opacity'] || 0.1);
      } else {
        baseStyle.fillColor = feature.properties.fill || '#ef4444';
        baseStyle.fillOpacity = feature.properties['fill-opacity'] || 0.2;
      }

      return baseStyle;
    },
    pointToLayer: (feature, latlng) => {
      if (feature.properties.type === 'text') {
        const textHeight = feature.properties.text_height || 1;
        const baseFontSize = 11;
        const scaledSize = Math.max(8, Math.min(24, Math.round(baseFontSize * labelScale * 2)));
        const rotation = feature.properties.rotation || 0;
        const labelColor = feature.properties.label_color || '#00ff00';

        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'map-text-label',
            html: `<span style="color: ${labelColor}; text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7); padding: 1px 4px; font-size: ${scaledSize}px; font-weight: 600; white-space: nowrap; transform: rotate(${-rotation}deg); display: inline-block;">${feature.properties.title}</span>`,
            iconSize: [null, null],
            iconAnchor: [0, scaledSize / 2]
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

  // Build layer control panel
  buildLayerPanel(layerSet);
}

// ==========================================
// Layer Toggle Panel
// ==========================================
function buildLayerPanel(layerSet) {
  const panel = document.getElementById('layerPanel');
  const body = document.getElementById('layerPanelBody');
  
  if (layerSet.size === 0) {
    panel.style.display = 'none';
    return;
  }
  
  // If the panel already has the same number of layers, skip DOM rebuild
  // to avoid destroying the checkbox that was just clicked (prevents focus loss)
  if (body.children.length === layerSet.size) {
    return;
  }
  
  body.innerHTML = '';
  const sortedLayers = [...layerSet].sort();
  
  sortedLayers.forEach(layerName => {
    if (layerVisibility[layerName] === undefined) {
      layerVisibility[layerName] = true;
    }
    
    const row = document.createElement('div');
    row.className = 'layer-row';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = layerVisibility[layerName] !== false;
    checkbox.id = `layer_${layerName}`;
    checkbox.addEventListener('change', () => {
      layerVisibility[layerName] = checkbox.checked;
      if (lastConversionGeoJSON) {
        renderGeoJSONPreview(lastConversionGeoJSON);
      }
    });
    
    const label = document.createElement('label');
    label.htmlFor = `layer_${layerName}`;
    label.innerText = layerName;
    
    row.appendChild(checkbox);
    row.appendChild(label);
    body.appendChild(row);
  });
  
  panel.style.display = 'block';
}

function toggleLayerPanel() {
  const body = document.getElementById('layerPanelBody');
  const btn = document.querySelector('.layer-panel-toggle');
  if (body.style.display === 'none') {
    body.style.display = 'block';
    btn.innerText = '−';
  } else {
    body.style.display = 'none';
    btn.innerText = '+';
  }
}

// ==========================================
// Form Submit & Conversion API Call
// ==========================================
function setupFormSubmit() {
  const form = document.getElementById('convertForm');
  const convertBtn = document.getElementById('convertBtn');
  const successBanner = document.getElementById('successBanner');
  const downloadBtn = document.getElementById('downloadBtn');
  const successSummary = document.getElementById('successSummary');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    if (!uploadedFile) {
      showError('No File Selected', 'Please upload a .DXF file first.');
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
    lastConversionGeoJSON = null;
    layerVisibility = {}; // Reset layer visibility for new file

    try {
      const formData = new FormData(form);
      formData.set('file', uploadedFile);
      formData.set('merge_lines', document.getElementById('merge_lines').checked ? 'true' : 'false');
      formData.set('ignore_large_polygons', document.getElementById('ignore_large_polygons').checked ? 'true' : 'false');
      formData.set('export_text', document.getElementById('export_text').checked ? 'true' : 'false');
      formData.set('export_points', document.getElementById('export_points').checked ? 'true' : 'false');
      formData.set('auto_scale_text', document.getElementById('auto_scale_text').checked ? 'true' : 'false');
      formData.set('fill_polygons', document.getElementById('fill_polygons').checked ? 'true' : 'false');
      formData.set('fill_color', document.getElementById('fill_color').value);
      formData.set('fill_opacity', (parseFloat(document.getElementById('fill_opacity').value) / 100).toFixed(2));
      formData.set('output_format', document.getElementById('output_format').value);

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Conversion failed');
      }

      // Store GeoJSON for live re-rendering
      if (data.geojson && data.geojson.features) {
        lastConversionGeoJSON = data.geojson;
        renderGeoJSONPreview(data.geojson);
      }

      // Show success banner & download link
      downloadBtn.href = data.download_url;
      if (data.filename) {
        downloadBtn.setAttribute('download', data.filename);
      }
      successSummary.innerText = `Successfully projected ${data.stats.total_shapes} shapes and ${data.stats.total_markers} markers into Google Earth format.`;
      successBanner.classList.add('active');

    } catch (err) {
      showError('Conversion Failed', err.message);
    } finally {
      convertBtn.disabled = false;
      convertBtn.innerHTML = `
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Convert DXF to KML
      `;
    }
  });
}
