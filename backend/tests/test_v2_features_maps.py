from datetime import date

from app.models import ObjectType, RelationType, SIObject, SIRelation

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def seed_graph(db_session):
    app = ObjectType(code="application", name="Application", schema={}, active=True)
    server = ObjectType(code="server", name="Serveur", schema={}, active=True)
    site = ObjectType(code="site", name="Site", schema={}, active=True)
    hosted = RelationType(code="hosted_on", name="Hébergé sur", directed=True, active=True)
    located = RelationType(code="located_in", name="Situé dans", directed=True, active=True)
    db_session.add_all([app, server, site, hosted, located]); db_session.flush()
    a = SIObject(object_type_id=app.id, name="ERP", tags={"environment": "production"}, attributes={}, active=True)
    s = SIObject(object_type_id=server.id, name="VM-ERP", tags={}, attributes={}, active=True)
    p = SIObject(object_type_id=site.id, name="Datacenter", tags={}, attributes={}, active=True)
    db_session.add_all([a, s, p]); db_session.flush()
    db_session.add_all([
        SIRelation(relation_type_id=hosted.id, source_id=a.id, target_id=s.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=located.id, source_id=s.id, target_id=p.id, label="", attributes={}, active=True),
    ])
    db_session.commit()
    return app, server, site, hosted, located, a, s, p


def test_feature_catalog_and_dependencies(client):
    response = client.get("/api/features")
    assert response.status_code == 200
    assert any(item["code"] == "saved_maps" for item in response.json()["features"])
    updated = client.put("/api/features", headers=HEADERS, json={"enabled_features": ["saved_maps"], "options": {}})
    assert updated.status_code == 200
    assert set(updated.json()["enabled_features"]) == {"map", "saved_maps"}


def test_anssi_templates(client):
    response = client.post("/api/features/templates/anssi", headers=HEADERS)
    assert response.status_code == 200
    types = client.get("/api/object-types").json()
    assert any(item["code"] == "supplier" for item in types)
    assert any(item["code"] == "admin_profile" for item in types)


def test_anssi_templates_can_be_selected_by_family(client):
    catalog = client.get("/api/features/templates/anssi")
    assert catalog.status_code == 200
    assert {item["code"] for item in catalog.json()["groups"]} >= {"ecosystem", "logical_infrastructure", "physical_infrastructure"}

    response = client.post(
        "/api/features/templates/anssi",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["selected_groups"] == ["logical_infrastructure"]
    types = client.get("/api/object-types").json()
    codes = {item["code"] for item in types}
    assert "firewall" in codes
    assert "network_zone" in codes
    assert "supplier" not in codes
    assert "physical_server" not in codes


def test_dynamic_map_recursion_and_catalog(client, db_session):
    app, server, site, hosted, located, a, s, p = seed_graph(db_session)
    catalog = client.get("/api/map/catalog")
    assert catalog.status_code == 200
    assert len(catalog.json()["object_types"]) == 3

    depth1 = client.post("/api/map/query", json={
        "root_object_ids": [str(a.id)], "max_depth": 1, "direction": "downstream",
        "object_type_ids": [str(app.id), str(server.id), str(site.id)],
        "relation_type_ids": [str(hosted.id), str(located.id)],
    })
    assert depth1.status_code == 200, depth1.text
    assert {item["name"] for item in depth1.json()["nodes"]} == {"ERP", "VM-ERP"}

    depth2 = client.post("/api/map/query", json={
        "root_object_ids": [str(a.id)], "max_depth": 2, "direction": "downstream",
        "object_type_ids": [str(app.id), str(server.id), str(site.id)],
    })
    assert depth2.status_code == 200
    assert {item["name"] for item in depth2.json()["nodes"]} == {"ERP", "VM-ERP", "Datacenter"}

    root_only = client.get(f"/api/map/neighborhood/{a.id}?depth=0&limit=1")
    assert root_only.status_code == 200, root_only.text
    assert [item["name"] for item in root_only.json()["nodes"]] == ["ERP"]


def test_saved_map_lifecycle_and_export(client, db_session):
    app, server, site, hosted, located, a, s, p = seed_graph(db_session)
    created = client.post("/api/saved-maps", headers=HEADERS, json={
        "name": "Infrastructure ERP",
        "map_mode": "snapshot",
        "visibility": "all",
        "root_object_ids": [str(a.id)],
        "object_type_ids": [str(app.id), str(server.id), str(site.id)],
        "relation_type_ids": [str(hosted.id), str(located.id)],
        "direction": "downstream",
        "max_depth": 2,
        "filters": {"tags": ["environment:production"]},
        "snapshot": {"graph": {"nodes": [{"id": str(a.id), "name": "ERP"}], "edges": []}},
    })
    assert created.status_code == 201, created.text
    map_id = created.json()["id"]
    assert client.get("/api/saved-maps").status_code == 200
    exported = client.get(f"/api/saved-maps/{map_id}/export?format=json")
    assert exported.status_code == 200
    updated = client.patch(f"/api/saved-maps/{map_id}", headers=HEADERS, json={"name": "ERP - production"})
    assert updated.status_code == 200
    deleted = client.delete(f"/api/saved-maps/{map_id}", headers=HEADERS)
    assert deleted.status_code == 200


def test_governance_fields_are_persisted(client, db_session):
    object_type = ObjectType(code="application", name="Application", schema={}, active=True)
    db_session.add(object_type); db_session.commit()
    response = client.post("/api/objects", headers=HEADERS, json={
        "object_type_id": str(object_type.id),
        "name": "Application gouvernée",
        "data_owner_name": "Direction métier",
        "review_status": "validated",
        "confidence_level": "confirmed",
        "next_review_at": date.today().isoformat(),
        "review_frequency_days": 180,
        "protection_level": "confidential",
        "tags": {}, "attributes": {},
    })
    assert response.status_code == 201, response.text
    assert response.json()["review_status"] == "validated"
    assert response.json()["protection_level"] == "confidential"


def test_anssi_family_can_be_removed_when_unused(client, db_session):
    installed = client.post(
        "/api/features/templates/anssi",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert installed.status_code == 200, installed.text

    removed = client.post(
        "/api/features/templates/anssi/uninstall",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert removed.status_code == 200, removed.text
    assert removed.json()["object_types_archived"] == 4
    assert removed.json()["relation_types_archived"] == 2

    active_object_codes = {item.code for item in db_session.query(ObjectType).filter(ObjectType.active.is_(True)).all()}
    active_relation_codes = {item.code for item in db_session.query(RelationType).filter(RelationType.active.is_(True)).all()}
    assert not {"network_zone", "vlan", "subnet", "firewall"}.intersection(active_object_codes)
    assert not {"connected_to", "protected_by"}.intersection(active_relation_codes)


def test_anssi_family_removal_is_all_or_nothing_when_used(client, db_session):
    installed = client.post(
        "/api/features/templates/anssi",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert installed.status_code == 200, installed.text
    firewall = db_session.query(ObjectType).filter(ObjectType.code == "firewall").one()
    db_session.add(SIObject(object_type_id=firewall.id, name="FW-EDGE", tags={}, attributes={}, active=True))
    db_session.commit()

    removed = client.post(
        "/api/features/templates/anssi/uninstall",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert removed.status_code == 409, removed.text
    assert "Aucun élément n’a été supprimé" in removed.json()["detail"]

    db_session.expire_all()
    logical_codes = {"network_zone", "vlan", "subnet", "firewall"}
    active_logical_codes = {
        item.code for item in db_session.query(ObjectType).filter(ObjectType.code.in_(logical_codes), ObjectType.active.is_(True)).all()
    }
    assert active_logical_codes == logical_codes
    relation_codes = {"connected_to", "protected_by"}
    active_relation_codes = {
        item.code for item in db_session.query(RelationType).filter(RelationType.code.in_(relation_codes), RelationType.active.is_(True)).all()
    }
    assert active_relation_codes == relation_codes


def test_anssi_shared_components_are_preserved(client, db_session):
    installed = client.post(
        "/api/features/templates/anssi",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure", "physical_infrastructure"]},
    )
    assert installed.status_code == 200, installed.text

    removed = client.post(
        "/api/features/templates/anssi/uninstall",
        headers=HEADERS,
        json={"groups": ["logical_infrastructure"]},
    )
    assert removed.status_code == 200, removed.text
    assert any("Est connecté à" in value for value in removed.json()["preserved_shared"])
    connected = db_session.query(RelationType).filter(RelationType.code == "connected_to").one()
    assert connected.active is True


def test_object_type_list_includes_usage_counts(client, db_session):
    object_type = ObjectType(code="service", name="Service", schema={}, active=True)
    db_session.add(object_type); db_session.flush()
    db_session.add_all([
        SIObject(object_type_id=object_type.id, name="Service actif", tags={}, attributes={}, active=True),
        SIObject(object_type_id=object_type.id, name="Service archivé", tags={}, attributes={}, active=False),
    ])
    db_session.commit()

    response = client.get("/api/object-types?include_inactive=true")
    assert response.status_code == 200, response.text
    item = next(value for value in response.json() if value["id"] == str(object_type.id))
    assert item["object_count"] == 2
    assert item["active_object_count"] == 1
