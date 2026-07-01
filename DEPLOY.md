# Deploying the Agentic Workflow Web Console on OCI

This replaces the previous "ANZ Strategic Advisory Deals" dashboard on your
existing OCI Always Free compute instance with the new live agent console.
Same VM, same general pattern (nginx in front, Node app behind it, HTTPS via
Let's Encrypt), new application.

Request flow once this is live:

```
Browser → OCI Security List (80/443) → nginx (TLS + Basic Auth) → pm2/Node on :3001 → Anthropic API
```

---

## Part 1 — OCI resources: what you need

You already have the compute instance from the previous dashboard, so this
is mostly verification, not provisioning.

**Compute instance.** The Always Free shape (VM.Standard.E2.1.Micro or
VM.Standard.A1.Flex on the Ampere free tier) you're already running. No
change needed here.

**VCN Security List.** This is the one thing worth re-checking before you
start, since it's the most common cause of "it deployed fine but I can't
reach it." In the OCI Console:

`Networking → Virtual Cloud Networks → (your VCN) → Security Lists → Default Security List`

Confirm ingress rules exist for:
- TCP 22 (SSH) — should already be there
- TCP 80 (HTTP) — needed for Let's Encrypt's renewal challenge and the redirect to HTTPS
- TCP 443 (HTTPS) — the actual app traffic

If 80/443 aren't listed, add them (source CIDR `0.0.0.0/0`, destination port
range matching each).

**Nothing else.** No load balancer, no Object Storage, no database — this
app is a single Node process with in-memory state, so the VM is the whole
stack. If you later want run history to survive a restart, that's a future
add (SQLite on the same VM would be the lightest option), not something
needed for a live demo.

---

## Part 2 — Get the code onto GitHub

The web console code isn't pushed yet. Fastest path: generate a fresh
fine-grained personal access token the same way as before (Settings →
Developer settings → Personal access tokens → Fine-grained tokens, scoped
to just this repo, Contents: Read and write) and send it over, and I'll
push directly. Revoke it again once it's done.

If you'd rather not, unzip the project bundle directly on the VM once
you're SSHed in (Part 6 below covers this) and push from there instead —
that avoids sharing a token with me at all.

---

## Part 3 — SSH into the VM

```bash
ssh <your-user>@<your-oci-public-ip>
```

---

## Part 4 — Remove the old dashboard completely

Don't guess at how it was left running — check directly.

```bash
# Running under pm2?
pm2 list

# A systemd service?
systemctl list-units --type=service --all | grep -i -E "dashboard|node|express"

# What's actually listening on web ports?
sudo ss -tlnp | grep -E ":80|:443|:3000|:3001|:5000|:8080"
```

Stop whatever shows up:

```bash
pm2 delete <old-process-name>
# or
sudo systemctl stop <old-service-name>
sudo systemctl disable <old-service-name>
```

Remove the old nginx server block:

```bash
ls /etc/nginx/sites-enabled/
ls /etc/nginx/conf.d/
sudo rm /etc/nginx/sites-enabled/old-dashboard.conf   # adjust filename
sudo nginx -t
sudo systemctl reload nginx
```

Move the old app folder aside rather than deleting outright, until the new
one is confirmed working:

```bash
cd ~
mv old-dashboard-folder old-dashboard-folder.bak
```

---

## Part 5 — Prepare the Node.js environment

The OOM issue last time was fixed with the Node binary tarball plus a
swapfile. If that swapfile is still active, skip to the version check. If
you're unsure:

```bash
swapon --show
free -h
```

If nothing shows under swap, recreate it (2GB is enough for this app):

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Confirm Node is available and reasonably current (v18+):

```bash
node -v
```

If it's missing or too old, install via the binary tarball approach that
worked before rather than a package manager, to sidestep the OOM issue
during compilation:

```bash
cd ~
wget https://nodejs.org/dist/latest-v20.x/node-v20.*-linux-x64.tar.xz
tar -xf node-v20.*-linux-x64.tar.xz
sudo cp -r node-v20.*-linux-x64/{bin,lib,include,share} /usr/local/
node -v
```

---

## Part 6 — Get the code onto the VM

If Part 2 is done and the repo is pushed:

```bash
cd ~
git clone https://github.com/i100rab/agentic-workflow.git
cd agentic-workflow
```

If you already have a clone from earlier, `git pull` instead. If you're
pushing from the VM itself instead of via GitHub, unzip the bundle here,
`cd` into it, and run `git remote add origin ...` / `git push` as covered
earlier, then continue below.

---

## Part 7 — Install dependencies

```bash
npm install --production
```

No frontend build step here (the console is plain HTML/JS, no React/Vite),
so this should be lighter and faster than the old dashboard's install.

---

## Part 8 — Configure environment variables

```bash
cp .env.example .env
nano .env
```

Paste in `ANTHROPIC_API_KEY=sk-ant-...` and save.

---

## Part 9 — Run it persistently with pm2

```bash
sudo npm install -g pm2
pm2 start server.js --name agentic-workflow-web
pm2 save
pm2 startup
```

`pm2 startup` prints a command tailored to your system, run it as instructed
so the app survives a VM reboot.

The app listens on port 3001 by default. Confirm it's up before touching
nginx:

```bash
curl -I http://localhost:3001
```

You should see a `200 OK`.

---

## Part 10 — nginx reverse proxy

The one real difference from the old dashboard: this app streams live
progress over Server-Sent Events, and nginx buffers responses by default,
which makes the stream appear frozen until it's fully buffered. The config
below explicitly disables buffering on that route.

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

Save this as `/etc/nginx/sites-available/agentic-workflow.conf` (or
`conf.d/` depending on your distro) and symlink/enable it if your distro
requires that step.

Reuse the existing cert if the hostname is unchanged. If it's a new
hostname, issue a fresh one:

```bash
sudo certbot --nginx -d your-new-hostname.sslip.io
```

Reuse the old `.htpasswd` for the same login, or create a new one:

```bash
sudo htpasswd -c /etc/nginx/.htpasswd yourusername
```

Test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Part 11 — VM-level firewall (separate from the OCI Security List)

The Security List controls traffic at the OCI network layer, but the VM's
own OS firewall can independently block the same ports. This has caught
people out before on OCI specifically, since Oracle Linux images ship with
`firewalld` active by default.

Check which firewall (if any) is active:

```bash
sudo systemctl status firewalld    # Oracle Linux / RHEL-based
sudo ufw status                    # Ubuntu
```

If `firewalld` is active, open the ports:

```bash
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload
```

If `ufw` is active:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

If nginx couldn't reach the Node app specifically (distinct from the
browser not reaching nginx), that's usually SELinux rather than the
firewall, same fix as before:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

---

## Part 12 — Verify end to end

1. Visit `https://your-hostname.sslip.io` — you should hit the Basic Auth
   prompt first.
2. After logging in, you should see the console: topic field, budget cap,
   "Start run" button.
3. Enter a topic, set a cap (start generous, e.g. $0.50, so you see a full
   successful run before testing the governor), click Start.
4. Watch the pipeline panel move through Researcher → Assessor → Writer →
   Responsible AI check → Human approval in real time, with real cost per
   stage.
5. Approve or send back feedback when prompted.
6. Lower the cap and run again to confirm the governor actually halts a run.

---

## Part 13 — Cleanup and maintenance

Once you've confirmed everything works, remove the old dashboard's backup:

```bash
rm -rf ~/old-dashboard-folder.bak
```

To update after future pushes:

```bash
cd ~/agentic-workflow
git pull
npm install --production
pm2 restart agentic-workflow-web
```

To check logs if something misbehaves during a live demo:

```bash
pm2 logs agentic-workflow-web
```
