/* CAD2KML Converter Web Client JS — v2.1 */

let map;
let geojsonLayerGroup;
let selectedMarker;
let uploadedFile = null;
let lastConversionGeoJSON = null;  // Store for live preview re-render
let layerVisibility = {};          // Track layer show/hide state

const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDropzone();
  setupFormSubmit();
  setupLivePreviewListeners();
  setupFillToggle();
  setupControls();
});

// Escape drawing-supplied text (layer names, TEXT/MTEXT content) before it is used as HTML.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeColor(value, fallback) {
  return /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : fallback;
}

// Wire up controls (no inline event handlers: the page runs under a strict CSP)
function setupControls() {
  document.querySelectorAll('[data-conversion-type]').forEach(btn => {
    btn.addEventListener('click', () => setConversionType(btn.dataset.conversionType));
  });
  document.getElementById('dropzone').addEventListener('click', (e) => {
    if (e.target.id !== 'fileInput') document.getElementById('fileInput').click();
  });
  document.getElementById('fileRemove').addEventListener('click', (e) => {
    e.stopPropagation();
    removeSelectedFile();
  });
  document.getElementById('accordionToggle').addEventListener('click', toggleAccordion);
  document.getElementById('mapSearchBtn').addEventListener('click', searchLocation);
  document.getElementById('mapSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchLocation();
    }
  });
  document.getElementById('myLocationBtn').addEventListener('click', getUserLocation);
  document.getElementById('layerPanelToggle').addEventListener('click', toggleLayerPanel);

  const opacity = document.getElementById('fill_opacity');
  opacity.addEventListener('input', () => {
    document.getElementById('fillOpacityVal').innerText = `${opacity.value}%`;
  });
  const scale = document.getElementById('label_scale');
  scale.addEventListener('input', () => {
    document.getElementById('scaleVal').innerText = scale.value;
  });
}

// Initialize Leaflet Satellite Map
function initMap() {
  // Center near Kurnool / UTM 44N area by default
  map = L.map('map', {
    zoomControl: false
  }).setView([15.8281, 78.0373], 11);

  L.control.zoom({ position: 'topleft' }).addTo(map);

  // Esri World Imagery Satellite Tile Layer
  L.tileLayer(
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
    formData.append('lon', L.Util.wrapNum(lng, [-180, 180], true));

    const res = await fetch('/api/utm-zone', {
      method: 'POST',
      body: formData
    });
    const data = await readJson(res);
    if (!res.ok) {
      showError('UTM Zone Unavailable', errorDetail(data, res));
      return;
    }

    if (data.epsg) {
      const selectBox = document.getElementById('input_epsg');
      let found = false;
      for (const option of selectBox.options) {
        if (option.value === data.epsg) {
          option.selected = true;
          found = true;
          break;
        }
      }
      if (!found) {
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
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`);
    const results = await res.json();

    if (results && results.length > 0) {
      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);
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
      () => {
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
  const bannerTitle = document.getElementById('typeInfoTitle');
  const bannerDesc = document.getElementById('typeInfoDesc');

  document.getElementById('conversion_type').value = type;

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
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      handleFileSelected(fileInput.files[0]);
    }
  });
}

function handleFileSelected(file) {
  const dropzone = document.getElementById('dropzone');
  const maxMb = parseFloat(dropzone.dataset.maxUploadMb) || 25;
  const dwgSupported = dropzone.dataset.dwgSupported === '1';
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext !== 'dxf' && ext !== 'dwg') {
    showError('Invalid File Type', 'Please upload an AutoCAD .DXF or .DWG file.');
    removeSelectedFile();
    return;
  }
  if (ext === 'dwg' && !dwgSupported) {
    showError('DWG Not Supported Here', 'This server cannot convert DWG files. Save the drawing as DXF in AutoCAD (SAVEAS → DXF) and upload the DXF.');
    removeSelectedFile();
    return;
  }
  if (file.size > maxMb * 1024 * 1024) {
    showError('File Too Large', `The maximum upload size is ${maxMb} MB (this file is ${(file.size / 1048576).toFixed(1)} MB).`);
    removeSelectedFile();
    return;
  }

  hideError();
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
    if (lastConversionGeoJSON) {
      renderGeoJSONPreview(lastConversionGeoJSON);
    }
  });
}

// Error / warning / success banner helpers
function showError(title, message) {
  document.getElementById('errorTitle').innerText = title;
  document.getElementById('errorMessage').innerText = message;
  document.getElementById('errorBanner').classList.add('active');
  document.getElementById('successBanner').classList.remove('active');
}

function hideError() {
  document.getElementById('errorBanner').classList.remove('active');
}

function showWarnings(warnings) {
  const banner = document.getElementById('warningBanner');
  const list = document.getElementById('warningList');
  list.replaceChildren();
  (warnings || []).forEach(text => {
    const li = document.createElement('li');
    li.textContent = text;
    list.appendChild(li);
  });
  banner.classList.toggle('active', list.children.length > 0);
}

// Parse a response body as JSON even when the server/proxy returned HTML or nothing.
async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text.slice(0, 300) };
  }
}

function errorDetail(data, res) {
  const detail = data && data.detail;
  if (Array.isArray(detail)) {  // FastAPI validation errors
    return detail.map(d => d.msg || JSON.stringify(d)).join('; ');
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  return `Request failed with HTTP ${res.status}.`;
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
      const props = feature.properties;
      const baseStyle = {
        color: safeColor(props.stroke, '#ef4444'),
        weight: props['stroke-width'] || 2.5,
        opacity: 0.9,
      };
      if (feature.geometry.type === 'Polygon') {
        if (props.filled) {  // HATCH areas keep their own color
          baseStyle.fillColor = safeColor(props.fill, '#ef4444');
          baseStyle.fillOpacity = props['fill-opacity'] ?? 0.3;
        } else {
          baseStyle.fillColor = fillPolygons ? fillColor : safeColor(props.fill, '#ef4444');
          baseStyle.fillOpacity = fillPolygons ? fillOpacity : (props['fill-opacity'] ?? 0.1);
        }
      } else {
        baseStyle.fill = false;
      }
      return baseStyle;
    },
    pointToLayer: (feature, latlng) => {
      const props = feature.properties;
      if (props.type === 'text') {
        const scaledSize = Math.max(8, Math.min(24, Math.round(11 * labelScale * 2)));
        const rotation = Number(props.rotation) || 0;
        const labelColor = safeColor(props.label_color, '#00ff00');

        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'map-text-label',
            html: `<span style="color: ${labelColor}; text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.7); padding: 1px 4px; font-size: ${scaledSize}px; font-weight: 600; white-space: pre; transform: rotate(${-rotation}deg); display: inline-block;">${escapeHtml(props.title)}</span>`,
            iconSize: [null, null],
            iconAnchor: [0, scaledSize / 2]
          })
        });
      }
      return L.circleMarker(latlng, {
        radius: 6,
        fillColor: safeColor(props.color, '#10b981'),
        color: '#ffffff',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.9
      });
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      if (props && props.layer) {
        layer.bindPopup(`<strong>Layer:</strong> ${escapeHtml(props.layer)}<br>${escapeHtml(props.title || '')}`);
      }
    }
  });

  geojsonLayerGroup.addLayer(geojsonLayer);

  const bounds = geojsonLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }

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

  // Skip rebuilding when the layer count is unchanged, so the checkbox that was just
  // clicked keeps focus.
  if (body.children.length === layerSet.size) {
    return;
  }

  body.replaceChildren();
  [...layerSet].sort().forEach((layerName, index) => {
    if (layerVisibility[layerName] === undefined) {
      layerVisibility[layerName] = true;
    }

    const row = document.createElement('div');
    row.className = 'layer-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = layerVisibility[layerName] !== false;
    checkbox.id = `layer_${index}`;
    checkbox.addEventListener('change', () => {
      layerVisibility[layerName] = checkbox.checked;
      if (lastConversionGeoJSON) {
        renderGeoJSONPreview(lastConversionGeoJSON);
      }
    });

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = layerName;

    row.appendChild(checkbox);
    row.appendChild(label);
    body.appendChild(row);
  });

  panel.style.display = 'block';
}

function toggleLayerPanel() {
  const body = document.getElementById('layerPanelBody');
  const btn = document.getElementById('layerPanelToggle');
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
  const idleButtonHtml = convertBtn.innerHTML;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    showWarnings([]);

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
    layerVisibility = {};

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONVERT_TIMEOUT_MS);

    try {
      const formData = new FormData(form);
      formData.set('file', uploadedFile);
      ['merge_lines', 'ignore_large_polygons', 'export_text', 'export_points', 'auto_scale_text', 'fill_polygons']
        .forEach(id => formData.set(id, document.getElementById(id).checked ? 'true' : 'false'));
      formData.set('fill_color', document.getElementById('fill_color').value);
      formData.set('fill_opacity', (parseFloat(document.getElementById('fill_opacity').value) / 100).toFixed(2));
      formData.set('output_format', document.getElementById('output_format').value);

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      const data = await readJson(res);

      if (!res.ok) {
        throw new Error(errorDetail(data, res));
      }

      if (data.geojson && Array.isArray(data.geojson.features)) {
        lastConversionGeoJSON = data.geojson;
        renderGeoJSONPreview(data.geojson);
      }

      const warnings = [...(data.warnings || [])];
      if (data.preview_truncated) {
        warnings.push('The map preview shows only part of this large drawing; the downloaded file is complete.');
      }
      showWarnings(warnings);

      downloadBtn.href = data.download_url;
      if (data.filename) {
        downloadBtn.setAttribute('download', data.filename);
      }
      successSummary.innerText = `Successfully projected ${data.stats.total_shapes} shapes and ${data.stats.total_markers} markers into Google Earth format.`;
      successBanner.classList.add('active');

    } catch (err) {
      const message = err.name === 'AbortError'
        ? 'The conversion took too long and was cancelled. Try a smaller drawing or remove unneeded layers.'
        : err.message;
      showError('Conversion Failed', message);
    } finally {
      clearTimeout(timer);
      convertBtn.disabled = false;
      convertBtn.innerHTML = idleButtonHtml;
    }
  });
}
