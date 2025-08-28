import requests

def test_root_endpoint():
    response = requests.get("http://localhost:8081/")
    assert response.status_code == 200

def test_logs_endpoint():
    response = requests.get("http://localhost:8081/api/logs")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert "status" in data
    assert data["status"] == "success"

def test_stats_endpoint():
    response = requests.get("http://localhost:8081/api/stats")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert "top_src" in data
    assert "top_as" in data
    assert "top_isp" in data
    assert "top_country" in data
    assert "top_username" in data
    assert "top_password" in data
    assert "top_node" in data
    assert "total_unique_srcs" in data