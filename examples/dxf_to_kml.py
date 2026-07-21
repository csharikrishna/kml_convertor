import ezdxf
import simplekml
from pyproj import Transformer
import math

# =====================================================
# CONFIGURATION
# =====================================================

DXF_FILE = r"C:\Users\Admin\OneDrive\Desktop\3 Meedivemula  INDEX - Copy.dxf"
OUTPUT_KML = r"C:\Users\Admin\OneDrive\Desktop\kml_convertor\3 Meedivemula INDEX.kml"


INPUT_EPSG = "EPSG:32644"
OUTPUT_EPSG = "EPSG:4326"

# Ignore extremely large construction rectangles
MAX_ALLOWED_LENGTH = 5000       # meters

# =====================================================

transformer = Transformer.from_crs(
    INPUT_EPSG,
    OUTPUT_EPSG,
    always_xy=True
)

doc = ezdxf.readfile(DXF_FILE)
msp = doc.modelspace()

kml = simplekml.Kml()

print("=" * 50)
print("Reading DXF...")
print("=" * 50)

polyline_count = 0
point_count = 0
text_count = 0

# -----------------------------------------------------
# helper
# -----------------------------------------------------
def distance(p1, p2):
    return math.sqrt(
        (p1[0]-p2[0])**2 +
        (p1[1]-p2[1])**2
    )

# =====================================================
# POLYLINES
# =====================================================

for entity in msp.query("LWPOLYLINE"):

    pts = []

    raw = []

    for p in entity.get_points():
        raw.append((p[0], p[1]))

    if len(raw) < 2:
        continue

    # -------------------------------------------------
    # Ignore huge rectangles / construction boundaries
    # -------------------------------------------------

    lengths = []

    for i in range(len(raw)-1):
        lengths.append(distance(raw[i], raw[i+1]))

    if entity.closed:
        lengths.append(distance(raw[-1], raw[0]))

    if max(lengths) > MAX_ALLOWED_LENGTH:
        print("Skipped large construction polyline")
        continue

    # -------------------------------------------------

    for x, y in raw:

        lon, lat = transformer.transform(x, y)

        pts.append((lon, lat))

    if entity.closed:

        if pts[0] != pts[-1]:
            pts.append(pts[0])

        poly = kml.newpolygon(
            name=f"Boundary_{polyline_count+1}"
        )

        poly.outerboundaryis = pts

        poly.style.linestyle.color = simplekml.Color.red
        poly.style.linestyle.width = 3

        poly.style.polystyle.fill = 0

    else:

        line = kml.newlinestring(
            name=f"Polyline_{polyline_count+1}"
        )

        line.coords = pts

        line.style.linestyle.color = simplekml.Color.red
        line.style.linestyle.width = 3

    polyline_count += 1

# =====================================================
# POINTS
# =====================================================

for entity in msp.query("POINT"):

    x = entity.dxf.location.x
    y = entity.dxf.location.y

    lon, lat = transformer.transform(x, y)

    p = kml.newpoint()

    p.coords = [(lon, lat)]

    p.style.iconstyle.icon.href = \
        "http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png"

    p.style.iconstyle.scale = 0.8

    point_count += 1

# =====================================================
# TEXT
# =====================================================

for entity in msp.query("TEXT"):

    x = entity.dxf.insert.x
    y = entity.dxf.insert.y

    lon, lat = transformer.transform(x, y)

    txt = kml.newpoint()

    txt.name = entity.dxf.text

    txt.coords = [(lon, lat)]

    txt.style.labelstyle.scale = 0.5

    txt.style.iconstyle.scale = 0

    text_count += 1

# =====================================================
# MTEXT
# =====================================================

for entity in msp.query("MTEXT"):

    x = entity.dxf.insert.x
    y = entity.dxf.insert.y

    lon, lat = transformer.transform(x, y)

    txt = kml.newpoint()

    txt.name = entity.text

    txt.coords = [(lon, lat)]

    txt.style.labelstyle.scale = 0.5

    txt.style.iconstyle.scale = 0

    text_count += 1

# =====================================================

kml.save(OUTPUT_KML)

print()
print("=" * 50)
print("Finished")
print("=" * 50)
print("Polylines :", polyline_count)
print("Points    :", point_count)
print("Texts     :", text_count)
print()
print("Saved to")
print(OUTPUT_KML)
