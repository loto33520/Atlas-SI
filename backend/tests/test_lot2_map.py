from app.models import MapPosition, ObjectType, RelationType, SIObject, SIRelation


def build_graph(db_session):
    process_type = ObjectType(code="process", name="Processus", color="#7C3AED", schema={}, active=True)
    application_type = ObjectType(code="application", name="Application", color="#2563EB", schema={}, active=True)
    server_type = ObjectType(code="server", name="Serveur", color="#0891B2", schema={}, active=True)
    database_type = ObjectType(code="database", name="Base de données", color="#0D9488", schema={}, active=True)
    db_session.add_all([process_type, application_type, server_type, database_type])
    db_session.flush()

    supports = RelationType(code="supports", name="Soutient", color="#7C3AED", directed=True, active=True)
    hosted = RelationType(code="hosted_on", name="Hébergé sur", color="#0891B2", directed=True, active=True)
    stores = RelationType(code="stores", name="Stocke", color="#0D9488", directed=True, active=True)
    db_session.add_all([supports, hosted, stores])
    db_session.flush()

    process = SIObject(object_type_id=process_type.id, name="Facturation", criticality="critical", tags={"metier": "finance"}, attributes={}, active=True)
    application = SIObject(object_type_id=application_type.id, name="ERP", criticality="high", tags={"environment": "production", "site": "siege"}, attributes={}, active=True)
    server = SIObject(object_type_id=server_type.id, name="VM-ERP-01", criticality="high", tags={"environment": "production"}, attributes={}, active=True)
    database = SIObject(object_type_id=database_type.id, name="ERP-PROD", criticality="high", tags={"environment": "production"}, attributes={}, active=True)
    db_session.add_all([process, application, server, database])
    db_session.flush()

    db_session.add_all([
        SIRelation(relation_type_id=supports.id, source_id=process.id, target_id=application.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=hosted.id, source_id=application.id, target_id=server.id, label="", attributes={}, active=True),
        SIRelation(relation_type_id=stores.id, source_id=application.id, target_id=database.id, label="", attributes={}, active=True),
    ])
    db_session.commit()
    return {"process": process, "application": application, "server": server, "database": database}


def test_global_graph_returns_nodes_edges_and_legend(client, db_session):
    build_graph(db_session)
    response = client.get("/api/map/graph?view=all")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["nodes"]) == 4
    assert len(payload["edges"]) == 3
    assert {item["object_type_code"] for item in payload["nodes"]} == {"process", "application", "server", "database"}
    assert {item["code"] for item in payload["legends"]} == {"process", "application", "server", "database"}


def test_process_view_and_tag_filter(client, db_session):
    build_graph(db_session)
    response = client.get("/api/map/graph?view=process")
    assert response.status_code == 200
    assert {item["object_type_code"] for item in response.json()["nodes"]} == {"process", "application"}

    response = client.get("/api/map/graph?view=all&tag=environment:production&tag=site:siege")
    assert response.status_code == 200
    assert [item["name"] for item in response.json()["nodes"]] == ["ERP"]


def test_neighborhood_respects_depth_and_direction(client, db_session):
    items = build_graph(db_session)
    response = client.get(f"/api/map/neighborhood/{items['application'].id}?depth=1&direction=both")
    assert response.status_code == 200
    assert {item["name"] for item in response.json()["nodes"]} == {"Facturation", "ERP", "VM-ERP-01", "ERP-PROD"}

    response = client.get(f"/api/map/neighborhood/{items['application'].id}?depth=1&direction=upstream")
    assert response.status_code == 200
    assert {item["name"] for item in response.json()["nodes"]} == {"Facturation", "ERP"}


def test_positions_are_saved_updated_and_reset(client, db_session):
    items = build_graph(db_session)
    headers = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}
    payload = {"view_key": "all", "positions": [{"object_id": str(items["application"].id), "x": 120.5, "y": -42.0}]}
    response = client.put("/api/map/positions", json=payload, headers=headers)
    assert response.status_code == 200
    position = db_session.query(MapPosition).one()
    assert position.x == 120.5

    payload["positions"][0]["x"] = 240.0
    response = client.put("/api/map/positions", json=payload, headers=headers)
    assert response.status_code == 200
    db_session.expire_all()
    assert db_session.query(MapPosition).one().x == 240.0

    response = client.get("/api/map/graph?view=all")
    application = next(item for item in response.json()["nodes"] if item["name"] == "ERP")
    assert application["x"] == 240.0
    assert application["y"] == -42.0

    response = client.delete("/api/map/positions/all", headers=headers)
    assert response.status_code == 200
    assert db_session.query(MapPosition).count() == 0


def test_positions_are_private_to_the_keycloak_subject(client, db_session):
    items = build_graph(db_session)
    db_session.add(MapPosition(user_sub="another-user", view_key="all", object_id=items["application"].id, x=999, y=888))
    db_session.commit()

    response = client.get("/api/map/graph?view=all")
    assert response.status_code == 200
    application = next(item for item in response.json()["nodes"] if item["name"] == "ERP")
    assert application["x"] is None
    assert application["y"] is None


def test_invalid_view_and_tag_are_rejected(client, db_session):
    build_graph(db_session)
    assert client.get("/api/map/graph?view=unknown").status_code == 422
    assert client.get("/api/map/graph?tag=malformed").status_code == 422
