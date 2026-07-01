from datetime import date, timedelta

from app.models import ObjectType, SIObject

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def test_design_settings_and_logo(client):
    initial = client.get('/api/design/settings')
    assert initial.status_code == 200
    assert initial.json()['app_title'] == 'Atlas SI'

    updated = client.put('/api/design/settings', headers=HEADERS, json={
        'app_title': 'Cartographie SI',
        'app_subtitle': 'Référentiel du SI',
        'theme_mode': 'light',
        'primary_color': '#B4232F',
        'accent_color': '#D5A83E',
        'sidebar_color': '#252A31',
        'background_color': '#F5F5F4',
        'surface_color': '#FFFFFF',
        'border_radius': 10,
        'default_language': 'fr',
        'allow_user_language_choice': True,
    })
    assert updated.status_code == 200, updated.text
    assert updated.json()['app_title'] == 'Cartographie SI'

    invalid_logo = client.put('/api/design/logo', headers=HEADERS, json={
        'data_url': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    })
    assert invalid_logo.status_code == 400

    valid_logo = client.put('/api/design/logo', headers=HEADERS, json={
        'data_url': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZPmcAAAAASUVORK5CYII='
    })
    assert valid_logo.status_code == 200
    assert valid_logo.json()['logo_data_url'].startswith('data:image/png;base64,')
    removed = client.delete('/api/design/logo', headers=HEADERS)
    assert removed.status_code == 200
    assert removed.json()['logo_data_url'] is None


def test_quality_controls(client, db_session):
    app_type = ObjectType(code='application', name='Application', schema={}, active=True)
    server_type = ObjectType(code='server', name='Serveur', schema={}, active=True)
    db_session.add_all([app_type, server_type]); db_session.flush()
    app = SIObject(object_type_id=app_type.id, name='ERP sans processus', criticality='high', tags={}, attributes={}, active=True)
    server = SIObject(object_type_id=server_type.id, name='Serveur sans site', owner_name='Infra', tags={}, attributes={}, active=True)
    db_session.add_all([app, server]); db_session.commit()

    issues = client.get('/api/quality/issues')
    assert issues.status_code == 200
    codes = {item['code'] for item in issues.json()}
    assert 'missing_owner' in codes
    assert 'application_without_process' in codes
    assert 'server_without_site' in codes
    assert 'isolated_object' in codes

    summary = client.get('/api/quality/summary')
    assert summary.status_code == 200
    assert summary.json()['total_issues'] >= 4
    assert summary.json()['score'] < 100
    export = client.get('/api/quality/export.csv')
    assert export.status_code == 200
    assert 'application_without_process' in export.text


def test_prefilled_version_update_and_correction(client, db_session):
    software = ObjectType(code='software', name='Logiciel', schema={}, active=True)
    db_session.add(software); db_session.flush()
    obj = SIObject(object_type_id=software.id, name='Produit', owner_name='IT', tags={}, attributes={}, active=True)
    db_session.add(obj); db_session.commit()
    first = client.post('/api/versions/observations', headers=HEADERS, json={
        'object_id': str(obj.id), 'observed_version': '1.0', 'target_version': '1.1', 'source': 'manuel'
    })
    assert first.status_code == 201
    correction = client.patch(f"/api/versions/observations/{first.json()['id']}", headers=HEADERS, json={'observed_version': '1.0.2'})
    assert correction.status_code == 200
    assert correction.json()['observed_version'] == '1.0.2'
    new = client.post('/api/versions/observations', headers=HEADERS, json={
        'object_id': str(obj.id), 'observed_version': '1.1', 'target_version': '1.1', 'source': 'manuel'
    })
    assert new.status_code == 201
    history = client.get(f'/api/versions/observations?object_id={obj.id}')
    assert len(history.json()) == 2
