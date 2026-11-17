from fastapi.testclient import TestClient
from web_app.app import app

def test_full_pipeline_verification():
    client = TestClient(app)

    # 1. Health check
    h = client.get('/health')
    assert h.status_code == 200
    assert h.json()['status'] == 'healthy'

    # 2. Sample file retrieval
    s = client.get('/api/sample-file')
    assert s.status_code == 200
    assert len(s.content) > 50000

    # 3. Full CAD conversion (DWG -> DXF -> Topology -> Reproject -> GeoJSON + KML)
    c = client.post(
        '/api/convert',
        files={'file': ('sample.dwg', s.content, 'application/acad')},
        data={'input_epsg': 'EPSG:32644', 'output_epsg': 'EPSG:4326', 'output_format': 'kml'}
    )
    assert c.status_code == 200
    cdata = c.json()
    assert cdata['success'] is True
    job_id = cdata['job_id']
    filename = cdata['filename']
    assert cdata['stats']['total_entities'] == 174
    assert len(cdata['geojson']['features']) > 100

    # 4. KML Download
    d = client.get(f'/api/download/{job_id}/{filename}')
    assert d.status_code == 200
    assert len(d.content) > 1000

    # 5. Temporary share creation
    sh = client.post('/api/share', data={'job_id': job_id, 'expires_in_hours': 24.0})
    assert sh.status_code == 200
    share_id = sh.json()['share_id']

    # 6. Shared GeoJSON retrieval
    sh_geo = client.get(f'/api/share/{share_id}/geojson')
    assert sh_geo.status_code == 200
    assert len(sh_geo.json()['features']) == len(cdata['geojson']['features'])

    # 7. Shared download
    sh_dl = client.get(f'/api/share/{share_id}/download')
    assert sh_dl.status_code == 200
    assert len(sh_dl.content) == len(d.content)

    # 8. UTM Zone detection
    utm = client.post('/api/utm-zone', data={'lat': 14.5, 'lon': 79.5})
    assert utm.status_code == 200
    assert utm.json()['epsg'] == 'EPSG:32644'
