/**
 * Client-Side CAD/DWG Preprocessing & Binary Header Validator
 *
 * Inspects AutoCAD DWG binary signatures (AC10xx) and DXF section markers
 * directly in the browser before network transmission to eliminate wasted
 * multi-megabyte uploads on corrupted, truncated, or renamed files.
 */

export interface CadValidationResult {
  isValid: boolean;
  format: "dwg" | "dxf" | "unknown";
  versionString?: string;
  error?: string;
  byteSize: number;
}

const DWG_VERSION_MAP: Record<string, string> = {
  AC1012: "AutoCAD R13",
  AC1014: "AutoCAD R14",
  AC1015: "AutoCAD 2000 / 2002 (R15)",
  AC1018: "AutoCAD 2004 / 2005 / 2006 (R18)",
  AC1021: "AutoCAD 2007 / 2008 / 2009 (R21)",
  AC1024: "AutoCAD 2010 / 2011 / 2012 (R24)",
  AC1027: "AutoCAD 2013 / 2014 / 2015 / 2016 / 2017 (R27)",
  AC1032: "AutoCAD 2018 / 2021 / 2024 (R32)",
};

/**
 * Validates CAD file header using browser File Slice & ArrayBuffer inspection
 */
export async function validateCadFileClientSide(file: File): Promise<CadValidationResult> {
  const byteSize = file.size;
  if (byteSize === 0) {
    return {
      isValid: false,
      format: "unknown",
      byteSize,
      error: "File is completely empty (0 bytes). Please select a valid AutoCAD drawing.",
    };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "";

  try {
    const headerChunk = await file.slice(0, 128).arrayBuffer();
    const bytes = new Uint8Array(headerChunk);

    if (ext === "dwg") {
      // DWG files start with 6-byte ASCII magic header: AC10xx
      if (bytes.length < 6) {
        return {
          isValid: false,
          format: "dwg",
          byteSize,
          error: "DWG file header is truncated (less than 6 bytes).",
        };
      }

      const magic = String.fromCharCode(...bytes.subarray(0, 6));
      if (!magic.startsWith("AC10") && !magic.startsWith("MC0.")) {
        return {
          isValid: false,
          format: "unknown",
          byteSize,
          error: `Invalid AutoCAD DWG signature '${magic}'. The file appears corrupted or is not a native DWG.`,
        };
      }

      const versionString = DWG_VERSION_MAP[magic] || `AutoCAD DWG (Build ${magic})`;
      return {
        isValid: true,
        format: "dwg",
        versionString,
        byteSize,
      };
    } else if (ext === "dxf") {
      // DXF text files contain SECTION or binary DXF marker
      const decoder = new TextDecoder("latin1");
      const textHeader = decoder.decode(bytes).trim();

      const isBinaryDxf = textHeader.startsWith("AutoCAD Binary DXF");
      const isAsciiDxf =
        textHeader.includes("SECTION") ||
        textHeader.includes("HEADER") ||
        textHeader.includes("0\r\nSECTION") ||
        textHeader.includes("0\nSECTION");

      if (!isBinaryDxf && !isAsciiDxf) {
        return {
          isValid: false,
          format: "unknown",
          byteSize,
          error: "Invalid DXF file structure. Missing standard AutoCAD SECTION header.",
        };
      }

      return {
        isValid: true,
        format: "dxf",
        versionString: isBinaryDxf ? "AutoCAD Binary DXF" : "AutoCAD Standard ASCII DXF",
        byteSize,
      };
    }

    return {
      isValid: false,
      format: "unknown",
      byteSize,
      error: `Unsupported file extension .${ext}. Only .dwg and .dxf are accepted.`,
    };
  } catch (err: any) {
    return {
      isValid: false,
      format: "unknown",
      byteSize,
      error: `Could not read file header: ${err?.message || "File access exception"}`,
    };
  }
}
