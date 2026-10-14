/* CAD2KML Converter Web Client JS — v3.0 SaaS Workstation Edition */

let map;
let geojsonLayerGroup;
let selectedMarker;
let uploadedFile = null;
let lastConversionGeoJSON = null;  // Store for live preview re-render
let lastJobId = null;              // Active conversion job ID for sharing
let layerVisibility = {};          // Track layer show/hide state
let layerOpacity = {};             // Track per-layer opacity (0.0 to 1.0)
let layerColors = {};              // Track resolved layer colors for chips
let currentMedianTextHeight = 1.0; // Drawing-specific median CAD text height

// Workstation map tools state
let isMeasurementActive = false;
let measurePoints = [];
let measureMarkers = [];
let measureLines = null;
let totalMeasureDistance = 0;
let isFullscreen = false;

const CONVERT_TIMEOUT_MS = 5 * 60 * 1000;

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initMap();
  initGlassDock();
  initMeasurementTool();
  initLiveStatusBar();
  initSampleDrawing();
  setupDropzone();
  setupFormSubmit();
  setupLivePreviewListeners();
  setupFillToggle();
  setupControls();
  initShareModal();
  initIdleUiAutoHide();
});

// ==========================================
// Theme Management (Light Theme Enforced)
// ==========================================
function initTheme() {
  document.body.classList.remove('dark-theme');
  try {
    localStorage.removeItem('cad2kml_theme');
  } catch (e) {}
}

// Auto-hide workstation controls on 2.5s inactivity or collapse into Single Persistent Button
function initIdleUiAutoHide() {
  let idleTimer = null;
  const IDLE_DELAY_MS = 2500;
  const hubBtn = document.getElementById('mapControlsHubBtn');
  const searchInput = document.getElementById('mapSearchInput');

  function wakeUi() {
    if (document.body.classList.contains('controls-collapsed')) {
      return; // Explicitly collapsed: remain collapsed until toggled
    }
    if (document.body.classList.contains('ui-idle')) {
      document.body.classList.remove('ui-idle');
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const isInputFocused = searchInput && document.activeElement === searchInput;
      if (!isInputFocused && typeof isMeasuring !== 'undefined' && !isMeasuring) {
        document.body.classList.add('ui-idle');
      }
    }, IDLE_DELAY_MS);
  }

  // Toggle button click handler
  hubBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (document.body.classList.contains('ui-idle') || document.body.classList.contains('controls-collapsed')) {
      // Expand controls
      document.body.classList.remove('ui-idle');
      document.body.classList.remove('controls-collapsed');
      wakeUi();
    } else {
      // Collapse controls into single persistent button
      document.body.classList.add('controls-collapsed');
      clearTimeout(idleTimer);
    }
  });

  const mapTarget = document.getElementById('mapCard') || document.getElementById('shareMap') || window;
  ['mousemove', 'mousedown', 'touchstart', 'touchmove', 'keydown', 'wheel'].forEach(evt => {
    mapTarget.addEventListener(evt, wakeUi, { passive: true });
  });

  searchInput?.addEventListener('focus', () => {
    clearTimeout(idleTimer);
    document.body.classList.remove('ui-idle');
    document.body.classList.remove('controls-collapsed');
  });
  searchInput?.addEventListener('blur', wakeUi);

  wakeUi();
}

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

// ==========================================
// Geodesic Math & UTM Calculation Utilities
// ==========================================
function computeGeodesicDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km (${Math.round(meters).toLocaleString()} m)`;
  }
  return `${meters.toFixed(1)} m`;
}

function calculateFeatureLengthMeters(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return 0;
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    sum += computeGeodesicDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return sum;
}

function calculatePolygonAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  let total = 0;
  const toRad = Math.PI / 180;
  const R = 6371000;
  for (let i = 0; i < ring.length - 1; i++) {
    const p1 = ring[i];
    const p2 = ring[i + 1];
    total += (p2[0] - p1[0]) * toRad * (2 + Math.sin(p1[1] * toRad) + Math.sin(p2[1] * toRad));
  }
  return Math.abs(total * R * R / 2);
}

// Exact WGS84 Transverse Mercator UTM projection (USGS / Karney formula)
function latLonToUtm(lat, lon, zoneNumber, isNorthern) {
  const a = 6378137.0; // WGS84 semi-major axis
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ePrime2 = e2 / (1 - e2);
  const k0 = 0.9996;

  const latRad = lat * (Math.PI / 180);
  const lonRad = lon * (Math.PI / 180);
  const centralLon = ((zoneNumber - 1) * 6 - 180 + 3) * (Math.PI / 180);

  const N = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const T = Math.tan(latRad) * Math.tan(latRad);
  const C = ePrime2 * Math.cos(latRad) * Math.cos(latRad);
  const A = Math.cos(latRad) * (lonRad - centralLon);

  const M = a * (
    (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256) * latRad -
    (3 * e2 / 8 + 3 * e2 * e2 / 32 + 45 * e2 * e2 * e2 / 1024) * Math.sin(2 * latRad) +
    (15 * e2 * e2 / 256 + 45 * e2 * e2 * e2 / 1024) * Math.sin(4 * latRad) -
    (35 * e2 * e2 * e2 / 3072) * Math.sin(6 * latRad)
  );

  const easting = 500000 + k0 * N * (
    A +
    (1 - T + C) * Math.pow(A, 3) / 6 +
    (5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * Math.pow(A, 5) / 120
  );

  let northing = k0 * (
    M +
    N * Math.tan(latRad) * (
      A * A / 2 +
      (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24 +
      (61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * Math.pow(A, 6) / 720
    )
  );

  if (!isNorthern) {
    northing += 10000000.0;
  }

  return {
    easting: Math.round(easting),
    northing: Math.round(northing)
  };
}

// Wire up basic controls
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
  document.getElementById('mapSearchBtn')?.addEventListener('click', searchLocation);
  document.getElementById('mapSearchInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchLocation();
    }
  });
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

// ==========================================
// Map Initialization (Crisp Satellite View)
// ==========================================
function initMap() {
  map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
    maxZoom: 22
  }).setView([15.8281, 78.0373], 11);

  L.control.zoom({ position: 'topleft' }).addTo(map);
 
  // Multi-CDN Ultra-Fast Basemaps (Google Satellite Hybrid, Esri Clarity, Carto Streets)
  const basemaps = {
    google_hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxNativeZoom: 20,
      maxZoom: 22,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 80,
      attribution: 'Imagery &copy; Google'
    }),
    esri_world: L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 22,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 80,
      attribution: 'Tiles &copy; Esri'
    }),
    osm_streets: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxNativeZoom: 19,
      maxZoom: 22,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateWhenZooming: false,
      updateInterval: 80,
      attribution: '&copy; CartoDB, &copy; OpenStreetMap'
    })
  };

  let activeBasemap = basemaps.google_hybrid;
  activeBasemap.addTo(map);

  const basemapSelect = document.getElementById('basemapSelect');
  if (basemapSelect) {
    basemapSelect.addEventListener('change', () => {
      const selected = basemapSelect.value;
      if (basemaps[selected] && basemaps[selected] !== activeBasemap) {
        map.removeLayer(activeBasemap);
        activeBasemap = basemaps[selected];
        activeBasemap.addTo(map);
        if (geojsonLayerGroup) geojsonLayerGroup.bringToFront();
      }
    });
  }

  geojsonLayerGroup = L.layerGroup().addTo(map);

  // Automatic container resize detection to guarantee complete tile grid coverage
  if (window.ResizeObserver) {
    const mapCardEl = document.getElementById('mapCard');
    const mapEl = document.getElementById('map');
    const ro = new ResizeObserver(() => {
      if (map) {
        map.invalidateSize({ debounceMoveEngine: true });
      }
    });
    if (mapEl) ro.observe(mapEl);
    if (mapCardEl && mapCardEl !== mapEl) ro.observe(mapCardEl);
  }
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
  document.addEventListener('fullscreenchange', () => {
    if (map) {
      map.invalidateSize();
      setTimeout(() => map.invalidateSize(), 100);
      setTimeout(() => map.invalidateSize(), 300);
    }
  });

  // Dynamic zoom-adaptive label sizing and decluttering
  map.on('zoomend', () => {
    updateTextLabelSizes();
    const zoomEl = document.getElementById('statusZoom');
    if (zoomEl) {
      const zoom = map.getZoom();
      let lod = 'Detailed (100m)';
      if (zoom < 13) lod = 'Overview (Landmarks)';
      else if (zoom <= 14) lod = 'Milestones (1km/500m)';
      else if (zoom === 15) lod = 'Intervals (200m)';
      zoomEl.innerText = `${zoom} · ${lod}`;
    }
  });

  // Location selector picker mode on map click
  map.on('click', (e) => {
    if (isMeasurementActive) {
      const snappedPt = findNearestGeoJsonPoint(e.latlng, 22);
      handleMeasurementClick(snappedPt ? snappedPt.latlng : e.latlng, snappedPt ? snappedPt.feature : null);
      return;
    }
    if (window.isSelectingLocation) {
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;
      updateUTMFromLatLng(lat, lon);
      window.isSelectingLocation = false;
      document.getElementById('selectLocationLink').innerText = '📍 Select Location on MAP';
      map.getContainer().style.cursor = '';
    }
  });

  document.getElementById('selectLocationLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.isSelectingLocation = !window.isSelectingLocation;
    if (window.isSelectingLocation) {
      document.getElementById('selectLocationLink').innerText = '🎯 Click anywhere on the map...';
      map.getContainer().style.cursor = 'crosshair';
    } else {
      document.getElementById('selectLocationLink').innerText = '📍 Select Location on MAP';
      map.getContainer().style.cursor = '';
    }
  });
}

// Snapping helper: find nearest survey point feature within screen pixel tolerance
function findNearestGeoJsonPoint(latlng, tolerancePx = 22) {
  if (!map || !lastConversionGeoJSON || !Array.isArray(lastConversionGeoJSON.features)) {
    return null;
  }
  const clickPt = map.latLngToContainerPoint(latlng);
  let best = null;
  let minDistance = tolerancePx;

  for (const f of lastConversionGeoJSON.features) {
    if (f.geometry && f.geometry.type === 'Point') {
      const ptLatLng = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
      const screenPt = map.latLngToContainerPoint(ptLatLng);
      const d = clickPt.distanceTo(screenPt);
      if (d < minDistance) {
        minDistance = d;
        best = { latlng: ptLatLng, feature: f };
      }
    }
  }
  return best;
}

// Vertex snapping helper for polylines and polygons
function findNearestVertex(latlng, feature, tolerancePx = 20) {
  if (!map || !feature || !feature.geometry) return null;
  const clickPt = map.latLngToContainerPoint(latlng);
  let bestLatLng = null;
  let bestDist = tolerancePx;

  function checkCoord(coord) {
    const ptLatLng = L.latLng(coord[1], coord[0]);
    const screenPt = map.latLngToContainerPoint(ptLatLng);
    const d = clickPt.distanceTo(screenPt);
    if (d < bestDist) {
      bestDist = d;
      bestLatLng = ptLatLng;
    }
  }

  const geom = feature.geometry;
  if (geom.type === 'LineString') {
    geom.coordinates.forEach(checkCoord);
  } else if (geom.type === 'MultiLineString' || geom.type === 'Polygon') {
    geom.coordinates.forEach(ring => ring.forEach(checkCoord));
  }
  return bestLatLng;
}

// ==========================================
// Floating Glass Dock Controls
// ==========================================
function initGlassDock() {
  // Fit Extents button
  const fitBtn = document.getElementById('fitBoundsBtn');
  if (fitBtn) {
    fitBtn.addEventListener('click', () => {
      fitDrawingBounds();
    });
  }

  // Fullscreen button
  const fsBtn = document.getElementById('fullscreenBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', toggleFullscreen);
  }

  // Save as PDF button
  const pdfBtn = document.getElementById('savePdfBtn');
  if (pdfBtn) {
    pdfBtn.addEventListener('click', exportMapToPdf);
  }

  // Collapse button
  const collapseBtn = document.getElementById('dockCollapseBtn');
  if (collapseBtn) {
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.body.classList.add('controls-collapsed');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isFullscreen) {
      toggleFullscreen();
    }
  });
}

async function exportMapToPdf() {
  const geojson = lastConversionGeoJSON;
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    alert('No CAD drawing currently loaded on the map.');
    return;
  }

  const pdfBtn = document.getElementById('savePdfBtn');
  const pdfText = document.getElementById('savePdfText');
  const originalText = pdfText ? pdfText.innerText : 'PDF';

  try {
    if (pdfBtn) pdfBtn.disabled = true;
    if (pdfText) pdfText.innerText = 'Rendering...';

    // 1. Gather all coordinates across all geometries to compute true geographic bounding box
    const allCoords = [];
    function extractCoords(c) {
      if (!Array.isArray(c)) return;
      if (typeof c[0] === 'number' && typeof c[1] === 'number') {
        allCoords.push(c);
      } else {
        for (let i = 0; i < c.length; i++) extractCoords(c[i]);
      }
    }
    geojson.features.forEach(f => {
      if (f.geometry?.coordinates) extractCoords(f.geometry.coordinates);
    });

    if (allCoords.length === 0) {
      alert('No coordinates found to export.');
      return;
    }

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    allCoords.forEach(c => {
      if (c[0] < minLng) minLng = c[0];
      if (c[0] > maxLng) maxLng = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    });

    // Add generous 12% padding so the full polygon and all survey points have breathing room
    const padLng = Math.max(0.001, (maxLng - minLng) * 0.12);
    const padLat = Math.max(0.001, (maxLat - minLat) * 0.12);
    const bMinLng = minLng - padLng;
    const bMaxLng = maxLng + padLng;
    const bMinLat = minLat - padLat;
    const bMaxLat = maxLat + padLat;

    // Web Mercator projection matching satellite tiles exactly
    function project(lng, lat, zoom) {
      const n = Math.pow(2, zoom);
      const x = ((lng + 180) / 360) * n * 256;
      const latRad = (lat * Math.PI) / 180;
      const y = (1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2 * n * 256;
      return { x, y };
    }

    // Determine optimal High-DPI zoom level (target ~1000-1800px base size before 2x scale)
    let z = 16;
    for (let testZ = 13; testZ <= 18; testZ++) {
      const p1 = project(bMinLng, bMinLat, testZ);
      const p2 = project(bMaxLng, bMaxLat, testZ);
      const spanW = Math.abs(p2.x - p1.x);
      const spanH = Math.abs(p1.y - p2.y);
      if (spanW >= 850 || spanH >= 850 || testZ === 17) {
        z = testZ;
        break;
      }
    }

    const pMin = project(bMinLng, bMaxLat, z);
    const pMax = project(bMaxLng, bMinLat, z);

    const pxMinX = Math.min(pMin.x, pMax.x);
    const pxMaxX = Math.max(pMin.x, pMax.x);
    const pxMinY = Math.min(pMin.y, pMax.y);
    const pxMaxY = Math.max(pMin.y, pMax.y);

    const originX = pxMinX;
    const originY = pxMinY;
    const width = Math.round(pxMaxX - pxMinX);
    const height = Math.round(pxMaxY - pxMinY);

    const minTx = Math.floor(pxMinX / 256);
    const maxTx = Math.floor(pxMaxX / 256);
    const minTy = Math.floor(pxMinY / 256);
    const maxTy = Math.floor(pxMaxY / 256);

    // Extreme High-DPI: 2x canvas scaling (renders 300+ DPI on A4 landscape)
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);

    // Background fill
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, width, height);

    // Determine basemap URL generator
    const basemap = document.getElementById('basemapSelect')?.value || 'google_hybrid';
    function getTileUrl(tx, ty, zoom) {
      if (basemap === 'esri_world') {
        return `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;
      } else if (basemap === 'osm_streets') {
        const sub = ['a', 'b', 'c', 'd'][(tx + ty) % 4];
        return `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`;
      } else {
        const sub = (tx + ty) % 4;
        return `https://mt${sub}.google.com/vt/lyrs=y&x=${tx}&y=${ty}&z=${zoom}`;
      }
    }

    // 2. Fetch all satellite tiles concurrently
    if (pdfText) pdfText.innerText = 'Loading Imagery...';
    const tilePromises = [];
    for (let tx = minTx; tx <= maxTx; tx++) {
      for (let ty = minTy; ty <= maxTy; ty++) {
        tilePromises.push(new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve({ img, tx, ty });
          img.onerror = () => resolve(null);
          img.src = getTileUrl(tx, ty, z);
        }));
      }
    }

    const tiles = await Promise.all(tilePromises);
    tiles.forEach(t => {
      if (!t || !t.img) return;
      const dx = Math.round(t.tx * 256 - originX);
      const dy = Math.round(t.ty * 256 - originY);
      ctx.drawImage(t.img, dx, dy, 256, 256);
    });

    if (pdfText) pdfText.innerText = 'Drawing Vectors...';

    // 3. Draw All Vector Geometries (Polygons & Polylines) with 100% mathematical projection
    geojson.features.forEach(f => {
      const g = f.geometry;
      if (!g || !g.coordinates) return;
      if (f.properties?.type === 'text' || g.type === 'Point') return;

      const layerName = f.properties?.layer || 'Default';
      if (layerVisibility[layerName] === false) return;
      const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;

      const strokeColor = f.properties?.stroke || layerColors[layerName] || '#ef4444';
      const strokeWidth = Number(f.properties?.['stroke-width']) || 2.5;

      const rings = (g.type === 'Polygon' || g.type === 'MultiLineString')
        ? g.coordinates
        : (g.type === 'MultiPolygon' ? g.coordinates.flat() : [g.coordinates]);

      rings.forEach(ring => {
        if (!ring || ring.length === 0) return;
        ctx.save();
        ctx.beginPath();
        ring.forEach((coord, idx) => {
          const pt = project(coord[0], coord[1], z);
          const x = pt.x - originX;
          const y = pt.y - originY;
          if (idx === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        if (g.type === 'Polygon') {
          ctx.closePath();
          ctx.fillStyle = f.properties?.fill || strokeColor;
          ctx.globalAlpha = userAlpha * (Number(f.properties?.['fill-opacity']) || 0.15);
          ctx.fill();
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(2.0, strokeWidth);
        ctx.globalAlpha = userAlpha * 0.95;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.restore();
      });
    });

    // 4. Draw All Survey Stations & Points (Zero points missing!)
    geojson.features.forEach(f => {
      if (f.geometry?.type !== 'Point' || f.properties?.type === 'text') return;
      const layerName = f.properties?.layer || 'Default';
      if (layerVisibility[layerName] === false) return;
      const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;

      const coord = f.geometry.coordinates;
      const pt = project(coord[0], coord[1], z);
      const sx = pt.x - originX;
      const sy = pt.y - originY;

      ctx.save();
      ctx.globalAlpha = userAlpha;
      // Outer colored circle ring
      ctx.beginPath();
      ctx.arc(sx, sy, 5.0, 0, Math.PI * 2);
      ctx.fillStyle = f.properties?.color || layerColors[layerName] || '#10b981';
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = '#0f172a';
      ctx.stroke();

      // Inner white center dot
      ctx.beginPath();
      ctx.arc(sx, sy, 1.6, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();
    });

    // 5. Draw All CAD Text Labels (Rotated, crisp halo, exact location)
    geojson.features.forEach(f => {
      if (f.geometry?.type !== 'Point' || f.properties?.type !== 'text') return;
      const layerName = f.properties?.layer || 'Default';
      if (layerVisibility[layerName] === false) return;
      const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;

      const coord = f.geometry.coordinates;
      const pt = project(coord[0], coord[1], z);
      const sx = pt.x - originX;
      const sy = pt.y - originY;

      const title = f.properties?.title || '';
      if (!title) return;

      const rotation = Number(f.properties?.rotation) || 0;
      const labelColor = f.properties?.label_color || '#ff0000';
      const isLargeTitle = title.length > 10 && !title.startsWith('KM');
      const fontSize = isLargeTitle ? 13 : 10.5;

      ctx.save();
      ctx.translate(sx, sy);
      if (Math.abs(rotation) > 0.01) {
        let cssAngle = (-rotation) % 360;
        if (cssAngle < 0) cssAngle += 360;
        ctx.rotate((cssAngle * Math.PI) / 180);
      }

      ctx.font = `600 ${fontSize}px "JetBrains Mono", "Inter", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      // 2.2px dark halo for razor-sharp legibility against satellite imagery
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'miter';
      ctx.miterLimit = 2;
      ctx.strokeText(title, 0, 0);

      // Text color fill
      ctx.fillStyle = labelColor;
      ctx.globalAlpha = userAlpha;
      ctx.fillText(title, 0, 0);
      ctx.restore();
    });

    if (pdfText) pdfText.innerText = 'Creating PDF...';

    // 6. Generate Landscape A4 PDF with jsPDF
    if (!window.jspdf) {
      window.print();
      return;
    }

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth(); // 297mm
    const pageHeight = pdf.internal.pageSize.getHeight(); // 210mm

    // Header Banner
    pdf.setFillColor(248, 250, 252);
    pdf.rect(0, 0, pageWidth, 16, 'F');
    pdf.setDrawColor(226, 232, 240);
    pdf.line(0, 16, pageWidth, 16);

    const fileInput = document.getElementById('file');
    const fileName = (fileInput?.files?.[0]?.name) || (lastConversionGeoJSON?.filename) || 'CAD Drawing';
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11.5);
    pdf.setTextColor(15, 23, 42);
    pdf.text(fileName, 10, 10.5);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    const dateStr = new Date().toLocaleString();
    const crs = document.getElementById('target_crs')?.value || 'WGS84';
    pdf.text(`Exported: ${dateStr} • Datum: ${crs} • Native High-DPI GIS Render`, pageWidth - 10, 10.5, { align: 'right' });

    // Calculate map dimensions to maximize page area
    const margin = 8;
    const topY = 19;
    const availWidth = pageWidth - (margin * 2);
    const availHeight = pageHeight - topY - 8;

    const imgRatio = canvas.width / canvas.height;
    let targetWidth = availWidth;
    let targetHeight = targetWidth / imgRatio;

    if (targetHeight > availHeight) {
      targetHeight = availHeight;
      targetWidth = targetHeight * imgRatio;
    }

    const posX = margin + (availWidth - targetWidth) / 2;
    const posY = topY + (availHeight - targetHeight) / 2;

    const imgData = canvas.toDataURL('image/jpeg', 0.95);
    pdf.addImage(imgData, 'JPEG', posX, posY, targetWidth, targetHeight, undefined, 'FAST');

    // Outer border around map
    pdf.setDrawColor(203, 213, 225);
    pdf.rect(posX, posY, targetWidth, targetHeight, 'S');

    // Footer
    pdf.setFontSize(7.5);
    pdf.setTextColor(148, 163, 184);
    pdf.text('CAD2KML Studio • High-DPI Map Export • 100% Survey Geometry & Point Coverage', pageWidth / 2, pageHeight - 3, { align: 'center' });

    const safeName = (fileName.replace(/\.[^/.]+$/, "") || 'CAD_Map') + '_HighDPI_Report.pdf';
    pdf.save(safeName);

  } catch (err) {
    console.error('High-DPI PDF export error:', err);
    window.print();
  } finally {
    if (pdfBtn) pdfBtn.disabled = false;
    if (pdfText) pdfText.innerText = originalText;
  }
}

function fitDrawingBounds() {
  if (!geojsonLayerGroup) return;
  const layers = geojsonLayerGroup.getLayers();
  if (layers.length === 0) {
    alert('No CAD drawing currently loaded on the map.');
    return;
  }
  const firstLayer = layers[0];
  if (firstLayer && typeof firstLayer.getBounds === 'function') {
    const bounds = firstLayer.getBounds();
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
    }
  }
}

function toggleFullscreen() {
  const mapCard = document.getElementById('mapCard');
  const icon = document.getElementById('fullscreenIcon');
  const svg = document.getElementById('fullscreenIconSvg');
  const text = document.getElementById('fullscreenText');
  isFullscreen = !isFullscreen;

  mapCard.classList.toggle('fullscreen-mode', isFullscreen);
  if (svg) {
    svg.innerHTML = isFullscreen
      ? '<polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line>'
      : '<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>';
  } else if (icon) {
    icon.innerText = isFullscreen ? '🗗' : '🗖';
  }
  if (text) {
    text.innerText = isFullscreen ? 'Exit Fullscreen' : 'Fullscreen';
  }

  // Attempt native fullscreen mode as enhancement
  if (isFullscreen) {
    const el = document.documentElement;
    const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (rfs) {
      try { const p = rfs.call(el); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
  } else {
    const isNativeFs = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
    if (isNativeFs) {
      const efs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
      if (efs) {
        try { const p = efs.call(document); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      }
    }
  }

  // Multi-pass invalidation to guarantee full tile grid coverage
  if (map) {
    map.invalidateSize();
    requestAnimationFrame(() => map.invalidateSize());
    setTimeout(() => map.invalidateSize(), 50);
    setTimeout(() => map.invalidateSize(), 150);
    setTimeout(() => map.invalidateSize(), 300);
  }
}

// ==========================================
// Distance Measurement Tool
// ==========================================
function initMeasurementTool() {
  const measureBtn = document.getElementById('measureBtn');
  const clearBtn = document.getElementById('measureClearBtn');
  const finishBtn = document.getElementById('measureFinishBtn');

  if (measureBtn) {
    measureBtn.addEventListener('click', () => {
      setMeasurementActive(!isMeasurementActive);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', clearMeasurement);
  }

  if (finishBtn) {
    finishBtn.addEventListener('click', () => {
      setMeasurementActive(false);
    });
  }
}

function setMeasurementActive(active) {
  isMeasurementActive = active;
  const btn = document.getElementById('measureBtn');
  const banner = document.getElementById('measureBanner');
  if (btn) btn.classList.toggle('active', active);
  if (banner) banner.classList.toggle('active', active);

  const container = map ? map.getContainer() : null;
  if (container) {
    container.style.cursor = active ? 'crosshair' : '';
    container.classList.toggle('measuring-active', active);
  }

  if (active) {
    if (map && typeof map.closePopup === 'function') map.closePopup();
    if (measurePoints.length === 0) {
      const val = document.getElementById('measureDistanceVal');
      if (val) val.innerText = 'Click any green survey station or map point to measure';
    }
  } else {
    if (container) container.style.cursor = '';
  }
}

function handleMeasurementClick(latlng, sourceFeature) {
  if (!latlng) return;

  // Prevent duplicate points if user clicked the same location consecutively
  if (measurePoints.length > 0) {
    const last = measurePoints[measurePoints.length - 1];
    if (Math.abs(last.lat - latlng.lat) < 0.0000001 && Math.abs(last.lng - latlng.lng) < 0.0000001) {
      return;
    }
  }

  measurePoints.push(latlng);
  const ptCount = measurePoints.length;

  // Add vertex marker
  const marker = L.circleMarker(latlng, {
    radius: 6,
    className: 'measure-vertex-marker',
    fillColor: '#06b6d4',
    color: '#ffffff',
    weight: 2.5,
    opacity: 1,
    fillOpacity: 1
  }).addTo(map);

  marker.on('click', (e) => {
    if (isMeasurementActive) {
      L.DomEvent.stopPropagation(e);
    }
  });

  measureMarkers.push(marker);

  // Update line
  if (!measureLines) {
    measureLines = L.polyline(measurePoints, {
      color: '#06b6d4',
      weight: 3.5,
      dashArray: '6, 6',
      opacity: 0.95
    }).addTo(map);
  } else {
    measureLines.setLatLngs(measurePoints);
  }

  // Calculate cumulative distance and last segment distance
  totalMeasureDistance = 0;
  let lastSegmentDist = 0;
  for (let i = 0; i < measurePoints.length - 1; i++) {
    const d = computeGeodesicDistance(
      measurePoints[i].lat, measurePoints[i].lng,
      measurePoints[i + 1].lat, measurePoints[i + 1].lng
    );
    totalMeasureDistance += d;
    if (i === measurePoints.length - 2) {
      lastSegmentDist = d;
    }
  }

  const distStr = formatDistance(totalMeasureDistance);
  const bannerVal = document.getElementById('measureDistanceVal');

  let featureLabel = '';
  if (sourceFeature && sourceFeature.properties && sourceFeature.properties.title) {
    featureLabel = sourceFeature.properties.title;
  }

  if (ptCount === 1) {
    const startName = featureLabel ? `Start: ${featureLabel}` : 'Start';
    if (bannerVal) {
      bannerVal.innerText = `${startName} set. Click next point/station to measure.`;
    }
    marker.bindTooltip(startName, { permanent: true, direction: 'top', className: 'measure-segment-tooltip' }).openTooltip();
  } else {
    const segStr = formatDistance(lastSegmentDist);
    if (bannerVal) {
      bannerVal.innerText = `Total: ${distStr} (Seg: ${segStr}) | ${ptCount} points`;
    }
    const tipText = featureLabel ? `${featureLabel}: +${segStr} (${distStr})` : `+${segStr} (${distStr})`;
    marker.bindTooltip(tipText, { permanent: true, direction: 'top', className: 'measure-segment-tooltip' }).openTooltip();
  }
}

function clearMeasurement() {
  measureMarkers.forEach(m => map.removeLayer(m));
  measureMarkers = [];
  if (measureLines) {
    map.removeLayer(measureLines);
    measureLines = null;
  }
  measurePoints = [];
  totalMeasureDistance = 0;
  const val = document.getElementById('measureDistanceVal');
  if (val) val.innerText = 'Click any green survey station or map point to measure';
}

// ==========================================
// Live Coordinate & Map Status Bar
// ==========================================
function initLiveStatusBar() {
  const coordsEl = document.getElementById('statusCoords');
  const utmEl = document.getElementById('statusUtm');
  const zoomEl = document.getElementById('statusZoom');
  const crsEl = document.getElementById('statusCrs');

  let rafId = null;

  map.on('mousemove', (e) => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const lat = e.latlng.lat;
      const lon = e.latlng.lng;

      if (coordsEl) {
        const latFmt = `${Math.abs(lat).toFixed(5)}°${lat >= 0 ? 'N' : 'S'}`;
        const lonFmt = `${Math.abs(lon).toFixed(5)}°${lon >= 0 ? 'E' : 'W'}`;
        coordsEl.innerText = `${latFmt}, ${lonFmt}`;
      }

      if (utmEl) {
        try {
          const epsgSelect = document.getElementById('input_epsg');
          const currentEpsg = epsgSelect ? epsgSelect.value : 'EPSG:32644';
          const match = currentEpsg.match(/EPSG:(32[67])(\d{2})/i);
          if (match) {
            const isNorthern = match[1] === '326';
            const zone = parseInt(match[2], 10);
            const utm = latLonToUtm(lat, lon, zone, isNorthern);
            utmEl.innerText = `${utm.easting.toLocaleString()} E, ${utm.northing.toLocaleString()} N (Z${zone}${isNorthern ? 'N' : 'S'})`;
          } else {
            utmEl.innerText = 'N/A';
          }
        } catch {
          utmEl.innerText = '--';
        }
      }

      if (zoomEl) {
        const zoom = map.getZoom();
        let lod = 'Detailed (100m)';
        if (zoom < 13) lod = 'Overview (Landmarks)';
        else if (zoom <= 14) lod = 'Milestones (1km/500m)';
        else if (zoom === 15) lod = 'Intervals (200m)';
        zoomEl.innerText = `${zoom} · ${lod}`;
      }

      if (crsEl) {
        const epsgSelect = document.getElementById('input_epsg');
        crsEl.innerText = epsgSelect ? epsgSelect.value : 'EPSG:32644';
      }
    });
  });

  map.on('mouseout', () => {
    if (coordsEl) coordsEl.innerText = '--';
    if (utmEl) utmEl.innerText = '--';
  });
}

// ==========================================
// Try Sample Drawing Demo
// ==========================================
function initSampleDrawing() {
  const sampleBtn = document.getElementById('trySampleBtn');
  if (!sampleBtn) return;

  sampleBtn.addEventListener('click', async () => {
    try {
      sampleBtn.disabled = true;
      sampleBtn.innerHTML = `
        <svg class="animate-spin" width="16" height="16" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg>
        <span>Loading Sample (Althur Padu Bund)...</span>
      `;

      const res = await fetch('/api/sample-file');
      if (!res.ok) {
        throw new Error(`Failed to load sample drawing from server (HTTP ${res.status}).`);
      }
      const blob = await res.blob();
      const sampleFile = new File([blob], 'Althur_padu_bund.dwg', { type: 'application/acad' });

      // Automatically select UTM 44N (the verified CRS for this survey project)
      const epsgSelect = document.getElementById('input_epsg');
      if (epsgSelect) {
        epsgSelect.value = 'EPSG:32644';
      }

      handleFileSelected(sampleFile);

      // Trigger automatic conversion to demonstrate full workstation
      document.getElementById('convertBtn').click();
    } catch (err) {
      console.error('Error loading sample drawing:', err);
      showError('Sample File Error', err.message || 'Could not fetch sample drawing.');
    } finally {
      sampleBtn.disabled = false;
      sampleBtn.innerHTML = `
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></svg>
        <span>Try Sample Drawing (Althur Padu Bund)</span>
      `;
    }
  });
}

// Auto-detect UTM zone from map coordinates
async function updateUTMFromLatLng(lat, lon) {
  try {
    const formData = new FormData();
    formData.append('lat', lat);
    formData.append('lon', lon);

    const res = await fetch('/api/utm-zone', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if (data.epsg) {
      const selectBox = document.getElementById('input_epsg');
      let found = false;
      for (let i = 0; i < selectBox.options.length; i++) {
        if (selectBox.options[i].value === data.epsg) {
          selectBox.selectedIndex = i;
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
    bannerDesc.innerText = 'Full detail export. Includes text labels, exploded block references, circles, points, and complex polyline geometries.';
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
  document.getElementById('statsRibbon').style.display = 'none';
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
      renderGeoJSONPreview(lastConversionGeoJSON, false);
    }
  });
}

// Error / warning helpers
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
  if (Array.isArray(detail)) {
    return detail.map(d => d.msg || JSON.stringify(d)).join('; ');
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  return `Request failed with HTTP ${res.status}.`;
}

// ==========================================
// Live Preview: Re-render on setting change
// ==========================================
function setupLivePreviewListeners() {
  const settingIds = ['label_scale', 'label_orientation', 'declutter_labels', 'export_text', 'export_points', 'fill_polygons', 'fill_color', 'fill_opacity'];
  settingIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === 'label_scale' || id === 'label_orientation' || id === 'declutter_labels') {
        el.addEventListener(id === 'label_scale' ? 'input' : 'change', () => {
          updateTextLabelSizes();
        });
      } else {
        el.addEventListener('change', () => {
          if (lastConversionGeoJSON) {
            renderGeoJSONPreview(lastConversionGeoJSON, false);
          }
        });
        if (el.type === 'range' || el.type === 'color') {
          el.addEventListener('input', () => {
            if (lastConversionGeoJSON) {
              renderGeoJSONPreview(lastConversionGeoJSON, false);
            }
          });
        }
      }
    }
  });
}

function getLabelTier(text, textHeight, medianHeight) {
  const str = (text || '').trim();
  const h = Number(textHeight) || 0;
  const med = Number(medianHeight) || 10.0;

  // Tier 1: Major drawing titles, large text annotations (h >= 1.35 * median), or non-chainage words
  if (h >= med * 1.35 || (!/^KM\b/i.test(str) && !/^\d+(\.\d+)?$/.test(str) && str.length > 8)) {
    return 1;
  }
  // Tier 2: Whole Kilometer Milestones (e.g., KM 1.000, KM 2.000, KM 1, KM 2)
  if (/^KM\s*\d+(\.000?)?$/i.test(str) || /\.000$/i.test(str)) {
    return 2;
  }
  // Tier 3: 500m Intervals (e.g., KM 0.500, KM 1.500, KM 2.500)
  if (/^KM\s*\d+\.[50]00?$/i.test(str) || /\.[50]00$/i.test(str)) {
    return 3;
  }
  // Tier 4: 200m Intervals (e.g., .200, .400, .600, .800)
  if (/^KM\s*\d+\.[2468]00?$/i.test(str) || /\.[2468]00$/i.test(str)) {
    return 4;
  }
  // Tier 5: Detailed 100m chainage and all minor stations
  return 5;
}

function calculateLabelFontSize(textHeight, labelScale, zoom) {
  const currentZoom = (zoom !== undefined && zoom !== null) ? zoom : (map ? map.getZoom() : 15);
  const zoomDiff = currentZoom - 15;
  const zoomFactor = 1 + (zoomDiff * 0.04);

  let cadHeightFactor = 1.0;
  const h = Number(textHeight);
  if (h > 0 && currentMedianTextHeight > 0) {
    const ratio = h / currentMedianTextHeight;
    cadHeightFactor = Math.max(0.9, Math.min(1.2, Math.pow(ratio, 0.2)));
  }

  const scale = (labelScale !== undefined && labelScale !== null) ? labelScale : 1.0;
  const calculatedPx = 11.0 * (scale > 0 ? (0.8 + 0.2 * Math.min(scale, 1.5)) : 1.0) * zoomFactor * cadHeightFactor;
  return Math.max(9, Math.min(13, Math.round(calculatedPx)));
}

function updateTextLabelSizes() {
  if (!map) return;
  const labelScale = parseFloat(document.getElementById('label_scale')?.value) || 0.7;
  const orientation = document.getElementById('label_orientation')?.value || 'cad';
  const currentZoom = map.getZoom();
  const labels = document.querySelectorAll('.cad-label-text');

  labels.forEach(el => {
    const textHeight = parseFloat(el.getAttribute('data-text-height')) || 0;
    const newSize = calculateLabelFontSize(textHeight, labelScale, currentZoom);
    el.style.fontSize = `${newSize}px`;

    const anchorX = parseFloat(el.getAttribute('data-anchor-x')) || 0.0;
    const anchorY = parseFloat(el.getAttribute('data-anchor-y')) || 0.5;
    const rotation = parseFloat(el.getAttribute('data-rotation')) || 0;
    const pctX = Math.round(anchorX * 100);
    const pctY = Math.round(anchorY * 100);

    if (orientation !== 'horizontal' && Math.abs(rotation) > 0.01) {
      let cssAngle = (-rotation) % 360;
      if (cssAngle < 0) cssAngle += 360;
      if (orientation === 'cad_upright' && cssAngle > 90 && cssAngle < 270) {
        cssAngle = (cssAngle + 180) % 360;
      }
      el.style.transformOrigin = `${pctX}% ${pctY}%`;
      el.style.transform = `translate(-${pctX}%, -${pctY}%) rotate(${cssAngle}deg)`;
    } else {
      el.style.transformOrigin = `${pctX}% ${pctY}%`;
      el.style.transform = `translate(-${pctX}%, -${pctY}%)`;
    }
  });
  declutterTextLabels();
}

function declutterTextLabels() {
  if (!map) return;
  const declutterEl = document.getElementById('declutter_labels');
  const declutterEnabled = declutterEl ? declutterEl.checked : true;
  const labels = Array.from(document.querySelectorAll('.cad-label-text'));
  if (labels.length === 0) return;

  if (!declutterEnabled) {
    labels.forEach(el => {
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
    });
    return;
  }

  const zoom = map.getZoom();

  labels.sort((a, b) => {
    const tierA = parseInt(a.getAttribute('data-tier') || '5', 10);
    const tierB = parseInt(b.getAttribute('data-tier') || '5', 10);
    if (tierA !== tierB) return tierA - tierB;
    const ha = parseFloat(a.getAttribute('data-text-height')) || 0;
    const hb = parseFloat(b.getAttribute('data-text-height')) || 0;
    if (Math.abs(ha - hb) > 0.1) return hb - ha;
    return (a.textContent || '').localeCompare(b.textContent || '');
  });

  const occupied = [];

  labels.forEach(el => {
    const tier = parseInt(el.getAttribute('data-tier') || '5', 10);

    // Responsive Zoom LOD Visibility Thresholds:
    // zoom < 13: Tier 1 only (Major Titles / Large Landmarks)
    // zoom === 13: Tier 1 + Tier 2 (1km Milestones)
    // zoom === 14: Tier 1 + Tier 2 + Tier 3 (500m Intervals)
    // zoom === 15: Tier 1 + Tier 2 + Tier 3 + Tier 4 (200m Intervals)
    // zoom >= 16: All tiers (100m Detailed Stations)
    let allowedByZoom = true;
    if (zoom < 13 && tier > 1) allowedByZoom = false;
    else if (zoom === 13 && tier > 2) allowedByZoom = false;
    else if (zoom === 14 && tier > 3) allowedByZoom = false;
    else if (zoom === 15 && tier > 4) allowedByZoom = false;

    if (!allowedByZoom) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      return;
    }

    const padX = 6;
    const padY = 3;
    const box = {
      left: rect.left - padX,
      right: rect.right + padX,
      top: rect.top - padY,
      bottom: rect.bottom + padY
    };

    let collides = false;
    for (let i = 0; i < occupied.length; i++) {
      const o = occupied[i];
      if (box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top) {
        collides = true;
        break;
      }
    }

    if (collides) {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    } else {
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      occupied.push(box);
    }
  });
}

// ==========================================
// GeoJSON Preview Rendering & Layer System
// ==========================================
function renderGeoJSONPreview(geojson, shouldFitBounds = false) {
  geojsonLayerGroup.clearLayers();

  const showText = document.getElementById('export_text').checked;
  const showPoints = document.getElementById('export_points').checked;
  const labelScale = parseFloat(document.getElementById('label_scale').value) || 0.7;
  const orientation = document.getElementById('label_orientation')?.value || 'cad';
  const fillPolygons = document.getElementById('fill_polygons').checked;
  const fillColor = document.getElementById('fill_color').value;
  const fillOpacity = parseFloat(document.getElementById('fill_opacity').value) / 100;

  const textHeights = (geojson.features || [])
    .filter(f => f.properties && f.properties.type === 'text' && Number(f.properties.text_height) > 0)
    .map(f => Number(f.properties.text_height))
    .sort((a, b) => a - b);
  if (textHeights.length > 0) {
    currentMedianTextHeight = textHeights[Math.floor(textHeights.length / 2)];
  } else {
    currentMedianTextHeight = 1.0;
  }

  const layerSet = new Set();

  const filteredFeatures = geojson.features.filter(f => {
    const type = f.properties.type;
    if (type === 'text' && !showText) return false;
    if (type === 'point' && !showPoints) return false;
    const layerName = f.properties.layer || 'Default';
    layerSet.add(layerName);

    // Track color for layer chip
    if (!layerColors[layerName]) {
      layerColors[layerName] = f.properties.stroke || f.properties.color || f.properties.label_color || '#3b82f6';
    }

    if (layerVisibility[layerName] === false) return false;
    return true;
  });

  const currentZoom = map ? map.getZoom() : 15;

  const geojsonLayer = L.geoJSON({ type: 'FeatureCollection', features: filteredFeatures }, {
    style: (feature) => {
      const props = feature.properties;
      const layerName = props.layer || 'Default';
      const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;

      if (feature.geometry.type === 'Point') {
        const ptColor = safeColor(props.color, '#10b981');
        return {
          radius: 4.5,
          fillColor: ptColor,
          fillOpacity: 1.0 * userAlpha,
          color: '#1e293b',
          weight: 1.5,
          fill: true,
          opacity: userAlpha
        };
      }

      const baseStyle = {
        color: safeColor(props.stroke, '#ef4444'),
        weight: props['stroke-width'] || 2.5,
        opacity: 0.9 * userAlpha,
      };

      if (feature.geometry.type === 'Polygon') {
        if (props.filled) {
          baseStyle.fillColor = safeColor(props.fill, '#ef4444');
          baseStyle.fillOpacity = (props['fill-opacity'] ?? 0.3) * userAlpha;
        } else {
          baseStyle.fillColor = fillPolygons ? fillColor : safeColor(props.fill, '#ef4444');
          baseStyle.fillOpacity = (fillPolygons ? fillOpacity : (props['fill-opacity'] ?? 0.1)) * userAlpha;
        }
      } else {
        baseStyle.fill = false;
      }
      return baseStyle;
    },
    pointToLayer: (feature, latlng) => {
      const props = feature.properties;
      const layerName = props.layer || 'Default';
      const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;

      if (props.type === 'text') {
        const textHeight = Number(props.text_height) || 0;
        const tier = getLabelTier(props.title, textHeight, currentMedianTextHeight);
        const fontSize = calculateLabelFontSize(textHeight, labelScale, currentZoom);
        const rotation = Number(props.rotation) || 0;
        const labelColor = safeColor(props.label_color, '#ff0000');
        const anchorX = (props.anchor_x !== undefined && props.anchor_x !== null) ? Number(props.anchor_x) : 0.0;
        const anchorY = (props.anchor_y !== undefined && props.anchor_y !== null) ? Number(props.anchor_y) : 0.5;
        const fontWeight = props.bold ? '700' : '600';
        const fontStyle = props.italic ? 'italic' : 'normal';
        const fontFamily = props.font_family ? `"${props.font_family}", sans-serif` : 'inherit';

        const pctX = Math.round(anchorX * 100);
        const pctY = Math.round(anchorY * 100);
        let transformStyle = `transform-origin: ${pctX}% ${pctY}%; transform: translate(-${pctX}%, -${pctY}%);`;

        if (orientation !== 'horizontal' && Math.abs(rotation) > 0.01) {
          let cssAngle = (-rotation) % 360;
          if (cssAngle < 0) cssAngle += 360;
          if (orientation === 'cad_upright' && cssAngle > 90 && cssAngle < 270) {
            cssAngle = (cssAngle + 180) % 360;
          }
          transformStyle = `transform-origin: ${pctX}% ${pctY}%; transform: translate(-${pctX}%, -${pctY}%) rotate(${cssAngle}deg);`;
        }

        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'map-text-label',
            html: `<span class="cad-label-text" data-text-height="${textHeight}" data-tier="${tier}" data-anchor-x="${anchorX}" data-anchor-y="${anchorY}" data-rotation="${rotation}" style="color: ${labelColor}; font-size: ${fontSize}px; font-weight: ${fontWeight}; font-style: ${fontStyle}; font-family: ${fontFamily}; opacity: ${userAlpha}; ${transformStyle}">${escapeHtml(props.title)}</span>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0]
          })
        });
      }

      const stationMarker = L.circleMarker(latlng, {
        radius: 4.5,
        className: 'survey-station-marker',
        fillColor: safeColor(props.color, '#10b981'),
        color: '#1e293b',
        weight: 1.5,
        opacity: userAlpha,
        fillOpacity: 1.0 * userAlpha
      });

      if (props.title || props.layer) {
        stationMarker.bindTooltip(escapeHtml(props.title || `Station (${props.layer})`), {
          className: 'cad-station-tooltip',
          direction: 'top',
          offset: [0, -6],
          opacity: 0.95
        });
      }
      return stationMarker;
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties;
      const geomType = feature.geometry.type;

      // Guard layer.openPopup: during measurement mode, do not open popups
      if (typeof layer.openPopup === 'function') {
        const origOpenPopup = layer.openPopup;
        layer.openPopup = function() {
          if (isMeasurementActive) return this;
          return origOpenPopup.apply(this, arguments);
        };
      }

      // Click handler: route to measurement tool when measuring is active
      layer.on('click', (e) => {
        if (isMeasurementActive) {
          L.DomEvent.stopPropagation(e);
          if (e.originalEvent) {
            e.originalEvent.stopPropagation();
            e.originalEvent.preventDefault();
          }
          if (typeof layer.closePopup === 'function') layer.closePopup();
          if (map && typeof map.closePopup === 'function') map.closePopup();

          let targetLatLng = null;
          if (typeof layer.getLatLng === 'function') {
            targetLatLng = layer.getLatLng();
          } else if (e.latlng) {
            const snapped = findNearestVertex(e.latlng, feature, 20);
            targetLatLng = snapped || e.latlng;
          }

          if (targetLatLng) {
            handleMeasurementClick(targetLatLng, feature);
          }
          return;
        }
      });

      // Hover inspection glow & measurement snapping feedback
      layer.on({
        mouseover: (e) => {
          if (isMeasurementActive) {
            if (geomType === 'Point' && typeof layer.setRadius === 'function') {
              layer.setRadius(7.5);
              layer.setStyle({ fillColor: '#06b6d4', color: '#ffffff', weight: 2.5 });
              const label = props ? (props.title || props.layer || 'Station') : 'Station';
              layer.bindTooltip(`🎯 ${label}`, { permanent: false, direction: 'top', className: 'measure-snap-tooltip' }).openTooltip();
            }
            return;
          }
          if (typeof layer.setStyle === 'function' && geomType !== 'Point') {
            layer.setStyle({ weight: (props['stroke-width'] || 2.5) + 2.5, color: '#38bdf8' });
          }
          showFeatureInspector(feature);
        },
        mouseout: (e) => {
          if (isMeasurementActive) {
            if (geomType === 'Point' && typeof layer.setRadius === 'function') {
              layer.setRadius(4.5);
              const userAlpha = (layerOpacity[props.layer || 'Default'] !== undefined) ? layerOpacity[props.layer || 'Default'] : 1.0;
              layer.setStyle({
                fillColor: safeColor(props.color, '#10b981'),
                color: '#1e293b',
                weight: 1.5,
                fillOpacity: 1.0 * userAlpha
              });
              if (layer.unbindTooltip && (!layer.getTooltip() || !layer.getTooltip().options.permanent)) {
                layer.unbindTooltip();
              }
            }
            return;
          }
          if (typeof layer.setStyle === 'function' && geomType !== 'Point') {
            const layerName = props.layer || 'Default';
            const userAlpha = (layerOpacity[layerName] !== undefined) ? layerOpacity[layerName] : 1.0;
            layer.setStyle({
              weight: props['stroke-width'] || 2.5,
              color: safeColor(props.stroke, '#ef4444'),
              opacity: 0.9 * userAlpha
            });
          }
          hideFeatureInspector();
        }
      });

      if (props && props.layer) {
        if (props.type === 'text') {
          layer.bindPopup(
            `<strong>Text Label</strong><br>` +
            `<strong>Text:</strong> ${escapeHtml(props.title || '')}<br>` +
            `<strong>Layer:</strong> ${escapeHtml(props.layer)}<br>` +
            `<strong>Height:</strong> ${props.text_height || 'N/A'}<br>` +
            `<strong>Rotation:</strong> ${(props.rotation || 0).toFixed(1)}°`
          );
        } else {
          layer.bindPopup(`<strong>Layer:</strong> ${escapeHtml(props.layer)}<br>${escapeHtml(props.title || '')}`);
        }
      }
    }
  });

  geojsonLayerGroup.addLayer(geojsonLayer);

  if (map) {
    map.invalidateSize();
  }

  const bounds = geojsonLayer.getBounds();
  if (shouldFitBounds && bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }

  buildLayerPanel(layerSet);
  requestAnimationFrame(() => {
    updateTextLabelSizes();
  });
}

// ==========================================
// Feature Hover Inspector Tooltip
// ==========================================
function showFeatureInspector(feature) {
  const card = document.getElementById('featureInspectorCard');
  if (!card) return;

  const props = feature.properties || {};
  const geomType = feature.geometry.type;

  document.getElementById('inspectorLayer').innerText = `Layer: ${props.layer || 'Default'}`;
  document.getElementById('inspectorType').innerText = props.type === 'text' ? 'Text Label' : geomType;

  const lengthRow = document.getElementById('inspectorLengthRow');
  const areaRow = document.getElementById('inspectorAreaRow');

  if (geomType === 'LineString') {
    const len = calculateFeatureLengthMeters(feature.geometry.coordinates);
    lengthRow.style.display = 'flex';
    document.getElementById('inspectorLength').innerText = formatDistance(len);
    areaRow.style.display = 'none';
    document.getElementById('inspectorVertices').innerText = feature.geometry.coordinates.length;
  } else if (geomType === 'Polygon') {
    const ring = feature.geometry.coordinates[0] || [];
    const areaM2 = calculatePolygonAreaM2(ring);
    areaRow.style.display = 'flex';
    document.getElementById('inspectorArea').innerText = `${Math.round(areaM2).toLocaleString()} m² (${(areaM2 / 10000).toFixed(2)} ha)`;
    lengthRow.style.display = 'none';
    document.getElementById('inspectorVertices').innerText = ring.length;
  } else {
    lengthRow.style.display = 'none';
    areaRow.style.display = 'none';
    document.getElementById('inspectorVertices').innerText = '1';
  }

  card.classList.add('active');
}

function hideFeatureInspector() {
  const card = document.getElementById('featureInspectorCard');
  if (card) card.classList.remove('active');
}

// ==========================================
// Enhanced Layer Management Panel
// ==========================================
function buildLayerPanel(layerSet) {
  const panel = document.getElementById('layerPanel');
  const body = document.getElementById('layerPanelBody');

  if (layerSet.size === 0) {
    panel.style.display = 'none';
    return;
  }

  body.replaceChildren();

  // Quick All On / All Off buttons
  const allOnBtn = document.getElementById('layerAllOnBtn');
  const allOffBtn = document.getElementById('layerAllOffBtn');
  if (allOnBtn) {
    allOnBtn.onclick = () => {
      layerSet.forEach(l => { layerVisibility[l] = true; });
      if (lastConversionGeoJSON) renderGeoJSONPreview(lastConversionGeoJSON, false);
      buildLayerPanel(layerSet);
    };
  }
  if (allOffBtn) {
    allOffBtn.onclick = () => {
      layerSet.forEach(l => { layerVisibility[l] = false; });
      if (lastConversionGeoJSON) renderGeoJSONPreview(lastConversionGeoJSON, false);
      buildLayerPanel(layerSet);
    };
  }

  [...layerSet].sort().forEach((layerName, index) => {
    if (layerVisibility[layerName] === undefined) {
      layerVisibility[layerName] = true;
    }
    if (layerOpacity[layerName] === undefined) {
      layerOpacity[layerName] = 1.0;
    }

    const row = document.createElement('div');
    row.className = 'layer-item';

    const top = document.createElement('div');
    top.className = 'layer-item-top';

    const colorChip = document.createElement('span');
    colorChip.className = 'layer-color-chip';
    colorChip.style.backgroundColor = layerColors[layerName] || '#3b82f6';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'layer-visibility-chk';
    checkbox.checked = layerVisibility[layerName] !== false;
    checkbox.id = `layer_${index}`;
    checkbox.addEventListener('change', () => {
      layerVisibility[layerName] = checkbox.checked;
      if (lastConversionGeoJSON) {
        renderGeoJSONPreview(lastConversionGeoJSON, false);
      }
    });

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.className = 'layer-item-name';
    label.textContent = layerName;
    label.title = layerName;

    top.appendChild(colorChip);
    top.appendChild(checkbox);
    top.appendChild(label);

    const opacityWrap = document.createElement('div');
    opacityWrap.className = 'layer-item-opacity';

    const opacitySlider = document.createElement('input');
    opacitySlider.type = 'range';
    opacitySlider.min = '0';
    opacitySlider.max = '100';
    opacitySlider.className = 'layer-opacity-slider';
    opacitySlider.title = `Opacity: ${Math.round(layerOpacity[layerName] * 100)}%`;
    opacitySlider.value = Math.round(layerOpacity[layerName] * 100);
    opacitySlider.addEventListener('input', () => {
      layerOpacity[layerName] = parseFloat(opacitySlider.value) / 100;
      opacitySlider.title = `Opacity: ${opacitySlider.value}%`;
      if (lastConversionGeoJSON) {
        renderGeoJSONPreview(lastConversionGeoJSON, false);
      }
    });

    opacityWrap.appendChild(opacitySlider);

    row.appendChild(top);
    row.appendChild(opacityWrap);
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
// 4-Step Honest Conversion Progress
// ==========================================
function updateConversionProgress(activeStep, percent) {
  const progress = document.getElementById('conversionProgress');
  const pctText = document.getElementById('progressStepPercent');
  if (!progress) return;

  progress.style.display = 'block';
  if (pctText) pctText.innerText = `${percent}%`;

  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step${i}`);
    if (!stepEl) continue;

    if (i < activeStep) {
      stepEl.className = 'step-item done';
      stepEl.querySelector('.step-indicator').innerText = '✓';
    } else if (i === activeStep) {
      stepEl.className = 'step-item active';
      stepEl.querySelector('.step-indicator').innerText = `${i}`;
    } else {
      stepEl.className = 'step-item';
      stepEl.querySelector('.step-indicator').innerText = `${i}`;
    }
  }
}

function completeConversionProgress() {
  const pctText = document.getElementById('progressStepPercent');
  if (pctText) pctText.innerText = '100%';
  for (let i = 1; i <= 4; i++) {
    const stepEl = document.getElementById(`step${i}`);
    if (stepEl) {
      stepEl.className = 'step-item done';
      stepEl.querySelector('.step-indicator').innerText = '✓';
    }
  }
  setTimeout(() => {
    const progress = document.getElementById('conversionProgress');
    if (progress) progress.style.display = 'none';
  }, 1600);
}

// ==========================================
// CAD Statistics Ribbon
// ==========================================
function updateCADStatsRibbon(geojson, stats) {
  const ribbon = document.getElementById('statsRibbon');
  if (!ribbon || !geojson) return;

  // Calculate real total linear length across all polylines
  let totalLengthMeters = 0;
  (geojson.features || []).forEach(f => {
    if (f.geometry && f.geometry.type === 'LineString') {
      totalLengthMeters += calculateFeatureLengthMeters(f.geometry.coordinates);
    }
  });

  const entVal = document.getElementById('statEntities');
  const lenVal = document.getElementById('statLength');
  const lblVal = document.getElementById('statLabels');
  const ptVal = document.getElementById('statPoints');
  const crsVal = document.getElementById('statCrs');
  const fmtVal = document.getElementById('statFormat');

  if (entVal) entVal.innerText = stats.total_entities || (stats.total_shapes + stats.total_markers) || '0';
  if (lenVal) lenVal.innerText = formatDistance(totalLengthMeters);
  if (lblVal) lblVal.innerText = stats.labels || '0';
  if (ptVal) ptVal.innerText = stats.points || '0';

  if (crsVal) {
    const epsgSelect = document.getElementById('input_epsg');
    const selectedCrs = epsgSelect ? epsgSelect.value : 'EPSG:32644';
    const match = selectedCrs.match(/326(\d{2})/);
    crsVal.innerText = match ? `UTM ${match[1]}N` : selectedCrs;
  }

  if (fmtVal) {
    const fmtSelect = document.getElementById('output_format');
    fmtVal.innerText = (fmtSelect ? fmtSelect.value : 'kml').toUpperCase();
  }

  ribbon.style.display = 'flex';
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
      showError('No File Selected', 'Please upload a .DXF or .DWG file first.');
      return;
    }

    convertBtn.disabled = true;
    convertBtn.innerHTML = `
      <svg class="animate-spin" width="20" height="20" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
      </svg>
      Processing Workstation Conversion...
    `;

    successBanner.classList.remove('active');
    geojsonLayerGroup.clearLayers();
    lastConversionGeoJSON = null;
    layerVisibility = {};
    layerOpacity = {};

    updateConversionProgress(1, 15);

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

      // Honest stage progression
      setTimeout(() => updateConversionProgress(2, 45), 250);
      setTimeout(() => updateConversionProgress(3, 75), 650);

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });
      const data = await readJson(res);

      if (!res.ok) {
        throw new Error(errorDetail(data, res));
      }

      updateConversionProgress(4, 90);

      if (data.geojson && Array.isArray(data.geojson.features)) {
        lastConversionGeoJSON = data.geojson;
        lastJobId = data.job_id;
        renderGeoJSONPreview(data.geojson, true);
        updateCADStatsRibbon(data.geojson, data.stats);
      }

      completeConversionProgress();

      const warnings = [...(data.warnings || [])];
      if (data.preview_truncated) {
        warnings.push('The in-browser preview was capped at 150,000 vertices; the downloaded KML file contains the full geometry.');
      }
      showWarnings(warnings);

      downloadBtn.href = data.download_url;
      const downloadFilename = data.filename || 'converted_drawing.kml';
      downloadBtn.setAttribute('download', downloadFilename);
      downloadBtn.onclick = async (ev) => {
        ev.preventDefault();
        try {
          const dlRes = await fetch(downloadBtn.href);
          if (!dlRes.ok) throw new Error(`Download request returned HTTP ${dlRes.status}`);
          const blob = await dlRes.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = downloadFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
        } catch (err) {
          console.warn('Blob download fallback to direct link:', err);
          window.location.href = downloadBtn.href;
        }
      };

      successSummary.innerText = `Successfully projected ${data.stats.total_shapes} shapes and ${data.stats.total_markers} markers into Google Earth format.`;
      successBanner.classList.add('active');

    } catch (err) {
      console.error('Conversion failed:', err);
      const progress = document.getElementById('conversionProgress');
      if (progress) progress.style.display = 'none';

      if (err.name === 'AbortError') {
        showError('Conversion Timed Out', 'The conversion took longer than expected. Please verify your file or try standard mode.');
      } else {
        showError('Conversion Failed', err.message || 'An unexpected error occurred during CAD conversion.');
      }
    } finally {
      clearTimeout(timer);
      convertBtn.disabled = false;
      convertBtn.innerHTML = idleButtonHtml;
    }
  });
}

function initShareModal() {
  const shareBtn = document.getElementById('shareBtn');
  const modal = document.getElementById('shareModal');
  const closeBtn = document.getElementById('shareModalClose');
  const genBtn = document.getElementById('generateShareBtn');
  const copyBtn = document.getElementById('copyShareUrlBtn');
  const urlInput = document.getElementById('shareUrlInput');
  const resultBox = document.getElementById('shareResultBox');
  const noticeEl = document.getElementById('shareExpiryNotice');
  const openLink = document.getElementById('openShareUrlLink');

  if (!modal) return;

  const openModal = () => {
    if (!lastJobId) {
      alert('Please convert a CAD drawing first before creating a share link.');
      return;
    }
    modal.style.display = 'flex';
    resultBox.style.display = 'none';
  };

  const closeModal = () => {
    modal.style.display = 'none';
  };

  shareBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  genBtn?.addEventListener('click', async () => {
    if (!lastJobId) return;
    const hours = document.getElementById('shareExpirySelect')?.value || '24';
    genBtn.disabled = true;
    genBtn.innerText = 'Generating link...';

    try {
      const formData = new FormData();
      formData.append('job_id', lastJobId);
      formData.append('expires_in_hours', hours);

      const res = await fetch('/api/share', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to create share link.');
      }

      const data = await res.json();
      urlInput.value = data.share_url;
      if (openLink) openLink.href = data.share_url;
      if (noticeEl) {
        noticeEl.innerText = `⏱️ Active for ${data.expires_in_hours} hours (expires ${new Date(data.expires_at).toLocaleString()})`;
      }
      resultBox.style.display = 'block';
    } catch (err) {
      alert(err.message || 'Error creating share link.');
    } finally {
      genBtn.disabled = false;
      genBtn.innerText = 'Generate Share Link';
    }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!urlInput.value) return;
    try {
      await navigator.clipboard.writeText(urlInput.value);
      const textSpan = document.getElementById('copyBtnText');
      if (textSpan) {
        textSpan.innerText = 'Copied!';
        setTimeout(() => { textSpan.innerText = 'Copy'; }, 2000);
      }
    } catch (e) {
      urlInput.select();
      document.execCommand('copy');
    }
  });
}

