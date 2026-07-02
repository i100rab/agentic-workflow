# Deploying on fresh OCI infrastructure

This provisions a new compute instance, deploys the web console (real
agents + the optimizer library) on it with HTTPS and username/password
login, verifies it end to end, and only then removes the old VM.

**Order matters here and deliberately doesn't match the order you asked
for.** OCI's free-tier ARM capacity ("out of host capacity" errors) is
unreliable right now, and free-tier ARM limits were just halved in
mid-June 2026. If the old VM is deleted first and the new one fails to
provision, you're left with nothing running. Provisioning the new instance
first costs nothing extra and removes that risk entirely.

---

## Part 0 — Which shape to use

**Decided: VM.Standard.E2.1.Micro (AMD)**, since A1.Flex hit "out of host
capacity" in the available availability domain. 1/8 OCPU, 1 GB RAM — the
same constrained shape as the old VM, so Part 4's swapfile step is now
required, not optional, and the rest of this guide assumes this shape.

---

## Part 1 — Provision the new instance

In the OCI Console:

`Compute → Instances → Create Instance`

- **Name:** something identifiable, e.g. `agentic-workflow-vm`
- **Image:** Oracle Linux 9 (this is what got selected — SELinux and
  firewalld are active by default on this image, both covered in Part 8)
- **Shape:** Change shape → Ampere → VM.Standard.A1.Flex → set 1 OCPU / 6 GB
  (see Part 0)
- **Networking:** create a new VCN if you don't want to reuse the old one —
  the wizard's "Create new virtual cloud network" default option handles
  the VCN, subnet, internet gateway, and route table for you
- **SSH keys:** generate a new pair or reuse an existing one:
  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/oci-agentic-workflow
  ```
  Paste the contents of the `.pub` file into the console's SSH key field.
- Click **Create**, and note the public IP once it's running.

If you hit "out of host capacity": change the availability domain dropdown
and retry, or switch region if you have a preferred nearby one, or fall
back to E2.1.Micro per Part 0.

---

## Part 2 — Networking: Security List

`Networking → Virtual Cloud Networks → (your new VCN) → Security Lists → Default Security List`

Add ingress rules if they're not already present from the wizard:

- TCP 22 (SSH) — usually added automatically
- TCP 80 (HTTP) — needed for Let's Encrypt and the redirect to HTTPS
- TCP 443 (HTTPS) — the actual app traffic

Source CIDR `0.0.0.0/0` for both, matching destination port.

---

## Part 3 — SSH in and confirm the VM is reachable

```bash
ssh -i ~/.ssh/oci-agentic-workflow opc@<new-public-ip>
```

(Username is `opc` for Oracle Linux images.)

---

## Part 4 — Base setup

You're on E2.1.Micro (1 GB RAM) — the swapfile below isn't optional this
time, skipping it is what caused the OOM issue on the old VM. Do this
before installing anything else:

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h   # confirm swap shows up before continuing
```

Node.js — use the binary tarball, not the NodeSource script or dnf module.
It's the difference between copying pre-built binaries into place versus
`dnf` resolving and staging a full dependency tree, which is the kind of
memory pressure that caused trouble last time on this exact shape:

```bash
cd ~
wget https://nodejs.org/dist/latest-v20.x/node-v20.*-linux-x64.tar.xz
tar -xf node-v20.*-linux-x64.tar.xz
sudo cp -r node-v20.*-linux-x64/{bin,lib,include,share} /usr/local/
node -v
```

Install nginx, certbot, and htpasswd's package (`httpd-tools`, not
`apache2-utils` on this OS family):

```bash
sudo dnf install -y nginx httpd-tools
sudo dnf install -y oracle-epel-release-el9
sudo dnf install -y certbot python3-certbot-nginx
sudo systemctl enable --now nginx
```

If `oracle-epel-release-el9` isn't found (package names shift between OL
point releases), run `sudo dnf search epel-release` to find the correct
name for your image, or install certbot via snap as a fallback:
```bash
sudo dnf install -y snapd
sudo systemctl enable --now snapd.socket
sudo ln -s /var/lib/snapd/snap /snap
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
```

---

## Part 5 — Get the code

The repo needs pushing first — see Part 11. Once it's on GitHub:

```bash
cd ~
git clone https://github.com/i100rab/agentic-workflow.git
cd agentic-workflow
npm install --production
```

---

## Part 6 — Environment variables

```bash
cp .env.example .env
nano .env
```

Set:
```
ANTHROPIC_API_KEY=sk-ant-...
OPTIMIZE=true
APP_USERNAME=saurabh
APP_PASSWORD=pick-something-real
```

`OPTIMIZE=true` is what routes every agent through the caching +
compression wrapper for the live demo. Leave it unset for a raw comparison
run if you want to show the difference live.

`APP_USERNAME`/`APP_PASSWORD` is the login for the app itself, checked
only when someone starts a run, not on page load. Given nano's paste
behavior has bitten us before on this VM, use `echo` to append these two
lines instead of editing them by hand if you want to be safe:
```bash
echo "APP_USERNAME=saurabh" >> .env
echo "APP_PASSWORD=pick-something-real" >> .env
```

---

## Part 7 — Run persistently with pm2

```bash
sudo npm install -g pm2
pm2 start server.js --name agentic-workflow-web
pm2 save
pm2 startup
```

Run the command `pm2 startup` prints, so it survives a reboot. Confirm it's
up:

```bash
curl -I http://localhost:3001
```

---

## Part 8 — nginx: HTTPS

Login now happens inside the app itself (Part 6 covers setting
`APP_USERNAME`/`APP_PASSWORD` in `.env`), not at the nginx layer. The page
loads freely; login is only checked when someone actually starts a run.
That's a deliberate change from the previous setup, and it's also required
technically: the live progress stream (Server-Sent Events) can't carry a
custom Authorization header the way `auth_basic` needs, so a real app-level
session was the correct fix, not a nginx-level password prompt.

If you're updating a VM that previously had `auth_basic` configured, remove
it and the `.htpasswd` file, nginx should only handle TLS and proxying now.

The new public IP gives you a fresh sslip.io hostname automatically — no
DNS setup needed, since sslip.io just resolves `<ip-with-dashes>.sslip.io`
back to that IP. If your new IP is e.g. `140.238.12.34`, your hostname is
`140-238-12-34.sslip.io`.

**Get the certificate:**

```bash
sudo certbot certonly --nginx -d 140-238-12-34.sslip.io
```

(Replace with your actual dash-formatted IP.)

**nginx config**, save as `/etc/nginx/sites-available/agentic-workflow`:

```nginx
server {
    listen 443 ssl;
    server_name 140-238-12-34.sslip.io;

    ssl_certificate     /etc/letsencrypt/live/140-238-12-34.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/140-238-12-34.sslip.io/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # SSE stream needs buffering off, or live progress won't appear live
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
    server_name 140-238-12-34.sslip.io;
    return 301 https://$host$request_uri;
}
```

Enable it and reload:

```bash
sudo ln -s /etc/nginx/sites-available/agentic-workflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

**Firewall (firewalld, active by default on Oracle Linux):**

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

**SELinux** — active by default and will block nginx from proxying to the
Node app unless told otherwise, same issue as the old VM:

```bash
sudo setsebool -P httpd_can_network_connect 1
```

---

## Part 9 — Verify end to end

1. Visit `https://140-238-12-34.sslip.io` (your actual hostname) — browser
   should show a valid padlock, no certificate warning, and the page should
   load directly with no login prompt yet.
2. Enter a topic and a budget cap, click Start run. This is where login
   should appear now, not before, since starting a run is the first thing
   that actually needs it.
3. Log in with the `APP_USERNAME`/`APP_PASSWORD` from `.env`. The run
   should start immediately after, no need to click Start run again.
4. Watch the six agents progress live.
5. Check `pm2 logs agentic-workflow-web` if anything looks wrong.

Don't move to Part 10 until this all genuinely works.

---

## Part 10 — Now remove the old VM

`Compute → Instances → (old instance) → Terminate`

You'll be asked whether to also delete the attached boot volume — fine to
delete it once the new deployment is confirmed working, since there's
nothing on it you need anymore.

---

## Part 11 — Push the code to GitHub

This needs to happen before Part 5, but is last here since it's the one
step outside the VM. Generate a fresh fine-grained personal access token
(Settings → Developer settings → Personal access tokens → Fine-grained
tokens, scoped to this repo only, Contents: Read and write) and send it
over — I'll push directly, then you revoke it. This is what makes the
optimizer library, the web console, and the support-triage example
actually available to pull down and hand to leadership as a real,
version-controlled deliverable.
