"use client";

import React, { useEffect, useRef, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useGisStore } from "@/stores/useGisStore";
import { useConverterStore } from "@/stores/useConverterStore";
import { useInspectorStore } from "@/stores/useInspectorStore";
import {
  calculateLabelFontSize,
  getLabelTier,
  calculateCssTransform,
  isLabelVisibleAtZoom,
} from "@/lib/gis/labels";
import {
  computeGeodesicDistance,
  formatDistance,
  calculateFeatureLengthMeters,
  calculatePolygonAreaM2,
  accumulateDistances,
} from "@/lib/gis/geodesy";
import { getGeodesyWorker } from "@/lib/gis/geodesyWorkerClient";
import { findNearestVertex } from "@/lib/gis/snapping";
import { latLonToUtm, calculateUtmZone } from "@/lib/gis/utm";
import { safeColor, escapeHtml } from "@/lib/utils";

function createTileLayer(basemap: string): L.TileLayer {
  if (basemap === "esri_world") {
    return L.tileLayer(
      "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      {
        maxNativeZoom: 18,
        maxZoom: 22,
        keepBuffer: 8,
        updateWhenIdle: false,
        updateInterval: 80,
        attribution: "Tiles &copy; Esri",
      }
    );
  }
  if (basemap === "osm_streets") {
    return L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
      {
        subdomains: "abcd",
        maxNativeZoom: 19,
        maxZoom: 22,
        keepBuffer: 8,
        updateWhenIdle: false,
        updateInterval: 80,
        attribution: "&copy; CartoDB, &copy; OpenStreetMap",
      }
    );
  }
  // Google Hybrid default
  return L.tileLayer(
    "https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
    {
      subdomains: ["0", "1", "2", "3"],
      maxNativeZoom: 20,
      maxZoom: 22,
      keepBuffer: 8,
      updateWhenIdle: false,
      updateInterval: 80,
      attribution: "Imagery &copy; Google",
    }
  );
}

export function LeafletMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const activeBasemapRef = useRef<L.TileLayer | null>(null);
  const geojsonLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const measureLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const prevGeojsonRef = useRef<any>(null);
  const currentBoundsRef = useRef<L.LatLngBounds | null>(null);
  const [mapReady, setMapReady] = React.useState(false);
  const hasFittedRef = useRef<boolean>(false);

  const {
    basemap,
    geojson,
    layerVisibility,
    layerOpacity,
    medianTextHeight,
    labelOrientation,
    declutterLabels,
    isMeasuring,
    measurePoints,
    isSelectingLocation,
    addMeasurePoint,
    setIsSelectingLocation,
    registerMap,
    unregisterMap,
  } = useGisStore();

  const { parameters, updateParameters } = useConverterStore();
  const { setInspectedFeature, setCursorCoordinates, setZoomLevel } =
    useInspectorStore();

  // Label sizing and collision decluttering
  const updateLabelsDOM = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();

    const labelEls = Array.from(
      document.querySelectorAll<HTMLElement>(".cad-label-text")
    );
    if (labelEls.length === 0) return;

    labelEls.forEach((el) => {
      const textHeight = parseFloat(el.getAttribute("data-text-height") || "0");
      const newSize = calculateLabelFontSize(
        textHeight,
        parameters.label_scale,
        zoom,
        medianTextHeight
      );
      el.style.fontSize = `${newSize}px`;

      const anchorX = parseFloat(el.getAttribute("data-anchor-x") || "0");
      const anchorY = parseFloat(el.getAttribute("data-anchor-y") || "0.5");
      const rotation = parseFloat(el.getAttribute("data-rotation") || "0");
      const transform = calculateCssTransform(
        rotation,
        anchorX,
        anchorY,
        labelOrientation
      );
      el.style.transformOrigin = transform.transformOrigin;
      el.style.transform = transform.transform;
    });

    if (!declutterLabels) {
      labelEls.forEach((el) => {
        el.style.opacity = "1";
        el.style.pointerEvents = "auto";
      });
      return;
    }

    // Sort by tier and text height
    labelEls.sort((a, b) => {
      const tierA = parseInt(a.getAttribute("data-tier") || "5", 10);
      const tierB = parseInt(b.getAttribute("data-tier") || "5", 10);
      if (tierA !== tierB) return tierA - tierB;
      const ha = parseFloat(a.getAttribute("data-text-height") || "0");
      const hb = parseFloat(b.getAttribute("data-text-height") || "0");
      return hb - ha;
    });

    const occupied: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }[] = [];

    labelEls.forEach((el) => {
      const tier = parseInt(el.getAttribute("data-tier") || "5", 10);
      if (!isLabelVisibleAtZoom(tier, zoom)) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        return;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        el.style.opacity = "0";
        return;
      }

      const box = {
        left: rect.left - 6,
        right: rect.right + 6,
        top: rect.top - 3,
        bottom: rect.bottom + 3,
      };

      const collides = occupied.some(
        (o) =>
          box.left < o.right &&
          box.right > o.left &&
          box.top < o.bottom &&
          box.bottom > o.top
      );

      if (collides) {
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
      } else {
        el.style.opacity = "1";
        el.style.pointerEvents = "auto";
        occupied.push(box);
      }
    });
  }, [declutterLabels, labelOrientation, medianTextHeight, parameters.label_scale]);

  // Initialize Map Once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: true,
      maxZoom: 22,
    }).setView([15.8281, 78.0373], 11);

    mapRef.current = map;
    setZoomLevel(11);

    // Expose map on container element and window for compatibility
    if (mapContainerRef.current) {
      (mapContainerRef.current as any)._leaflet_map = map;
    }
    if (typeof window !== "undefined") {
      (window as any)._leaflet_map_instance = map;
      (window as any).L = L;
    }

    // Add initial basemap tile layer immediately
    const initialLayer = createTileLayer(basemap);
    initialLayer.addTo(map);
    activeBasemapRef.current = initialLayer;

    // Add surveyor metric scale bar
    L.control
      .scale({
        metric: true,
        imperial: false,
        position: "bottomleft",
        maxWidth: 140,
      })
      .addTo(map);

    const geoGroup = L.layerGroup().addTo(map);
    geojsonLayerGroupRef.current = geoGroup;

    const measureGroup = L.layerGroup().addTo(map);
    measureLayerGroupRef.current = measureGroup;

    registerMap(map, () => {
      if (currentBoundsRef.current && currentBoundsRef.current.isValid()) {
        map.invalidateSize();
        map.fitBounds(currentBoundsRef.current, { padding: [50, 50], maxZoom: 18 });
      }
    });

    setMapReady(true);

    // Track cursor telemetry
    let rafId: number | null = null;
    map.on("mousemove", (e: L.LeafletMouseEvent) => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const lat = e.latlng.lat;
        const lon = e.latlng.lng;
        try {
          const utm = latLonToUtm(lat, lon);
          setCursorCoordinates(
            { lat, lon },
            { easting: utm.easting, northing: utm.northing, zone: utm.zone }
          );
        } catch {
          setCursorCoordinates({ lat, lon }, null);
        }
      });
    });

    map.on("zoomend", () => {
      setZoomLevel(map.getZoom());
      updateLabelsDOM();
    });

    // ResizeObserver to prevent partial tile grids and guarantee fit on first valid container layout
    const ro = new ResizeObserver(() => {
      map.invalidateSize();
      if (
        currentBoundsRef.current &&
        currentBoundsRef.current.isValid() &&
        !hasFittedRef.current
      ) {
        hasFittedRef.current = true;
        map.fitBounds(currentBoundsRef.current, { padding: [50, 50], maxZoom: 18 });
      }
    });
    ro.observe(mapContainerRef.current);

    return () => {
      ro.disconnect();
      unregisterMap();
      setMapReady(false);
      if (activeBasemapRef.current) {
        try {
          map.removeLayer(activeBasemapRef.current);
        } catch {}
        activeBasemapRef.current = null;
      }
      map.remove();
      mapRef.current = null;
    };
  }, [basemap, setCursorCoordinates, setZoomLevel, registerMap, unregisterMap, updateLabelsDOM]);

  // Basemap switcher
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (activeBasemapRef.current) {
      try {
        map.removeLayer(activeBasemapRef.current);
      } catch {}
    }

    const layer = createTileLayer(basemap);
    layer.addTo(map);
    activeBasemapRef.current = layer;

    if (geojsonLayerGroupRef.current) {
      geojsonLayerGroupRef.current.eachLayer((l: any) => {
        if (typeof l.bringToFront === "function") {
          l.bringToFront();
        }
      });
    }
  }, [basemap, mapReady]);

  // Measurement point calculation helper
  const handleNewMeasurePoint = useCallback(
    (pt: { lat: number; lng: number }) => {
      const prev = measurePoints;
      const allPoints = [...prev, pt];
      const { totalDistance, segmentDistances } = accumulateDistances(allPoints);
      const segDist =
        segmentDistances.length > 0
          ? segmentDistances[segmentDistances.length - 1]
          : 0;

      addMeasurePoint(pt, segDist, totalDistance);
    },
    [measurePoints, addMeasurePoint]
  );

  // Snapping search helper using dedicated snapping module
  const findNearestVertexOrStation = useCallback(
    (latlng: L.LatLng, tolerancePx = 22) => {
      const map = mapRef.current;
      if (!map || !geojson || !Array.isArray(geojson.features)) return null;

      const snapped = findNearestVertex({ lat: latlng.lat, lng: latlng.lng }, geojson, {
        latLngToScreenPx: (pt) => {
          const p = map.latLngToContainerPoint([pt.lat, pt.lng]);
          return { x: p.x, y: p.y };
        },
        tolerancePx,
      });

      return snapped ? { lat: snapped.lat, lng: snapped.lng } : null;
    },
    [geojson]
  );

  // Map Click Handler for Measurement and Location Picker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (isSelectingLocation) {
        try {
          const zoneInfo = calculateUtmZone(e.latlng.lat, e.latlng.lng);
          updateParameters({ input_epsg: zoneInfo.epsg });
          setIsSelectingLocation(false);
          map.getContainer().style.cursor = "";
        } catch (err: any) {
          alert(err.message || "Failed to calculate UTM zone.");
        }
        return;
      }

      if (isMeasuring) {
        // Vertex / Station snap check
        const snapped = findNearestVertexOrStation(e.latlng, 22);
        const pt = snapped || { lat: e.latlng.lat, lng: e.latlng.lng };
        handleNewMeasurePoint(pt);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [
    isSelectingLocation,
    isMeasuring,
    updateParameters,
    setIsSelectingLocation,
    findNearestVertexOrStation,
    handleNewMeasurePoint,
  ]);

  // Sync Measurement Overlay Markers & Lines
  useEffect(() => {
    const group = measureLayerGroupRef.current;
    if (!group) return;
    group.clearLayers();

    if (!isMeasuring || measurePoints.length === 0) return;

    const latlngs = measurePoints.map((p) => L.latLng(p.lat, p.lng));

    // Polyline
    if (latlngs.length > 1) {
      L.polyline(latlngs, {
        color: "#06b6d4",
        weight: 3.5,
        dashArray: "6, 6",
        opacity: 0.95,
      }).addTo(group);
    }

    // Vertex Markers
    latlngs.forEach((ll, idx) => {
      const marker = L.circleMarker(ll, {
        radius: 6,
        fillColor: "#06b6d4",
        color: "#ffffff",
        weight: 2.5,
        fillOpacity: 1,
      }).addTo(group);

      if (idx === 0) {
        marker
          .bindTooltip("Start", { permanent: true, direction: "top" })
          .openTooltip();
      } else {
        const segDist = computeGeodesicDistance(
          latlngs[idx - 1].lat,
          latlngs[idx - 1].lng,
          ll.lat,
          ll.lng
        );
        marker
          .bindTooltip(`+${formatDistance(segDist)}`, {
            permanent: true,
            direction: "top",
          })
          .openTooltip();
      }
    });
  }, [isMeasuring, measurePoints]);

  // Render GeoJSON Features
  useEffect(() => {
    const group = geojsonLayerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    group.clearLayers();
    if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
      currentBoundsRef.current = null;
      return;
    }

    const currentZoom = map.getZoom();

    const filteredFeatures = geojson.features.filter((f) => {
      const type = f.properties?.type;
      if (type === "text" && !parameters.export_text) return false;
      if (type === "point" && !parameters.export_points) return false;
      const layerName = f.properties?.layer || "Default";
      if (layerVisibility[layerName] === false) return false;
      return true;
    });

    const geoLayer = L.geoJSON(
      { type: "FeatureCollection", features: filteredFeatures } as any,
      {
        style: (feature) => {
          if (!feature) return {};
          const props = feature.properties || {};
          const layerName = props.layer || "Default";
          const userAlpha =
            layerOpacity[layerName] !== undefined
              ? layerOpacity[layerName]
              : 1.0;

          if (feature.geometry.type === "Point") {
            return {
              radius: 4.5,
              fillColor: safeColor(props.color, "#10b981"),
              fillOpacity: userAlpha,
              color: "#1e293b",
              weight: 1.5,
              opacity: userAlpha,
            };
          }

          const baseStyle: any = {
            color: safeColor(props.stroke, "#ef4444"),
            weight: props["stroke-width"] || 2.5,
            opacity: 0.9 * userAlpha,
          };

          if (
            feature.geometry.type === "Polygon" ||
            feature.geometry.type === "MultiPolygon"
          ) {
            if (props.filled) {
              baseStyle.fillColor = safeColor(props.fill, "#ef4444");
              baseStyle.fillOpacity = (props["fill-opacity"] ?? 0.3) * userAlpha;
              baseStyle.fill = true;
            } else {
              baseStyle.fillColor = parameters.fill_polygons
                ? parameters.fill_color
                : safeColor(props.fill, "#ef4444");
              baseStyle.fillOpacity =
                (parameters.fill_polygons
                  ? parameters.fill_opacity
                  : (props["fill-opacity"] ?? 0.1)) * userAlpha;
              baseStyle.fill = parameters.fill_polygons || Boolean(props.fill);
            }
          }
          return baseStyle;
        },
        pointToLayer: (feature, latlng) => {
          const props = feature.properties || {};
          const layerName = props.layer || "Default";
          const userAlpha =
            layerOpacity[layerName] !== undefined
              ? layerOpacity[layerName]
              : 1.0;

          if (props.type === "text") {
            const textHeight = Number(props.text_height) || 0;
            const tier = getLabelTier(
              props.title || "",
              textHeight,
              medianTextHeight
            );
            const fontSize = calculateLabelFontSize(
              textHeight,
              parameters.label_scale,
              currentZoom,
              medianTextHeight
            );
            const rotation = Number(props.rotation) || 0;
            const labelColor = safeColor(props.label_color, "#ff0000");
            const anchorX = Number(props.anchor_x ?? 0.0);
            const anchorY = Number(props.anchor_y ?? 0.5);

            const transform = calculateCssTransform(
              rotation,
              anchorX,
              anchorY,
              labelOrientation
            );

            return L.marker(latlng, {
              icon: L.divIcon({
                className: "map-text-label",
                html: `<span class="cad-label-text" data-text-height="${textHeight}" data-tier="${tier}" data-anchor-x="${anchorX}" data-anchor-y="${anchorY}" data-rotation="${rotation}" style="color: ${labelColor}; font-size: ${fontSize}px; font-weight: 600; opacity: ${userAlpha}; transform-origin: ${transform.transformOrigin}; transform: ${transform.transform};">${escapeHtml(
                  props.title
                )}</span>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              }),
            });
          }

          // Survey station point marker
          const marker = L.circleMarker(latlng, {
            radius: 4.5,
            fillColor: safeColor(props.color, "#10b981"),
            color: "#1e293b",
            weight: 1.5,
            opacity: userAlpha,
            fillOpacity: userAlpha,
          });

          if (props.title || props.layer) {
            marker.bindTooltip(
              escapeHtml(props.title || `Station (${props.layer})`),
              {
                className: "cad-station-tooltip",
                direction: "top",
                offset: [0, -6],
              }
            );
          }
          return marker;
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const geomType = feature.geometry.type;

          layer.on({
            mouseover: () => {
              if (geomType !== "Point" && (layer as any).setStyle) {
                (layer as any).setStyle({
                  weight: (props["stroke-width"] || 2.5) + 2.5,
                  color: "#38bdf8",
                });
              }

              // Inspect feature
              let lengthMeters: number | undefined;
              let areaM2: number | undefined;
              let vertexCount = 0;

              if (geomType === "LineString") {
                lengthMeters = calculateFeatureLengthMeters(
                  feature.geometry.coordinates
                );
                vertexCount = feature.geometry.coordinates.length;
              } else if (geomType === "Polygon") {
                const ring = feature.geometry.coordinates[0] || [];
                areaM2 = calculatePolygonAreaM2(ring);
                vertexCount = ring.length;
              }

              const info = {
                layer: props.layer || "Default",
                type: props.type === "text" ? "Text Label" : geomType,
                lengthMeters,
                areaM2,
                vertexCount,
                text: props.title,
                textHeight: props.text_height,
                rotation: props.rotation,
                properties: props,
              };
              setInspectedFeature(info);

              if (geomType === "LineString") {
                getGeodesyWorker()
                  .calculateLength(feature.geometry.coordinates)
                  .then(({ lengthMeters: wLen }) => {
                    setInspectedFeature({ ...info, lengthMeters: wLen });
                  })
                  .catch(() => {});
              } else if (geomType === "Polygon") {
                const ring = feature.geometry.coordinates[0] || [];
                getGeodesyWorker()
                  .calculateArea(ring)
                  .then(({ areaM2: wArea }) => {
                    setInspectedFeature({ ...info, areaM2: wArea });
                  })
                  .catch(() => {});
              }
            },
            mouseout: () => {
              if (geomType !== "Point" && (layer as any).setStyle) {
                const layerName = props.layer || "Default";
                const userAlpha =
                  layerOpacity[layerName] !== undefined
                    ? layerOpacity[layerName]
                    : 1.0;
                (layer as any).setStyle({
                  weight: props["stroke-width"] || 2.5,
                  color: safeColor(props.stroke, "#ef4444"),
                  opacity: 0.9 * userAlpha,
                });
              }
              setInspectedFeature(null);
            },
          });
        },
      }
    );

    group.addLayer(geoLayer);

    const bounds = geoLayer.getBounds();
    currentBoundsRef.current = bounds.isValid() ? bounds : null;

    // Only auto-fit map viewport when a brand new GeoJSON dataset is loaded!
    // Layer toggles, opacity changes, and styling changes must NOT violently reset the user viewport.
    const isNewGeoJson = prevGeojsonRef.current !== geojson;
    prevGeojsonRef.current = geojson;

    if (bounds.isValid() && (isNewGeoJson || !hasFittedRef.current)) {
      hasFittedRef.current = true;
      const doFit = () => {
        if (!map) return;
        map.invalidateSize();
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
      };

      doFit();
      requestAnimationFrame(doFit);
      setTimeout(doFit, 150);
      setTimeout(doFit, 400);
    }

    requestAnimationFrame(() => {
      updateLabelsDOM();
    });
  }, [
    mapReady,
    geojson,
    layerVisibility,
    layerOpacity,
    parameters.export_text,
    parameters.export_points,
    parameters.label_scale,
    parameters.fill_polygons,
    parameters.fill_color,
    parameters.fill_opacity,
    labelOrientation,
    medianTextHeight,
    setInspectedFeature,
    updateLabelsDOM,
  ]);

  return (
    <div className="relative w-full h-full min-h-[400px]">
      <div
        ref={mapContainerRef}
        id="map"
        className={`w-full h-full ${
          isSelectingLocation ? "cursor-crosshair" : ""
        }`}
      />
    </div>
  );
}
