/**
 * KML Generation Engine for Cadastral GIS & Google Earth
 * Creates styled 3D KML files with extruded polygons, landowner data balloons,
 * and canal alignment corridors compatible with Google Earth Web & Google Earth Pro.
 */

import { SurveyPlotRecord, CadastralProjectData } from "@/stores/useCadastralStore";

export function downloadKmlBlob(kmlContent: string, filename: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([kmlContent], { type: "application/vnd.google-earth.kml+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".kml") ? filename : `${filename}.kml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function coordinatesToKmlString(coords: [number, number][]): string {
  // KML requires: lng,lat,altitude
  return coords
    .map(([lng, lat]) => `${lng.toFixed(7)},${lat.toFixed(7)},0`)
    .join(" ");
}

/**
 * Ensures a LinearRing is strictly closed (first point equals last point) per OGC KML 2.2 spec.
 */
function ensureClosedRing(coords: [number, number][]): [number, number][] {
  if (!coords || coords.length === 0) return coords;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return [...coords, [first[0], first[1]]];
  }
  return coords;
}

/**
 * Builds OGC KML 2.2 Polygon XML with strict outer ring and inner rings (holes) support.
 * Complies with OGC KML 2.2 schema (Polygon does not accept tessellate element).
 */
function polygonToKmlGeometryXml(rings: [number, number][][]): string {
  if (!rings || rings.length === 0) return "";
  const outer = ensureClosedRing(rings[0]);
  const holes = rings.slice(1);

  let holesXml = "";
  for (const hole of holes) {
    if (hole && hole.length >= 3) {
      const closedHole = ensureClosedRing(hole);
      holesXml += `
        <innerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinatesToKmlString(closedHole)}</coordinates>
          </LinearRing>
        </innerBoundaryIs>`;
    }
  }

  return `
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinatesToKmlString(outer)}</coordinates>
          </LinearRing>
        </outerBoundaryIs>${holesXml}
      </Polygon>`;
}

export function generatePlotKml(
  plot: SurveyPlotRecord,
  projectData?: CadastralProjectData | null
): string {
  // Find feature geometry in survey_plots GeoJSON
  // Each element in polyRingsList is an array of rings: [outerRing, ...holeRings]
  let polyRingsList: [number, number][][][] = [];

  if (projectData?.layers?.survey_plots?.features) {
    const feature = projectData.layers.survey_plots.features.find(
      (f: any) => String(f.properties?.survey_no) === String(plot.survey_no)
    );
    if (feature?.geometry) {
      if (feature.geometry.type === "Polygon") {
        polyRingsList.push(feature.geometry.coordinates);
      } else if (feature.geometry.type === "MultiPolygon") {
        feature.geometry.coordinates.forEach((polyRings: any) => {
          if (polyRings && polyRings.length > 0) polyRingsList.push(polyRings);
        });
      }
    }
  }

  // Fallback to plot bounds if geometry not found
  if (polyRingsList.length === 0 && plot.bounds) {
    const [[minLat, minLng], [maxLat, maxLng]] = plot.bounds;
    polyRingsList.push([[
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ]]);
  }

  const centerLat = plot.center?.[0] ?? (plot.bounds ? (plot.bounds[0][0] + plot.bounds[1][0]) / 2 : 14.68);
  const centerLng = plot.center?.[1] ?? (plot.bounds ? (plot.bounds[0][1] + plot.bounds[1][1]) / 2 : 77.28);

  const isAffected = Boolean(plot.canal_passing);
  const title = `Survey Plot ${plot.survey_no} - ${plot.village || "Village"}`;

  const descriptionHtml = `<![CDATA[
    <div style="font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; max-width: 320px; line-height: 1.5;">
      <h3 style="margin: 0 0 8px 0; color: #0f172a; border-bottom: 2px solid ${isAffected ? '#ef4444' : '#3b82f6'}; padding-bottom: 4px;">
        Survey No: ${plot.survey_no}
        ${isAffected ? '<span style="background: #fee2e2; color: #b91c1c; font-size: 11px; padding: 2px 6px; border-radius: 4px; margin-left: 6px;">CANAL ACQUISITION</span>' : ''}
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
        <tr><td style="color: #64748b; padding: 2px 0;">Village:</td><td style="font-weight: bold;">${plot.village || "N/A"}</td></tr>
        <tr><td style="color: #64748b; padding: 2px 0;">Mandal:</td><td>${plot.mandal || "Beluguppa"}</td></tr>
        <tr><td style="color: #64748b; padding: 2px 0;">District:</td><td>${plot.district || "Anantapur"}</td></tr>
        <tr><td style="color: #64748b; padding: 2px 0;">Classification:</td><td>${plot.land_nature || plot.land_type || "Ryotwari Patta"}</td></tr>
        <tr><td style="color: #64748b; padding: 2px 0;">Pattadar / Owner:</td><td style="font-weight: bold; color: #1e40af;">${plot.pattadar_name || "Record not linked"}</td></tr>
        <tr><td style="color: #64748b; padding: 2px 0;">Khata No:</td><td>${plot.khata_no || "N/A"}</td></tr>
        <tr style="border-top: 1px solid #e2e8f0;"><td style="color: #64748b; padding: 4px 0 2px 0;">Total Area:</td><td style="font-weight: bold;">${plot.total_acres} Ac (${plot.total_ac_cts || ''})</td></tr>
        ${isAffected ? `
          <tr><td style="color: #dc2626; padding: 2px 0;">Acquired for Canal:</td><td style="font-weight: bold; color: #dc2626;">${plot.acquired_acres} Ac</td></tr>
          <tr><td style="color: #16a34a; padding: 2px 0;">Balance Retained:</td><td style="font-weight: bold; color: #16a34a;">${plot.balance_acres} Ac</td></tr>
          <tr><td style="color: #64748b; padding: 2px 0;">Canal Chainage:</td><td>${plot.chainage_range || 'N/A'}</td></tr>
        ` : ''}
      </table>
      <div style="margin-top: 8px; font-size: 10px; color: #94a3b8; text-align: right;">
        Generated by CAD2KML Cadastral GIS Workstation
      </div>
    </div>
  ]]>`;

  let polygonsXml = "";
  polyRingsList.forEach((rings, idx) => {
    polygonsXml += `
    <Placemark>
      <name>Survey Plot ${plot.survey_no}${polyRingsList.length > 1 ? ` (Part ${idx + 1})` : ''}</name>
      <description>${descriptionHtml}</description>
      <styleUrl>#plotStyle_${isAffected ? 'affected' : 'normal'}</styleUrl>
      ${polygonToKmlGeometryXml(rings)}
    </Placemark>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${title}</name>
    <open>1</open>
    <Style id="plotStyle_normal">
      <LineStyle>
        <color>ff00d7ff</color>
        <width>3.5</width>
      </LineStyle>
      <PolyStyle>
        <color>40ff7800</color>
      </PolyStyle>
    </Style>
    <Style id="plotStyle_affected">
      <LineStyle>
        <color>ff0000ff</color>
        <width>4.0</width>
      </LineStyle>
      <PolyStyle>
        <color>600000ff</color>
      </PolyStyle>
    </Style>
    <Style id="centerPin">
      <IconStyle>
        <scale>1.1</scale>
        <Icon>
          <href>http://maps.google.com/mapfiles/kml/paddle/${isAffected ? 'red-circle' : 'blu-circle'}.png</href>
        </Icon>
      </IconStyle>
    </Style>
    <Placemark>
      <name>Sy. No. ${plot.survey_no}</name>
      <description>${descriptionHtml}</description>
      <styleUrl>#centerPin</styleUrl>
      <Point>
        <coordinates>${centerLng.toFixed(7)},${centerLat.toFixed(7)},0</coordinates>
      </Point>
    </Placemark>
    ${polygonsXml}
  </Document>
</kml>`;
}

export function generateProjectKml(projectData: CadastralProjectData): string {
  const plots = projectData.layers?.survey_plots?.features || [];
  const canal = projectData.layers?.canal_alignment?.features || [];
  const buffer = projectData.layers?.canal_buffer?.features || [];

  let plotsXml = "";
  plots.forEach((feat: any) => {
    const p = feat.properties || {};
    const ringsList: [number, number][][][] = [];
    if (feat.geometry?.type === "Polygon") {
      ringsList.push(feat.geometry.coordinates);
    } else if (feat.geometry?.type === "MultiPolygon") {
      feat.geometry.coordinates.forEach((polyRings: any) => {
        if (polyRings && polyRings.length > 0) ringsList.push(polyRings);
      });
    }

    const isAff = Boolean(p.canal_passing);
    ringsList.forEach((rings) => {
      plotsXml += `
      <Placemark>
        <name>Sy ${p.survey_no || ''}</name>
        <description><![CDATA[
          <b>Survey No:</b> ${p.survey_no}<br/>
          <b>Village:</b> ${p.village || projectData.village}<br/>
          <b>Total Area:</b> ${p.total_acres || ''} Ac<br/>
          ${isAff ? `<b style="color:red">Acquired: ${p.acquired_acres || ''} Ac</b><br/>` : ''}
          <b>Pattadar:</b> ${p.pattadar_name || 'N/A'}
        ]]></description>
        <styleUrl>#${isAff ? 'style_affected' : 'style_plot'}</styleUrl>
        ${polygonToKmlGeometryXml(rings)}
      </Placemark>`;
    });
  });

  let canalXml = "";
  canal.forEach((feat: any) => {
    if (feat.geometry?.type === "LineString") {
      canalXml += `
      <Placemark>
        <name>Canal Alignment Centerline</name>
        <styleUrl>#style_canal_line</styleUrl>
        <LineString>
          <tessellate>1</tessellate>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coordinatesToKmlString(feat.geometry.coordinates)}</coordinates>
        </LineString>
      </Placemark>`;
    }
  });

  let bufferXml = "";
  buffer.forEach((feat: any) => {
    if (feat.geometry?.type === "Polygon") {
      bufferXml += `
      <Placemark>
        <name>Canal Proposed RoW Corridor</name>
        <styleUrl>#style_buffer</styleUrl>
        ${polygonToKmlGeometryXml(feat.geometry.coordinates)}
      </Placemark>`;
    }
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${projectData.title || projectData.village + " Village Cadastral Map"}</name>
    <open>1</open>
    <Style id="style_plot">
      <LineStyle><color>ff00d7ff</color><width>2</width></LineStyle>
      <PolyStyle><color>25ffffff</color></PolyStyle>
    </Style>
    <Style id="style_affected">
      <LineStyle><color>ff0000ff</color><width>3</width></LineStyle>
      <PolyStyle><color>400000ff</color></PolyStyle>
    </Style>
    <Style id="style_canal_line">
      <LineStyle><color>ff0000ff</color><width>5</width></LineStyle>
    </Style>
    <Style id="style_buffer">
      <LineStyle><color>ff00a5ff</color><width>2</width></LineStyle>
      <PolyStyle><color>3000a5ff</color></PolyStyle>
    </Style>
    <Folder>
      <name>Canal Infrastructure</name>
      ${canalXml}
      ${bufferXml}
    </Folder>
    <Folder>
      <name>Survey Plots</name>
      ${plotsXml}
    </Folder>
  </Document>
</kml>`;
}
