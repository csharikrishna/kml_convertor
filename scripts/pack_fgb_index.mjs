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

async function buildIndexedFgb(geojsonFeatures, crsCode = 0) {
  const fgb = await import("../node_modules/flatgeobuf/dist/esm/flatgeobuf.js");
  const nodeSize = 16;
  const numItems = geojsonFeatures.length;

  // 1. Sort features by centroid (Hilbert / spatial sorting for R-Tree clustering)
  const items = geojsonFeatures.map((f, i) => {
    const bbox = getFeatureBBox(f.geometry);
    const centerX = (bbox[0] + bbox[2]) / 2;
    const centerY = (bbox[1] + bbox[3]) / 2;
    return { feature: f, bbox, centerX, centerY, origIndex: i };
  });

  // Spatial sort along primary axis
  items.sort((a, b) => a.centerX - b.centerX || a.centerY - b.centerY);

  // 2. Build feature buffers
  // We can use fgb's internal feature serialization by passing single feature arrays or using generic serialize
  const sortedGeoJson = {
    type: "FeatureCollection",
    features: items.map(it => it.feature)
  };

  const rawFgb = fgb.geojson.serialize(sortedGeoJson, crsCode);

  // In rawFgb:
  // magicbytes: 8 bytes
  // headerLength: 4 bytes LE uint32 at offset 8
  const headerLength = new DataView(rawFgb.buffer, rawFgb.byteOffset).getUint32(8, true);
  const headerOffset = 12;
  const featuresOffset = 12 + headerLength;
  const featuresData = rawFgb.subarray(featuresOffset);

  // Let's parse feature lengths and offsets in featuresData
  const featureOffsets = [];
  let curOffset = 0;
  while (curOffset < featuresData.length) {
    featureOffsets.push(curOffset);
    const featLen = new DataView(featuresData.buffer, featuresData.byteOffset + curOffset).getUint32(0, true);
    curOffset += 4 + featLen;
  }

  // 3. Rebuild Header with indexNodeSize = 16
  const bb = new flatbuffers.ByteBuffer(rawFgb.subarray(8, 12 + headerLength));
  // Let's find indexNodeSize offset in header
  // Header in flatbuffers: offset 22 is field 9 (indexNodeSize)
  // Let's check Header.addIndexNodeSize
  const origHeaderBytes = new Uint8Array(rawFgb.subarray(8, 12 + headerLength));
  
  // 4. Build Packed R-Tree
  const treeSize = calcTreeSize(numItems, nodeSize);
  const totalNumNodes = treeSize / 40;
  const treeBuffer = new ArrayBuffer(treeSize);
  const treeDV = new DataView(treeBuffer);

  const levelBounds = generateLevelBounds(numItems, nodeSize);
  const [leafStart, leafEnd] = levelBounds[0];

  // Populate leaf nodes (Level 0)
  for (let i = 0; i < numItems; i++) {
    const nodeIdx = leafStart + i;
    const byteStart = nodeIdx * 40;
    const bbox = items[i].bbox;
    const featOffset = featureOffsets[i];

    treeDV.setFloat64(byteStart + 0, bbox[0], true); // minX
    treeDV.setFloat64(byteStart + 8, bbox[1], true); // minY
    treeDV.setFloat64(byteStart + 16, bbox[2], true); // maxX
    treeDV.setFloat64(byteStart + 24, bbox[3], true); // maxY
    treeDV.setBigUint64(byteStart + 32, BigInt(featOffset), true);
  }

  // Populate upper levels (Level 1 to root)
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

  // Create new header with indexNodeSize = 16
  // We can use the FlatBuffers builder to create header with indexNodeSize = 16
  const builder = new flatbuffers.Builder();
  // Read existing columns from header
  const headerObj = fgb.generic.readMetadata ? null : null;
  // Let's inspect the raw header to set indexNodeSize
  // In flatbuffers: Header vtable offset for indexNodeSize is field 9.
  // Let's modify the indexNodeSize in the serialized header:
  const headerBuf = new Uint8Array(origHeaderBytes);
  // In flatbuffers size-prefixed buffer:
  // offset 0..3: headerLength (uint32)
  // offset 4: root table offset (soffset32)
  const rootTablePos = 4 + new DataView(headerBuf.buffer, headerBuf.byteOffset).getInt32(4, true);
  const vtableOffset = new DataView(headerBuf.buffer, headerBuf.byteOffset).getInt32(rootTablePos, true);
  const vtablePos = rootTablePos - vtableOffset;
  const vtableSize = new DataView(headerBuf.buffer, headerBuf.byteOffset).getUint16(vtablePos, true);
  
  // Field 9 in Header: field index 9 -> vtable offset is 4 + 2*9 = 22
  let modifiedHeaderBuf = headerBuf;
  if (vtableSize > 22) {
    const fieldOffset = new DataView(headerBuf.buffer, headerBuf.byteOffset).getUint16(vtablePos + 22, true);
    if (fieldOffset > 0) {
      new DataView(headerBuf.buffer, headerBuf.byteOffset).setUint16(rootTablePos + fieldOffset, 16, true);
    }
  }

  // Assemble full indexed FGB:
  // magicbytes (8) + header (modifiedHeaderBuf: 4 + len) + index (treeSize) + features (featuresData.length)
  const totalLength = 8 + modifiedHeaderBuf.length + treeSize + featuresData.length;
  const finalFgb = new Uint8Array(totalLength);
  finalFgb.set(rawFgb.subarray(0, 8), 0); // magicbytes
  finalFgb.set(modifiedHeaderBuf, 8); // header (including 4-byte length prefix)
  finalFgb.set(new Uint8Array(treeBuffer), 8 + modifiedHeaderBuf.length); // Packed R-Tree index
  finalFgb.set(featuresData, 8 + modifiedHeaderBuf.length + treeSize); // features

  return finalFgb;
}

// Test script
async function test() {
  const raw = JSON.parse(fs.readFileSync("./frontend/public/data/padamatiyaleru.json", "utf8"));
  const plots = raw.layers.survey_plots;
  console.log("Building indexed FGB for", plots.features.length, "parcels...");

  const indexedFgb = await buildIndexedFgb(plots.features);
  console.log("Built indexed FGB! Total size:", indexedFgb.length, "bytes");

  const fgb = await import("../node_modules/flatgeobuf/dist/esm/flatgeobuf.js");
  const reader = fgb.geojson.deserialize(indexedFgb, {
    rect: { minX: 77.276, minY: 14.65, maxX: 77.300, maxY: 14.68 }
  });

  const matched = [];
  for await (const feat of reader) {
    matched.push(feat);
  }

  console.log("Spatial query returned:", matched.length, "parcels out of", plots.features.length);
}

test().catch(console.error);
