import requests

def test_webhook_post():
    payload = {
      "dst_host": "10.10.10.10",
      "dst_port": 22,
      "local_time": "2025-08-28T13:37:49.454-05:00",
      "local_time_adjusted": "2025-08-28T13:37:49.454-05:00",
      "logtype": 1,
      "node_id": "1337",
      "src_host": "140.82.114.3",
      "src_port": 12345,
      "utc_time": "2025-08-28T18:37:49.453Z",
      "logdata": {
        "LOCALVERSION": "1.0.0",
        "PASSWORD": "test_password",
        "REMOTEVERSION": "OpenSSH_8.4",
        "USERNAME": "test_user",
        "SESSION": "abc123"
      }
    }
    response = requests.post("http://localhost:8081/api/webhook", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert "status" in data
    assert data["status"] == "success"

def test_source_details_post():
    payload = {
        "ips":["140.82.114.3"]
    }
    response = requests.post("http://localhost:8081/api/source_details/batch", json=payload)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert "status" in data
    assert data["status"] == "success"
