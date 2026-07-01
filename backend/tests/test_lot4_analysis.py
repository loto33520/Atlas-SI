from app.models import ImpactScenario, ObjectType, RelationType, SIObject, SIRelation

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def seed_graph(db_session):
    process = ObjectType(code="process", name="Processus", schema={}, active=True)
    application = ObjectType(code="application", name="Application", schema={}, active=True)
    server = ObjectType(code="server", name="Serveur", schema={}, active=True)
    db_session.add_all([process, application, server])
    db_session.flush()
    supports = RelationType(code="supports", name="Soutient", directed=True, active=True)
    depends = RelationType(code="depends", name="Dépend de", directed=True, active=True)
    db_session.add_all([supports, depends])
    db_session.flush()

    p = SIObject(object_type_id=process.id, name="Facturation", criticality="critical", tags={}, attributes={}, active=True)
    a = SIObject(object_type_id=application.id, name="ERP", criticality="high", owner_name="Équipe Apps", tags={}, attributes={}, active=True)
    s = SIObject(object_type_id=server.id, name="VM-ERP", criticality="medium", owner_name="Infrastructure", tags={}, attributes={}, active=True)
    b = SIObject(object_type_id=server.id, name="Sauvegarde", criticality="low", tags={}, attributes={}, active=True)
    db_session.add_all([p, a, s, b])
    db_session.flush()
    db_session.add_all([
        SIRelation(relation_type_id=supports.id, source_id=p.id, target_id=a.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=depends.id, source_id=a.id, target_id=s.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=depends.id, source_id=s.id, target_id=b.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=depends.id, source_id=b.id, target_id=a.id, label="cycle", attributes={}, active=True),
    ])
    db_session.commit()
    return p, a, s, b, supports, depends


def test_downstream_impact_depth_and_paths(client, db_session):
    p, a, s, b, _, _ = seed_graph(db_session)
    response = client.post("/api/analysis/impact", json={
        "root_object_id": str(p.id), "direction": "downstream", "max_depth": 3
    })
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["summary"]["total_nodes"] == 4
    depths = {item["name"]: item["depth"] for item in data["nodes"]}
    assert depths == {"Facturation": 0, "ERP": 1, "VM-ERP": 2, "Sauvegarde": 3}
    assert data["summary"]["has_cycles"] is True
    assert len(data["paths"]) == 3


def test_upstream_and_exclusions(client, db_session):
    p, a, s, b, _, _ = seed_graph(db_session)
    response = client.post("/api/analysis/impact", json={
        "root_object_id": str(s.id), "direction": "upstream", "max_depth": 4,
        "excluded_object_ids": [str(p.id)]
    })
    assert response.status_code == 200, response.text
    names = {item["name"] for item in response.json()["nodes"]}
    assert "VM-ERP" in names
    assert "ERP" in names
    assert "Facturation" not in names


def test_relation_type_filter(client, db_session):
    p, a, s, b, supports, depends = seed_graph(db_session)
    response = client.post("/api/analysis/impact", json={
        "root_object_id": str(p.id), "direction": "downstream", "max_depth": 5,
        "relation_type_ids": [str(supports.id)]
    })
    assert response.status_code == 200
    assert {item["name"] for item in response.json()["nodes"]} == {"Facturation", "ERP"}


def test_cycle_detection(client, db_session):
    _, a, _, _, _, _ = seed_graph(db_session)
    response = client.post("/api/analysis/impact", json={
        "root_object_id": str(a.id), "direction": "downstream", "max_depth": 5
    })
    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["has_cycles"] is True
    assert len(data["cycles"]) >= 1


def test_scenario_create_list_get_delete(client, db_session):
    p, _, _, _, _, _ = seed_graph(db_session)
    created = client.post("/api/analysis/scenarios", headers=HEADERS, json={
        "name": "Panne facturation",
        "description": "Simulation de panne",
        "analysis": {"root_object_id": str(p.id), "direction": "downstream", "max_depth": 3},
        "result_snapshot": {}
    })
    assert created.status_code == 201, created.text
    scenario_id = created.json()["id"]
    assert created.json()["result_snapshot"]["summary"]["total_nodes"] == 4
    assert db_session.query(ImpactScenario).count() == 1

    listed = client.get("/api/analysis/scenarios")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    detail = client.get(f"/api/analysis/scenarios/{scenario_id}")
    assert detail.status_code == 200

    deleted = client.delete(f"/api/analysis/scenarios/{scenario_id}", headers=HEADERS)
    assert deleted.status_code == 200
    db_session.expire_all()
    assert db_session.query(ImpactScenario).one().active is False


def test_unknown_root_returns_404(client):
    response = client.post("/api/analysis/impact", json={
        "root_object_id": "00000000-0000-0000-0000-000000000001",
        "direction": "both", "max_depth": 2
    })
    assert response.status_code == 404
