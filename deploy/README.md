# Deployment examples

> 中文版: [README.zh-CN.md](README.zh-CN.md)

Two annotated starting points:

| File | What it configures |
|---|---|
| [`nginx.conf.example`](nginx.conf.example) | An nginx site that serves the built clients and proxies `/api` and `/socket.io` to the application |
| [`kitterhub-backend.service.example`](kitterhub-backend.service.example) | A systemd unit that runs the back end as an unprivileged user |

Both are **examples, written for a generic host**. Every domain is `example.com` and every address is a placeholder — replace them with your own.

## Using the nginx example

1. Copy it to your nginx sites directory and replace every `example.com` with your domain.
2. Point the static roots at your built clients (`frontend/dist`, `frontend-se/dist`).
3. Keep `proxy_pass` targeting localhost (`127.0.0.1:8000`) — the application should not be reachable directly.
4. Test before reloading, always:

```bash
nginx -t && systemctl reload nginx
```

If `nginx -t` fails, **do not reload** — fix the file first. A broken configuration that has not been loaded is harmless; one that has been loaded takes the site down.

## Warnings worth repeating

- **Never serve `backend/private/`.** That directory holds identity documents. The example configuration contains an explicit comment about this; keep it.
- Keep `NIMAO_DOCS=0` in production so the OpenAPI documentation is not public.
- Terminate TLS and redirect HTTP to HTTPS. The example includes the redirect block.
- Run the service as an unprivileged user with write access only to what it needs (database, uploads, pages root).
- Upload directories should be served with a restrictive policy: no directory listing, no execution.

## Using the systemd example

```ini
[Service]
User=kitterhub
WorkingDirectory=/srv/kitterhub/backend
EnvironmentFile=/etc/kitterhub/backend.env
ExecStart=/srv/kitterhub/backend/.venv/bin/python run.py
Restart=always
```

Put `NIMAO_SECRET_KEY` and the rest in `EnvironmentFile=` rather than a `.env` file on disk where you can avoid it — the file must then be readable by the service user only (`chmod 600`).

```bash
systemctl daemon-reload
systemctl enable --now kitterhub-backend
systemctl status kitterhub-backend
journalctl -u kitterhub-backend -n 50
```

## After deploying

```bash
curl -I https://example.com/                      # expect 200
curl -s -o /dev/null -w '%{http_code}\n' https://example.com/api/discover/home   # expect 200
curl -I https://example.com/assets/…              # expect 200 with a JS/CSS content type
```

If static assets return 404 or 403 right after a copy, it is almost always file permissions — `chmod -R a+rX` on the web root, then reload nginx.
