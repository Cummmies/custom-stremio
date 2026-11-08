"""The tracker as a test server: a copy of the code and data (start.ps1 makes
it), on this PC only, that can't reach anyone's real accounts.

    python serve.py <copy folder> <port>                    run it
    python serve.py <copy folder> --token <user id> [name]  sign-in for a test app

What's switched off, before the server code loads:
  * Stremio: no library saves (the hourly push) and no sign-outs; the
    background sync from everyone's Stremio is off. The copy has its own
    secret key, so the Stremio sign-ins saved in the real data can't be read.
  * Email: nothing is sent.
  * The local-network broadcast: apps on the Wi-Fi don't find it.
"""
import os
import sys
from pathlib import Path


def main():
    code = Path(sys.argv[1]).resolve()
    db = code / "movie_tracker.db"
    # Only ever the copy (start.ps1's tracker-test-server\server): never the
    # real server folder or its database.
    if code.parent.name != "tracker-test-server" or code.name != "server" or not db.exists():
        sys.exit(f"Not a test-server copy: {code}")
    os.environ["DATABASE_URL"] = f"sqlite:///{db.as_posix()}"
    os.environ["ENVIRONMENT"] = "development"
    for key in ("SMTP_USER", "SMTP_PASS", "SMTP_HOST"):
        os.environ.pop(key, None)
    os.chdir(code)
    sys.path.insert(0, str(code))

    if sys.argv[2] == "--token":
        from core import devices

        user_id = int(sys.argv[3])
        name = sys.argv[4] if len(sys.argv) > 4 else "Test device"
        print(devices.issue_token(user_id, name, "windows")[0])
        return

    port = int(sys.argv[2])
    switch_off_outside_world()
    import uvicorn

    uvicorn.run("web.app:app", host="127.0.0.1", port=port, workers=1)


def switch_off_outside_world():
    import smtplib

    import core.mdns
    import core.stremio_sync
    from sources.stremio_client import StremioClient

    def no_email(*_a, **_k):
        raise smtplib.SMTPException("Email is off on the test server.")

    async def no_broadcast(*_a, **_k):
        return False

    smtplib.SMTP = no_email
    smtplib.SMTP_SSL = no_email
    core.mdns.start_mdns_broadcast = no_broadcast
    core.mdns.stop_mdns_broadcast = no_broadcast
    core.stremio_sync.sync_all_connected = lambda *a, **k: None
    StremioClient.datastore_put = lambda self, auth_key, items: print(f"test server: skipped saving {len(list(items))} items to Stremio")
    StremioClient.logout = lambda self, auth_key: None


if __name__ == "__main__":
    main()
