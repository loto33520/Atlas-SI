from datetime import date, timedelta

from app.models import ObjectType, SIObject

HEADERS = {"X-CSRF-Token": "csrf-test", "Origin": "https://carto.example.org"}


def seed_object(db_session, name="VMware Cluster", external_id="vmware-prod"):
    object_type = ObjectType(code="software", name="Logiciel", schema={}, active=True)
    db_session.add(object_type)
    db_session.flush()
    obj = SIObject(
        object_type_id=object_type.id,
        external_id=external_id,
        name=name,
        criticality="high",
        owner_name="Infrastructure",
        tags={},
        attributes={},
        active=True,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def test_manual_version_observation_and_summary(client, db_session):
    obj = seed_object(db_session)
    response = client.post("/api/versions/observations", headers=HEADERS, json={
        "object_id": str(obj.id),
        "observed_version": "8.0.2",
        "target_version": "8.0.3",
        "latest_version": "8.0.3",
        "support_end_date": (date.today() + timedelta(days=180)).isoformat(),
        "source": "inventaire manuel",
    })
    assert response.status_code == 201, response.text
    assert response.json()["compliance_status"] == "update_available"

    current = client.get("/api/versions/current")
    assert current.status_code == 200
    assert current.json()[0]["object_name"] == "VMware Cluster"
    assert current.json()[0]["observed_version"] == "8.0.2"

    summary = client.get("/api/versions/summary")
    assert summary.status_code == 200
    assert summary.json()["total"] == 1
    assert summary.json()["update_available"] == 1


def test_unsupported_and_exception_statuses(client, db_session):
    obj = seed_object(db_session)
    unsupported = client.post("/api/versions/observations", headers=HEADERS, json={
        "object_id": str(obj.id),
        "observed_version": "6.7",
        "support_end_date": (date.today() - timedelta(days=1)).isoformat(),
        "source": "test",
    })
    assert unsupported.status_code == 201
    assert unsupported.json()["compliance_status"] == "unsupported"

    exception = client.post("/api/versions/observations", headers=HEADERS, json={
        "object_id": str(obj.id),
        "observed_version": "6.7",
        "support_end_date": (date.today() - timedelta(days=1)).isoformat(),
        "exception_until": (date.today() + timedelta(days=30)).isoformat(),
        "source": "test",
    })
    assert exception.status_code == 201
    assert exception.json()["compliance_status"] == "exception"
    current = client.get("/api/versions/current")
    assert current.json()[0]["compliance_status"] == "exception"


def test_observation_archive(client, db_session):
    obj = seed_object(db_session)
    created = client.post("/api/versions/observations", headers=HEADERS, json={
        "object_id": str(obj.id), "observed_version": "1", "latest_version": "1"
    })
    observation_id = created.json()["id"]
    deleted = client.delete(f"/api/versions/observations/{observation_id}", headers=HEADERS)
    assert deleted.status_code == 200
    assert client.get("/api/versions/current").json() == []



def test_connector_endpoints_are_disabled(client):
    response = client.get("/api/connectors")
    assert response.status_code == 404
