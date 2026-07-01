from app.main import app
from app.security import AuthContext, get_auth_context

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def create_type(client, code: str, name: str):
    response = client.post(
        "/api/object-types",
        headers=HEADERS,
        json={"code": code, "name": name, "schema": {}, "active": True},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_complete_object_and_relation_workflow(client):
    app_type = create_type(client, "application_test", "Application de test")
    server_type = create_type(client, "server_test", "Serveur de test")

    relation_type_response = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "hosted_test",
            "name": "Hébergé sur",
            "source_type_id": app_type["id"],
            "target_type_id": server_type["id"],
            "directed": True,
            "active": True,
        },
    )
    assert relation_type_response.status_code == 201, relation_type_response.text
    relation_type = relation_type_response.json()

    application_response = client.post(
        "/api/objects",
        headers=HEADERS,
        json={
            "object_type_id": app_type["id"],
            "name": "ERP",
            "status": "active",
            "criticality": "critical",
            "tags": {"environment": "production"},
            "attributes": {},
            "active": True,
        },
    )
    assert application_response.status_code == 201, application_response.text
    application = application_response.json()

    server_response = client.post(
        "/api/objects",
        headers=HEADERS,
        json={
            "object_type_id": server_type["id"],
            "name": "VM-ERP-01",
            "status": "active",
            "criticality": "high",
            "tags": {},
            "attributes": {"os": "Linux"},
            "active": True,
        },
    )
    assert server_response.status_code == 201, server_response.text
    server = server_response.json()

    relation_response = client.post(
        "/api/relations",
        headers=HEADERS,
        json={
            "relation_type_id": relation_type["id"],
            "source_id": application["id"],
            "target_id": server["id"],
            "label": "Production",
            "attributes": {},
            "active": True,
        },
    )
    assert relation_response.status_code == 201, relation_response.text

    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.json()["objects"] == 2
    assert dashboard.json()["relations"] == 1

    audit = client.get("/api/audit-events")
    assert audit.status_code == 200
    assert len(audit.json()) == 6


def test_relation_type_constraints_are_enforced(client):
    app_type = create_type(client, "app_constraint", "Application")
    server_type = create_type(client, "server_constraint", "Serveur")
    relation_type = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "only_app_server",
            "name": "Application vers serveur",
            "source_type_id": app_type["id"],
            "target_type_id": server_type["id"],
            "directed": True,
            "active": True,
        },
    ).json()

    server1 = client.post("/api/objects", headers=HEADERS, json={"object_type_id": server_type["id"], "name": "S1"}).json()
    server2 = client.post("/api/objects", headers=HEADERS, json={"object_type_id": server_type["id"], "name": "S2"}).json()
    response = client.post(
        "/api/relations",
        headers=HEADERS,
        json={"relation_type_id": relation_type["id"], "source_id": server1["id"], "target_id": server2["id"]},
    )
    assert response.status_code == 422


def test_reader_cannot_write(client):
    reader = AuthContext(
        session_id="reader",
        subject="reader-1",
        username="reader",
        email=None,
        display_name="Lecteur",
        roles=("reader",),
        groups=(),
        csrf_token="csrf-test",
    )
    app.dependency_overrides[get_auth_context] = lambda: reader
    response = client.post(
        "/api/object-types",
        headers=HEADERS,
        json={"code": "forbidden_type", "name": "Interdit", "schema": {}},
    )
    assert response.status_code == 403


def test_update_archive_and_csrf(client):
    created = create_type(client, "editable_type", "Type modifiable")

    missing_csrf = client.patch(
        f"/api/object-types/{created['id']}",
        json={"name": "Modification refusée"},
    )
    assert missing_csrf.status_code == 403

    updated = client.patch(
        f"/api/object-types/{created['id']}",
        headers=HEADERS,
        json={"name": "Type modifié", "schema": {"required": ["owner"]}},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Type modifié"
    assert updated.json()["schema"] == {"required": ["owner"]}

    archived = client.delete(f"/api/object-types/{created['id']}", headers=HEADERS)
    assert archived.status_code == 200
    listed = client.get("/api/object-types?include_inactive=true")
    record = next(item for item in listed.json() if item["id"] == created["id"])
    assert record["active"] is False


def test_group_and_role_mapping():
    from app.security import map_application_roles

    assert map_application_roles([], ["/ATLAS-ADMINISTRATEURS"]) == ["admin", "contributor", "auditor", "reader"]
    assert map_application_roles(["ATLAS-CONTRIBUTEURS"], []) == ["contributor", "reader"]


def test_used_types_cannot_be_archived(client):
    app_type = create_type(client, "used_app_type", "Application utilisée")
    server_type = create_type(client, "used_server_type", "Serveur utilisé")
    relation_type = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "used_relation_type",
            "name": "Relation utilisée",
            "source_type_id": app_type["id"],
            "target_type_id": server_type["id"],
            "directed": True,
            "active": True,
        },
    ).json()
    app_object = client.post(
        "/api/objects",
        headers=HEADERS,
        json={"object_type_id": app_type["id"], "name": "Application A"},
    ).json()
    server_object = client.post(
        "/api/objects",
        headers=HEADERS,
        json={"object_type_id": server_type["id"], "name": "Serveur A"},
    ).json()
    client.post(
        "/api/relations",
        headers=HEADERS,
        json={
            "relation_type_id": relation_type["id"],
            "source_id": app_object["id"],
            "target_id": server_object["id"],
        },
    )

    assert client.delete(f"/api/object-types/{app_type['id']}", headers=HEADERS).status_code == 409
    assert client.delete(f"/api/relation-types/{relation_type['id']}", headers=HEADERS).status_code == 409


def test_object_type_change_cannot_invalidate_relations(client):
    app_type = create_type(client, "change_app_type", "Application")
    server_type = create_type(client, "change_server_type", "Serveur")
    other_type = create_type(client, "change_other_type", "Autre")
    relation_type = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "change_hosted_on",
            "name": "Hébergé sur",
            "source_type_id": app_type["id"],
            "target_type_id": server_type["id"],
            "directed": True,
            "active": True,
        },
    ).json()
    source = client.post(
        "/api/objects",
        headers=HEADERS,
        json={"object_type_id": app_type["id"], "name": "Application B"},
    ).json()
    target = client.post(
        "/api/objects",
        headers=HEADERS,
        json={"object_type_id": server_type["id"], "name": "Serveur B"},
    ).json()
    client.post(
        "/api/relations",
        headers=HEADERS,
        json={
            "relation_type_id": relation_type["id"],
            "source_id": source["id"],
            "target_id": target["id"],
        },
    )

    response = client.patch(
        f"/api/objects/{source['id']}",
        headers=HEADERS,
        json={"object_type_id": other_type["id"]},
    )
    assert response.status_code == 409


def test_relation_can_be_retyped_then_archived(client):
    source_type = create_type(client, "relation_edit_source", "Source relation")
    target_type = create_type(client, "relation_edit_target", "Cible relation")
    first_type = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "relation_edit_first",
            "name": "Première relation",
            "source_type_id": source_type["id"],
            "target_type_id": target_type["id"],
            "directed": True,
            "color": "#2563EB",
        },
    ).json()
    second_type = client.post(
        "/api/relation-types",
        headers=HEADERS,
        json={
            "code": "relation_edit_second",
            "name": "Deuxième relation",
            "source_type_id": source_type["id"],
            "target_type_id": target_type["id"],
            "directed": True,
            "color": "#DC2626",
        },
    ).json()
    source = client.post(
        "/api/objects", headers=HEADERS,
        json={"object_type_id": source_type["id"], "name": "Source A"},
    ).json()
    target = client.post(
        "/api/objects", headers=HEADERS,
        json={"object_type_id": target_type["id"], "name": "Cible A"},
    ).json()
    relation = client.post(
        "/api/relations", headers=HEADERS,
        json={
            "relation_type_id": first_type["id"],
            "source_id": source["id"],
            "target_id": target["id"],
            "label": "Ancien libellé",
            "attributes": {"port": "443"},
        },
    ).json()

    updated = client.patch(
        f"/api/relations/{relation['id']}", headers=HEADERS,
        json={
            "relation_type_id": second_type["id"],
            "label": "Nouveau libellé",
            "attributes": {"protocole": "https"},
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["relation_type_id"] == second_type["id"]
    assert updated.json()["label"] == "Nouveau libellé"
    assert updated.json()["attributes"] == {"protocole": "https"}

    archived = client.delete(f"/api/relations/{relation['id']}", headers=HEADERS)
    assert archived.status_code == 200
    active_relations = client.get("/api/relations").json()
    assert all(item["id"] != relation["id"] for item in active_relations)
