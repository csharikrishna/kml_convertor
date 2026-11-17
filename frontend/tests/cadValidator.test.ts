import { describe, it, expect } from "vitest";
import { validateCadFileClientSide } from "@/lib/gis/cadValidator";

describe("Client-Side CAD Validator & Header Inspector", () => {
  it("validates AutoCAD DWG AC1032 (2018/2021/2024) binary headers", async () => {
    // Construct fake DWG file starting with AC1032
    const header = new TextEncoder().encode("AC1032\x00\x00\x00\x00extra data for dwg testing");
    const file = new File([header], "village_survey.dwg", { type: "application/acad" });

    const result = await validateCadFileClientSide(file);
    expect(result.isValid).toBe(true);
    expect(result.format).toBe("dwg");
    expect(result.versionString).toContain("AutoCAD 2018");
  });

  it("validates AutoCAD DWG AC1015 (AutoCAD 2000) binary headers", async () => {
    const header = new TextEncoder().encode("AC1015\x00\x00\x00\x00sample drawing payload");
    const file = new File([header], "canal_route.dwg", { type: "application/acad" });

    const result = await validateCadFileClientSide(file);
    expect(result.isValid).toBe(true);
    expect(result.format).toBe("dwg");
    expect(result.versionString).toContain("AutoCAD 2000");
  });

  it("rejects corrupted or non-DWG files disguised with a .dwg extension", async () => {
    // E.g. HTML error page or text document saved as .dwg
    const htmlData = new TextEncoder().encode("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>");
    const fakeDwg = new File([htmlData], "bad_file.dwg", { type: "application/acad" });

    const result = await validateCadFileClientSide(fakeDwg);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("Invalid AutoCAD DWG signature");
  });

  it("validates ASCII DXF files with standard SECTION headers", async () => {
    const dxfContent = "  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1027\n  0\nENDSEC\n  0\nEOF";
    const file = new File([new TextEncoder().encode(dxfContent)], "parcels.dxf", { type: "application/dxf" });

    const result = await validateCadFileClientSide(file);
    expect(result.isValid).toBe(true);
    expect(result.format).toBe("dxf");
    expect(result.versionString).toContain("ASCII DXF");
  });

  it("rejects empty 0-byte files with descriptive message", async () => {
    const emptyFile = new File([], "empty.dwg");
    const result = await validateCadFileClientSide(emptyFile);
    expect(result.isValid).toBe(false);
    expect(result.error).toContain("empty");
  });
});
