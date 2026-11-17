"""Parser for Cadastral Survey Land Schedules, Pattadar Registers, and Engineering Coordinate Excel Sheets."""

from __future__ import annotations

import csv
import io
import math
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

try:
    import openpyxl
except ImportError:
    openpyxl = None


def normalize_survey_no(val: Any) -> str:
    """Normalize survey number string (e.g. ' 168 / 1 ' -> '168/1')."""
    if val is None:
        return ""
    s = str(val).strip()
    s = re.sub(r"\.0$", "", s)
    s = re.sub(r"\s+", " ", s)
    return s


def parse_cadastral_excel_or_csv(file_path: Path | str) -> Dict[str, Any]:
    """Parse an uploaded Land Plan Schedule or Coordinate Excel/CSV file."""
    p = Path(file_path)
    if not p.is_file():
        raise FileNotFoundError(f"File not found: {p}")

    suffix = p.suffix.lower()
    if suffix in (".xlsx", ".xlsm", ".xltx", ".xltm"):
        return _parse_excel(p)
    elif suffix == ".csv":
        return _parse_csv(p)
    else:
        logger.warning("Unsupported schedule file extension: {}", suffix)
        return {"survey_records": {}, "extra_structures": [], "extra_chainages": []}


def _parse_excel(file_path: Path) -> Dict[str, Any]:
    if openpyxl is None:
        logger.warning("openpyxl not installed; skipping Excel parsing")
        return {"survey_records": {}, "extra_structures": [], "extra_chainages": []}

    try:
        wb = openpyxl.load_workbook(file_path, data_only=True)
    except Exception as ex:
        logger.warning("Failed to open workbook {}: {}", file_path.name, ex)
        return {"survey_records": {}, "extra_structures": [], "extra_chainages": []}

    survey_records: Dict[str, Dict[str, Any]] = {}
    extra_structures: List[Dict[str, Any]] = []
    extra_chainages: List[Dict[str, Any]] = []

    for sheet_name in wb.sheetnames:
        sheet = wb[sheet_name]
        if sheet.max_row < 2:
            continue

        # Look for headers in first 20 rows
        header_map: Dict[str, int] = {}
        header_row_idx = None

        for r in range(1, min(25, sheet.max_row + 1)):
            row_vals = [
                str(sheet.cell(row=r, column=c).value or "").strip()
                for c in range(1, min(35, sheet.max_column + 1))
            ]
            temp_map: Dict[str, int] = {}
            for col_idx, cell_text in enumerate(row_vals, start=1):
                txt = cell_text.lower()
                if any(k in txt for k in ["survey", "sy.", "sy no", "s.no", "plot no", "survey_no"]):
                    if "survey" not in temp_map:
                        temp_map["survey"] = col_idx
                elif any(k in txt for k in ["pattadar", "owner", "holder", "farmer", "name of"]):
                    if "owner" not in temp_map:
                        temp_map["owner"] = col_idx
                elif any(k in txt for k in ["khata", "passbook", "account"]):
                    if "khata" not in temp_map:
                        temp_map["khata"] = col_idx
                elif any(k in txt for k in ["nature", "classification", "type of land", "land_type"]):
                    if "land_type" not in temp_map:
                        temp_map["land_type"] = col_idx
                elif any(k in txt for k in ["structure", "cross drainage", "cd work"]):
                    if "structure" not in temp_map:
                        temp_map["structure"] = col_idx
                elif any(k in txt for k in ["chainage"]):
                    if "chainage" not in temp_map:
                        temp_map["chainage"] = col_idx
                elif any(k in txt for k in ["easting", "utm (x)", "utm x", "x (m)", "x_coord"]):
                    if "easting" not in temp_map:
                        temp_map["easting"] = col_idx
                elif any(k in txt for k in ["northing", "utm (y)", "utm y", "y (m)", "y_coord"]):
                    if "northing" not in temp_map:
                        temp_map["northing"] = col_idx
                elif any(k in txt for k in ["latitude", "lat"]):
                    if "lat" not in temp_map:
                        temp_map["lat"] = col_idx
                elif any(k in txt for k in ["longitude", "long", "lon"]):
                    if "lon" not in temp_map:
                        temp_map["lon"] = col_idx

            if "survey" in temp_map or ("structure" in temp_map and ("easting" in temp_map or "northing" in temp_map or "chainage" in temp_map)):
                header_map = temp_map
                header_row_idx = r
                break

        if not header_map or header_row_idx is None:
            continue

        # Extract data rows
        for r in range(header_row_idx + 1, sheet.max_row + 1):
            # 1. Survey Land Record Extraction
            if "survey" in header_map:
                s_val = sheet.cell(row=r, column=header_map["survey"]).value
                s_no = normalize_survey_no(s_val)
                if s_no and s_no != "None":
                    owner_val = (
                        str(sheet.cell(row=r, column=header_map["owner"]).value or "").strip()
                        if "owner" in header_map
                        else ""
                    )
                    khata_val = (
                        str(sheet.cell(row=r, column=header_map["khata"]).value or "").strip()
                        if "khata" in header_map
                        else ""
                    )
                    ltype_val = (
                        str(sheet.cell(row=r, column=header_map["land_type"]).value or "").strip()
                        if "land_type" in header_map
                        else ""
                    )

                    rec = {
                        "pattadar_name": owner_val,
                        "khata_no": khata_val,
                        "land_nature": ltype_val,
                        "sheet_source": sheet_name,
                    }
                    survey_records[s_no] = rec

            # 2. Engineering Structure & Coordinate Extraction
            if "structure" in header_map:
                struct_val = sheet.cell(row=r, column=header_map["structure"]).value
                if struct_val and str(struct_val).strip() and str(struct_val).strip() != "None":
                    st_title = str(struct_val).strip()
                    ch_val = str(sheet.cell(row=r, column=header_map["chainage"]).value or "").strip() if "chainage" in header_map else ""
                    east_val = sheet.cell(row=r, column=header_map["easting"]).value if "easting" in header_map else None
                    north_val = sheet.cell(row=r, column=header_map["northing"]).value if "northing" in header_map else None

                    try:
                        x = float(east_val) if east_val is not None else None
                        y = float(north_val) if north_val is not None else None
                    except (ValueError, TypeError):
                        x, y = None, None

                    if st_title and (x is not None or ch_val):
                        extra_structures.append({
                            "title": st_title,
                            "chainage": ch_val,
                            "x": x,
                            "y": y,
                        })

    logger.info(
        "Parsed schedule Excel {}: {} survey records, {} structures",
        file_path.name,
        len(survey_records),
        len(extra_structures),
    )
    return {
        "survey_records": survey_records,
        "extra_structures": extra_structures,
        "extra_chainages": extra_chainages,
    }


def _parse_csv(file_path: Path) -> Dict[str, Any]:
    survey_records: Dict[str, Dict[str, Any]] = {}
    extra_structures: List[Dict[str, Any]] = []

    try:
        with open(file_path, "r", encoding="utf-8-sig", errors="ignore") as f:
            reader = csv.reader(f)
            header_map: Dict[str, int] = {}
            for row_idx, row in enumerate(reader):
                if not row:
                    continue
                if not header_map:
                    for col_idx, cell in enumerate(row):
                        txt = cell.lower().strip()
                        if any(k in txt for k in ["survey", "sy.", "sy no", "s.no"]):
                            header_map["survey"] = col_idx
                        elif any(k in txt for k in ["pattadar", "owner", "holder", "name"]):
                            header_map["owner"] = col_idx
                        elif any(k in txt for k in ["khata", "passbook"]):
                            header_map["khata"] = col_idx
                        elif any(k in txt for k in ["nature", "classification", "type"]):
                            header_map["land_type"] = col_idx
                    continue

                if "survey" in header_map and len(row) > header_map["survey"]:
                    s_no = normalize_survey_no(row[header_map["survey"]])
                    if s_no:
                        owner = row[header_map["owner"]].strip() if "owner" in header_map and len(row) > header_map["owner"] else ""
                        khata = row[header_map["khata"]].strip() if "khata" in header_map and len(row) > header_map["khata"] else ""
                        ltype = row[header_map["land_type"]].strip() if "land_type" in header_map and len(row) > header_map["land_type"] else ""
                        survey_records[s_no] = {
                            "pattadar_name": owner,
                            "khata_no": khata,
                            "land_nature": ltype,
                        }
    except Exception as ex:
        logger.warning("Error reading CSV schedule: {}", ex)

    return {
        "survey_records": survey_records,
        "extra_structures": extra_structures,
        "extra_chainages": [],
    }
