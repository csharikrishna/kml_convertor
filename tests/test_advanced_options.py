from fastapi.testclient import TestClient
from web_app.app import app

client = TestClient(app)


def test_health_check():
    """Verify health check endpoint returns 200 OK."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "temp_files_cached" in data


def test_advanced_options_deselected(tmp_path):
    """
    Test that when export_text=False and export_points=False are submitted,
    the converter respects these flags and excludes text/points from the result.
    """
    import ezdxf
    dxf_path = tmp_path / "test_options.dxf"
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()

    # Add polyline, point, and text
    msp.add_lwpolyline([(0, 0), (10, 0), (10, 10)])
    msp.add_point((5, 5))
    msp.add_text("TEST_LABEL", dxfattribs={"insert": (2, 2)})
    doc.saveas(dxf_path)

    with open(dxf_path, "rb") as f:
        response = client.post(
            "/api/convert",
            files={"file": ("test_options.dxf", f, "image/vnd.dxf")},
            data={
                "input_epsg": "32644",
                "output_epsg": "4326",
                "conversion_type": "standard",
                "merge_lines": "false",
                "ignore_large_polygons": "false",
                "export_text": "false",
                "export_points": "false",
                "label_scale": "0.5"
            }
        )

    assert response.status_code == 200
    data = response.json()
    assert data["stats"]["labels"] == 0
    assert data["stats"]["points"] == 0
