"""The Daftar worker. It asks the API for a job, does the work, and reports the result.

Standard library only. Environment:
  API_URL         where the API is (default http://api:8080)
  WORK_MS         how long one job takes (default 300)
  HEARTBEAT_FILE  a file whose modification time shows the loop is alive (default /tmp/heartbeat)

SIGTERM or SIGINT: finish the job in hand, then exit 0.
"""
import json
import os
import signal
import sys
import time
import urllib.error
import urllib.request

API_URL = os.environ.get("API_URL", "http://api:8080").rstrip("/")
WORK_MS = int(os.environ.get("WORK_MS", "300"))
HEARTBEAT_FILE = os.environ.get("HEARTBEAT_FILE", "/tmp/heartbeat")
VERSION = os.environ.get("APP_VERSION", "1.0.0")

stopping = False


def on_stop(signum, frame):
    global stopping
    stopping = True
    log(event="shutdown", signal=signal.Signals(signum).name)


def log(**fields):
    fields["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    sys.stdout.write(json.dumps(fields) + "\n")
    sys.stdout.flush()


def call(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API_URL + path, data=data, method=method, headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        raw = response.read()
        return response.status, (json.loads(raw) if raw else None)


def beat():
    with open(HEARTBEAT_FILE, "w") as f:
        f.write(str(time.time()))


def process(text):
    return f"{text.upper()} ({len(text.split())} words)"


def main():
    signal.signal(signal.SIGTERM, on_stop)
    signal.signal(signal.SIGINT, on_stop)
    log(event="started", version=VERSION, api=API_URL)
    while not stopping:
        beat()
        try:
            status, data = call("POST", "/internal/claim")
        except (urllib.error.URLError, OSError, ValueError) as e:
            log(event="api unreachable", error=str(e))
            time.sleep(1)
            continue
        if status != 200 or not data:
            time.sleep(0.5)
            continue
        job = data["job"]
        time.sleep(WORK_MS / 1000)
        try:
            call("POST", f"/internal/jobs/{job['id']}/done", {"result": process(job["text"])})
            log(event="done", id=job["id"])
        except (urllib.error.URLError, OSError, ValueError) as e:
            log(event="could not report", id=job["id"], error=str(e))
    log(event="stopped")


if __name__ == "__main__":
    main()
