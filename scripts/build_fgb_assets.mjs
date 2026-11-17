/**
 * FlatGeobuf Production Asset Generator with Packed R-Tree Spatial Index
 * Encodes all 907 village parcels for Padamatiyaleru and 351 parcels for Konampalle
 * into binary FlatGeobuf (.fgb) format with Hilbert/spatial R-Tree indices
 * for viewport streaming and byte-range request acceleration.
 */

import fs from "fs";
import * as flatbuffers from "flatbuffers";

function calcTreeSize(numItems, nodeSize = 16) {
  let n = numItems, numNodes = n;
  do {
    n = Math.ceil(n / nodeSize);
    numNodes += n;
  } while (n !== 1);
  return numNodes * 40;
}

function generateLevelBounds(numItems, nodeSize = 16) {
  let n = numItems, numNodes = n, levelNumNodes = [n];
  do {
    n = Math.ceil(n / nodeSize);
    numNodes += n;
    levelNumNodes.push(n);
  } while (n !== 1);
  let levelOffsets = [];
  n = numNodes;
  for (let size of levelNumNodes) {
    levelOffsets.push(n - size);
    n -= size;
  }
  let levelBounds = [];
  for (let i = 0; i < levelNumNodes.length; i++) {
    levelBounds.push([levelOffsets[i], levelOffsets[i] + levelNumNodes[i]]);
  }
  return levelBounds;
}

function getFeatureBBox(geometry) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visitCoord = ([x, y]) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  const visitCoords = (coords) => {
    if (typeof coords[0] === "number") {
      visitCoord(coords);
    } else {
      for (const c of coords) visitCoords(c);
    }
  };
  visitCoords(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

export async function buildIndexedFgb(geojsonFeatures, crsCode = 0) {
  const fgb = await import("../node_modules/flatgeobuf/dist/esm/flatgeobuf.js");
  const nodeSize = 16;
  const numItems = geojsonFeatures.length;

  // 1. Spatially sort features by centroid along primary spatial axis
  const items = geojsonFeatures.map((f, i) => {
    const bbox = getFeatureBBox(f.geometry);
    const centerX = (bbox[0] + bbox[2]) / 2;
    const centerY = (bbox[1] + bbox[3]) / 2;
    return { feature: f, bbox, centerX, centerY, origIndex: i };
  });

  items.sort((a, b) => a.centerX - b.centerX || a.centerY - b.centerY);

  // 2. Serialize features to binary stream
  const sortedGeoJson = {
    type: "FeatureCollection",
    features: items.map((it) => it.feature),
  };

  const rawFgb = fgb.geojson.serialize(sortedGeoJson, crsCode);
  const headerLength = new DataView(rawFgb.buffer, rawFgb.byteOffset).getUint32(8, true);
  const featuresOffset = 12 + headerLength;
  const featuresData = rawFgb.subarray(featuresOffset);

  // Parse feature offsets in featuresData
  const featureOffsets = [];
  let curOffset = 0;
  while (curOffset < featuresData.length) {
    featureOffsets.push(curOffset);
    const featLen = new DataView(featuresData.buffer, featuresData.byteOffset + curOffset).getUint32(0, true);
    curOffset += 4 + featLen;
  }

  // 3. Build Packed R-Tree
  const treeSize = calcTreeSize(numItems, nodeSize);
  const treeBuffer = new ArrayBuffer(treeSize);
  const treeDV = new DataView(treeBuffer);

  const levelBounds = generateLevelBounds(numItems, nodeSize);
  const [leafStart] = levelBounds[0];

  // Leaf nodes (Level 0)
  for (let i = 0; i < numItems; i++) {
    const nodeIdx = leafStart + i;
    const byteStart = nodeIdx * 40;
    const bbox = items[i].bbox;
    const featOffset = featureOffsets[i];

    treeDV.setFloat64(byteStart + 0, bbox[0], true);
    treeDV.setFloat64(byteStart + 8, bbox[1], true);
    treeDV.setFloat64(byteStart + 16, bbox[2], true);
    treeDV.setFloat64(byteStart + 24, bbox[3], true);
    treeDV.setBigUint64(byteStart + 32, BigInt(featOffset), true);
  }

  // Upper levels (Level 1 to root)
  for (let level = 1; level < levelBounds.length; level++) {
    const [curStart, curEnd] = levelBounds[level];
    const [childStart, childEnd] = levelBounds[level - 1];

    for (let i = curStart; i < curEnd; i++) {
      const byteStart = i * 40;
      const childIdx = childStart + (i - curStart) * nodeSize;
      const numChildren = Math.min(nodeSize, childEnd - childIdx);

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let c = 0; c < numChildren; c++) {
        const cByteStart = (childIdx + c) * 40;
        const cMinX = treeDV.getFloat64(cByteStart + 0, true);
        const cMinY = treeDV.getFloat64(cByteStart + 8, true);
        const cMaxX = treeDV.getFloat64(cByteStart + 16, true);
        const cMaxY = treeDV.getFloat64(cByteStart + 24, true);
        if (cMinX < minX) minX = cMinX;
        if (cMinY < minY) minY = cMinY;
        if (cMaxX > maxX) maxX = cMaxX;
        if (cMaxY > maxY) maxY = cMaxY;
      }

      treeDV.setFloat64(byteStart + 0, minX, true);
      treeDV.setFloat64(byteStart + 8, minY, true);
      treeDV.setFloat64(byteStart + 16, maxX, true);
      treeDV.setFloat64(byteStart + 24, maxY, true);
      treeDV.setBigUint64(byteStart + 32, BigInt(childIdx), true);
    }
  }

  // 4. Update Header indexNodeSize to 16
  const origHeaderBytes = new Uint8Array(rawFgb.subarray(8, 12 + headerLength));
  const headerBuf = new Uint8Array(origHeaderBytes);
  const rootTablePos = 4 + new DataView(headerBuf.buffer, headerBuf.byteOffset).getInt32(4, true);
  const vtableOffset = new DataView(headerBuf.buffer, headerBuf.byteOffset).getInt32(rootTablePos, true);
  const vtablePos = rootTablePos - vtableOffset;
  const vtableSize = new DataView(headerBuf.buffer, headerBuf.byteOffset).getUint16(vtablePos, true);

  if (vtableSize > 22) {
    const fieldOffset = new DataView(headerBuf.buffer, headerBuf.byteOffset).getUint16(vtablePos + 22, true);
    if (fieldOffset > 0) {
      new DataView(headerBuf.buffer, headerBuf.byteOffset).setUint16(rootTablePos + fieldOffset, 16, true);
    }
  }

  // Assemble full indexed FGB
  const totalLength = 8 + headerBuf.length + treeSize + featuresData.length;
  const finalFgb = new Uint8Array(totalLength);
  finalFgb.set(rawFgb.subarray(0, 8), 0);
  finalFgb.set(headerBuf, 8);
  finalFgb.set(new Uint8Array(treeBuffer), 8 + headerBuf.length);
  finalFgb.set(featuresData, 8 + headerBuf.length + treeSize);

  return finalFgb;
}

async function buildAll() {
  console.log("Generating FlatGeobuf production assets with Packed R-Trees...");

  const files = [
    {
      in: "./frontend/public/data/padamatiyaleru.json",
      out: "./frontend/public/data/padamatiyaleru_plots.fgb",
      name: "Padamatiyaleru",
    },
    {
      in: "./frontend/public/data/konampalle.json",
      out: "./frontend/public/data/konampalle_plots.fgb",
      name: "Konampalle",
    },
  ];

  for (const item of files) {
    const raw = JSON.parse(fs.readFileSync(item.in, "utf8"));
    const plots = raw.layers.survey_plots;
    console.log(`Processing ${item.name}: ${plots.features.length} parcels...`);

    const fgbBytes = await buildIndexedFgb(plots.features);
    fs.writeFileSync(item.out, Buffer.from(fgbBytes));
    console.log(`Successfully generated ${item.out} (${fgbBytes.length} bytes)`);
  }
}

buildAll().catch((err) => {
  console.error("Asset generation error:", err);
  process.exit(1);
});
