import fs from "fs";
import * as flatbuffers from "flatbuffers";

async function run() {
  const fgb = await import("../node_modules/flatgeobuf/dist/esm/flatgeobuf.js");
  const raw = JSON.parse(fs.readFileSync("./frontend/public/data/padamatiyaleru.json", "utf8"));
  const plots = raw.layers.survey_plots;
  const features = plots.features;

  console.log("Total features to index:", features.length);

  // Serialize using fgb.geojson.serialize to get standard features
  // Let's inspect how serialize works internally:
  // fgb has Header, Column, Feature, Geometry, magicbytes, buildHeader, etc.
}

run().catch(console.error);
