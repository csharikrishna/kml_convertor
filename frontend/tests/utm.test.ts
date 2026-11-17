import { describe, it, expect } from "vitest";
import { calculateUtmZone, latLonToUtm } from "../src/lib/gis/utm";

describe("UTM & Transverse Mercator Math", () => {
  it("determines correct UTM zones across India, Europe and US", () => {
    // Kurnool / Andhra Pradesh, India (~ 15.8281, 78.0373) -> Zone 44 Northern
    const ap = calculateUtmZone(15.8281, 78.0373);
    expect(ap.zone).toBe(44);
    expect(ap.isNorthern).toBe(true);
    expect(ap.epsg).toBe("EPSG:32644");

    // Mumbai (~ 18.922, 72.834) -> Zone 43 Northern
    const mumbai = calculateUtmZone(18.922, 72.834);
    expect(mumbai.zone).toBe(43);
    expect(mumbai.epsg).toBe("EPSG:32643");

    // Sydney, Australia (~ -33.8688, 151.2093) -> Zone 56 Southern
    const sydney = calculateUtmZone(-33.8688, 151.2093);
    expect(sydney.zone).toBe(56);
    expect(sydney.isNorthern).toBe(false);
    expect(sydney.epsg).toBe("EPSG:32756");
  });

  it("handles irregular Norway and Svalbard zones", () => {
    // South-west Norway (lat 60, lon 5) -> Zone 32
    const norway = calculateUtmZone(60.0, 5.0);
    expect(norway.zone).toBe(32);

    // Svalbard (lat 78, lon 15) -> Zone 33
    const svalbard = calculateUtmZone(78.0, 15.0);
    expect(svalbard.zone).toBe(33);
  });

  it("calculates accurate Easting and Northing meters", () => {
    const utm = latLonToUtm(15.8281, 78.0373, 44, true);
    // Easting should be near central meridian (~ 500,000m false easting)
    expect(utm.easting).toBeGreaterThan(100000);
    expect(utm.easting).toBeLessThan(900000);
    // Northing around 15.8 deg ~ 15.8 * 111,000 ~ 1,750,000 m
    expect(utm.northing).toBeGreaterThan(1700000);
    expect(utm.northing).toBeLessThan(1800000);
  });
});
