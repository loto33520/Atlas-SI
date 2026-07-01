from app.models import ImportJob, ObjectType, RelationType, SIObject, SIRelation

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def seed_types(db_session):
    application = ObjectType(code="application", name="Application", schema={}, active=True)
    server = ObjectType(code="server", name="Serveur", schema={}, active=True)
    db_session.add_all([application, server])
    db_session.flush()
    hosted = RelationType(
        code="hosted_on", name="Hébergé sur", source_type_id=application.id,
        target_type_id=server.id, directed=True, active=True
    )
    db_session.add(hosted)
    db_session.commit()
    return application, server, hosted


def test_csv_object_import_preview_apply_and_rollback(client, db_session):
    seed_types(db_session)
    content = (
        "external_id;type_code;name;criticality;tags;attributes\n"
        "APP-ERP;application;ERP;critical;environnement=production;version=8.4\n"
        "SRV-ERP;server;VM-ERP-01;high;environnement=production;os=Linux\n"
    )
    analyse = client.post("/api/imports/analyse", headers=HEADERS, json={
        "entity_kind": "objects", "source_format": "csv", "content": content, "filename": "objects.csv"
    })
    assert analyse.status_code == 200, analyse.text
    assert analyse.json()["row_count"] == 2
    assert analyse.json()["suggested_mapping"]["type_code"] == "type_code"

    preview = client.post("/api/imports/preview", headers=HEADERS, json={
        "entity_kind": "objects", "source_format": "csv", "content": content,
        "filename": "objects.csv", "mapping": analyse.json()["suggested_mapping"], "duplicate_mode": "skip"
    })
    assert preview.status_code == 200, preview.text
    job = preview.json()
    assert job["summary"]["create"] == 2
    assert job["summary"]["errors"] == 0

    applied = client.post(f"/api/imports/{job['id']}/apply", headers=HEADERS)
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"] == "applied"
    assert db_session.query(SIObject).filter(SIObject.active.is_(True)).count() == 2

    rolled_back = client.post(f"/api/imports/{job['id']}/rollback", headers=HEADERS)
    assert rolled_back.status_code == 200, rolled_back.text
    assert rolled_back.json()["status"] == "rolled_back"
    db_session.expire_all()
    assert db_session.query(SIObject).filter(SIObject.active.is_(True)).count() == 0


def test_duplicate_update_mode_updates_object(client, db_session):
    application, _, _ = seed_types(db_session)
    db_session.add(SIObject(
        external_id="APP-ERP", object_type_id=application.id, name="ERP", criticality="medium",
        tags={}, attributes={}, active=True
    ))
    db_session.commit()
    content = "external_id;type_code;name;criticality\nAPP-ERP;application;ERP;critical\n"
    preview = client.post("/api/imports/preview", headers=HEADERS, json={
        "entity_kind": "objects", "source_format": "csv", "content": content,
        "duplicate_mode": "update", "mapping": {
            "external_id": "external_id", "type_code": "type_code", "name": "name", "criticality": "criticality"
        }
    })
    assert preview.status_code == 200, preview.text
    job = preview.json()
    assert job["summary"]["update"] == 1
    applied = client.post(f"/api/imports/{job['id']}/apply", headers=HEADERS)
    assert applied.status_code == 200, applied.text
    db_session.expire_all()
    assert db_session.query(SIObject).filter_by(external_id="APP-ERP").one().criticality == "critical"


def test_relation_import_uses_external_references(client, db_session):
    application, server, hosted = seed_types(db_session)
    source = SIObject(external_id="APP-ERP", object_type_id=application.id, name="ERP", tags={}, attributes={}, active=True)
    target = SIObject(external_id="SRV-ERP", object_type_id=server.id, name="VM-ERP-01", tags={}, attributes={}, active=True)
    db_session.add_all([source, target])
    db_session.commit()
    content = "relation_type_code;source_ref;target_ref;label;attributes\nhosted_on;APP-ERP;SRV-ERP;Production;port=443\n"
    preview = client.post("/api/imports/preview", headers=HEADERS, json={
        "entity_kind": "relations", "source_format": "csv", "content": content,
        "duplicate_mode": "skip", "mapping": {
            "relation_type_code": "relation_type_code", "source_ref": "source_ref",
            "target_ref": "target_ref", "label": "label", "attributes": "attributes"
        }
    })
    assert preview.status_code == 200, preview.text
    job = preview.json()
    assert job["summary"]["create"] == 1
    applied = client.post(f"/api/imports/{job['id']}/apply", headers=HEADERS)
    assert applied.status_code == 200, applied.text
    db_session.expire_all()
    relation = db_session.query(SIRelation).one()
    assert relation.relation_type_id == hosted.id
    assert relation.attributes == {"port": 443}


def test_import_with_errors_cannot_be_applied(client, db_session):
    seed_types(db_session)
    preview = client.post("/api/imports/preview", headers=HEADERS, json={
        "entity_kind": "objects", "source_format": "json", "content": '[{"name":"Sans type"}]',
        "duplicate_mode": "skip", "mapping": {"name": "name", "type_code": "type_code"}
    })
    assert preview.status_code == 200
    job = preview.json()
    assert job["summary"]["errors"] == 1
    applied = client.post(f"/api/imports/{job['id']}/apply", headers=HEADERS)
    assert applied.status_code == 409


def test_import_history_is_available(client, db_session):
    seed_types(db_session)
    client.post("/api/imports/preview", headers=HEADERS, json={
        "entity_kind": "objects", "source_format": "json",
        "content": '[{"type_code":"application","name":"ERP"}]', "duplicate_mode": "skip",
        "mapping": {"type_code": "type_code", "name": "name"}
    })
    response = client.get("/api/imports")
    assert response.status_code == 200
    assert len(response.json()) == 1
    assert db_session.query(ImportJob).count() == 1


def test_configured_required_field_is_enforced(client, db_session):
    object_type = ObjectType(
        code="managed_app", name="Application administrée", active=True,
        schema={"fields": [{"key": "version", "label": "Version", "type": "text", "required": True}]}
    )
    db_session.add(object_type)
    db_session.commit()
    missing = client.post("/api/objects", headers=HEADERS, json={
        "object_type_id": str(object_type.id), "name": "Application sans version", "attributes": {}
    })
    assert missing.status_code == 422
    valid = client.post("/api/objects", headers=HEADERS, json={
        "object_type_id": str(object_type.id), "name": "Application versionnée", "attributes": {"version": "1.2"}
    })
    assert valid.status_code == 201, valid.text
