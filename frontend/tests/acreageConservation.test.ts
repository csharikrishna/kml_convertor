import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Statutory Cadastral Acreage Conservation & Integrity", () => {
  const datasets = [
    {
      name: "konampalle.json",
      path: path.resolve(__dirname, "../public/data/konampalle.json"),
      expectedCount: 351,
    },
    {
      name: "padamatiyaleru.json",
      path: path.resolve(__dirname, "../public/data/padamatiyaleru.json"),
      expectedCount: 907,
    },
  ];

  for (const ds of datasets) {
    describe(`Dataset: ${ds.name}`, () => {
      let data: any;

      it("loads valid clean JSON without BOM", () => {
        const raw = fs.readFileSync(ds.path, "utf-8");
        // Ensure first byte is NOT a BOM
        expect(raw.charCodeAt(0)).not.toBe(0xfeff);
        data = JSON.parse(raw);
        expect(data.success).toBe(true);
        expect(data.survey_register).toBeDefined();
        expect(data.survey_register.length).toBe(ds.expectedCount);
      });

      it("strictly conserves statutory acreage on every single parcel", () => {
        const raw = fs.readFileSync(ds.path, "utf-8");
        data = JSON.parse(raw);

        const violations: any[] = [];
        for (const parcel of data.survey_register) {
          const tot = parcel.total_acres;
          const acq = parcel.acquired_acres;
          const bal = parcel.balance_acres;

          // Mathematical statutory conservation: Acquired + Balance === Total
          const sum = Math.round((acq + bal) * 100) / 100;
          if (sum !== tot) {
            violations.push({
              survey_no: parcel.survey_no,
              total: tot,
              acquired: acq,
              balance: bal,
              sum,
            });
          }

          // Non-negative areas
          expect(tot).toBeGreaterThanOrEqual(0);
          expect(acq).toBeGreaterThanOrEqual(0);
          expect(bal).toBeGreaterThanOrEqual(0);
        }

        expect(violations).toEqual([]);
      });

      it("strictly conserves metric square meter areas", () => {
        const raw = fs.readFileSync(ds.path, "utf-8");
        data = JSON.parse(raw);

        const violations: any[] = [];
        for (const parcel of data.survey_register) {
          const totM2 = parcel.total_area_m2;
          const acqM2 = parcel.acquired_area_m2;
          const balM2 = parcel.balance_area_m2;

          const sumM2 = Math.round((acqM2 + balM2) * 10) / 10;
          if (sumM2 !== totM2) {
            violations.push({
              survey_no: parcel.survey_no,
              totM2,
              acqM2,
              balM2,
              sumM2,
            });
          }
        }

        expect(violations).toEqual([]);
      });

      it("validates that summary totals match register sum", () => {
        const raw = fs.readFileSync(ds.path, "utf-8");
        data = JSON.parse(raw);

        const reg = data.survey_register;
        const totalSum = Math.round(reg.reduce((acc: number, p: any) => acc + p.total_acres, 0) * 100) / 100;
        const acqSum = Math.round(reg.reduce((acc: number, p: any) => acc + p.acquired_acres, 0) * 100) / 100;
        const balSum = Math.round((totalSum - acqSum) * 100) / 100;

        expect(data.summary.total_area_acres).toBeCloseTo(totalSum, 2);
        expect(data.summary.acquired_area_acres).toBeCloseTo(acqSum, 2);
        expect(data.summary.balance_area_acres).toBeCloseTo(balSum, 2);
      });

      it("verifies GeoJSON coordinates follow [lon, lat] order", () => {
        const raw = fs.readFileSync(ds.path, "utf-8");
        data = JSON.parse(raw);

        const plotsFeats = data.layers?.survey_plots?.features || [];
        expect(plotsFeats.length).toBeGreaterThan(0);

        for (const feat of plotsFeats.slice(0, 20)) {
          let ring: number[][] | null = null;
          if (feat.geometry?.type === "Polygon") {
            ring = feat.geometry.coordinates[0];
          } else if (feat.geometry?.type === "MultiPolygon") {
            ring = feat.geometry.coordinates[0][0];
          }

          if (ring && ring.length > 0) {
            const firstPt = ring[0];
            const lon = firstPt[0];
            const lat = firstPt[1];

            // Anantapur / Andhra Pradesh bounds: lon ~ 76.5 to 78.5, lat ~ 14.0 to 15.5
            expect(lon).toBeGreaterThan(70);
            expect(lon).toBeLessThan(85);
            expect(lat).toBeGreaterThan(10);
            expect(lat).toBeLessThan(20);
          }
        }
      });
    });
  }
});
