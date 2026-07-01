# Deploying the web console to OCI

This replaces the previous "ANZ Strategic Advisory Deals" dashboard on the
same Always Free VM. The agents themselves (`src/agents/*.js`) are untouched
from the GitHub version — this only adds `server.js` and `web/` on top.

## 0. Remove the old dashboard first

SSH into the VM and stop whatever was serving the old React/Express dashboard
(pm2 process, systemd service, or manual node process — whichever you used).
Free up the port it was running on, and remove or comment out its nginx
server block so it doesn't conflict with the new one below.

## 1. Get the code onto the VM

```bash
cd ~
git clone https://github.com/i100rab/agentic-workflow.git
cd agentic-workflow
```

If you already have a local clone from before, `git pull` instead.

## 2. Install dependencies

Same Node setup that fixed the OOM issue last time (binary tarball + swapfile)
applies here too — this project is lighter than the Vite-based dashboard
since there's no frontend build step, but keep the swapfile in place regardless:

```bash
npm install --production
```

## 3. Add your API key

```bash
cp .env.example .env
nano .env   # paste your ANTHROPIC_API_KEY
```

## 4. Keep it running with pm2

```bash
npm install -g pm2
pm2 start server.js --name agentic-workflow-web
pm2 save
pm2 startup   # follow the printed instructions to survive reboots
```

The app listens on port 3001 by default (override with `PORT=xxxx` in `.env`).

## 5. nginx reverse proxy

This is the one place this setup differs from the old dashboard: the live
console uses Server-Sent Events (SSE) for the progress stream, and nginx
buffers responses by default, which will make the stream appear to hang
until it's fully buffered. Two things fix that.

Create (or edit) the server block, reusing whatever domain/sslip.io hostname
and certbot cert you had for the old dashboard:

```nginx
server {
    listen 443 ssl;
    server_name your-existing-hostname.sslip.io;

    ssl_certificate     /etc/letsencrypt/live/your-existing-hostname.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-existing-hostname.sslip.io/privkey.pem;

    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # SSE stream needs buffering off, or progress won't appear live
    location /api/runs/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
    }
}

server {
    listen 80;
    server_name your-existing-hostname.sslip.io;
    return 301 https://$host$request_uri;
}
```

Reuse the same `.htpasswd` file from the old dashboard if you want the same
login, or generate a new one:

```bash
sudo htpasswd -c /etc/nginx/.htpasswd yourusername
```

Then:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

If nginx can't reach the app (SELinux blocking the proxy, same issue as
before):

```bash
sudo setsebool -P httpd_can_network_connect 1
```

No new OCI Security List rule should be needed if 443/80 are already open
from the previous setup.

## 6. Verify

Visit `https://your-existing-hostname.sslip.io`, log in with Basic Auth,
enter a topic, set a budget cap, and start a run. Watch the pipeline panel
light up stage by stage in real time.

## Updating later

```bash
cd ~/agentic-workflow
git pull
npm install --production
pm2 restart agentic-workflow-web
```
