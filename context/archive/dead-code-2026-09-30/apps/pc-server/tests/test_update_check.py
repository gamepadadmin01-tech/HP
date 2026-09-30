"""Does 1.1.15 reach the backend? Calls the shipped check_for_update() verbatim."""
import importlib.util, os, sys, time

spec = importlib.util.spec_from_file_location("srv", os.path.join(os.path.dirname(__file__), "server.py"))
srv = importlib.util.module_from_spec(spec)
sys.modules["srv"] = srv
spec.loader.exec_module(srv)

print(f"APP_VERSION      : {srv.APP_VERSION}")
print(f"UPDATE_MANIFEST  : {srv.UPDATE_MANIFEST_URL}")
t0 = time.time()
r = srv.check_for_update(timeout=20, retries=1)
print(f"elapsed          : {time.time() - t0:.2f}s")
print("-" * 60)
for k in ("error", "kind", "latest", "available", "url", "notes"):
    print(f"  {k:10}: {r.get(k)}")
print("-" * 60)
print("VERDICT: BACKEND REACHED OK" if r.get("error") is None else f"VERDICT: FAILED ({r.get('kind')}) {r.get('error')}")
