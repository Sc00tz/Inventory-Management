# ScanBin

A self-hosted home inventory system with barcode scanning. Create named storage locations (bins, shelves, fridges, pantries), scan product barcodes to track quantities, and print QR code labels so any location can be opened instantly from a phone or handheld scanner.

---

## Features

- **Hierarchical locations** — nest rooms → shelves → bins to any depth
- **Barcode scanning** — hardware scanners (USB/Bluetooth HID) and camera-based scanning both supported
- **Automatic product lookup** — scans checked against Open Food Facts, Open Beauty Facts, and UPC Item DB
- **QR code labels** — each location gets a short URL you can print and stick on the box
- **Inventory tracking** — quantities stored per product per location; tap +/− or type directly
- **Product catalog** — searchable list of all known products across all locations

---

## Requirements

- **Docker + Docker Compose** (recommended) — no other dependencies needed
- **Node.js 22+** for running locally without Docker

---

## Quick start (Docker)

There are two ways to run ScanBin with Docker: **pull the prebuilt image** (fastest — no build step) or **build from source**.

### Option A — Pull the prebuilt image (recommended)

A multi-arch image (`linux/amd64` + `linux/arm64`) is published to the GitHub Container Registry on every push to `main`. Use the `docker-compose.pull.yml` in this repo, which pulls the image instead of building it:

```bash
git clone https://github.com/Sc00tz/Inventory-Management.git
cd Inventory-Management
docker compose -f docker-compose.pull.yml up -d
```

Or, without cloning at all, drop this `docker-compose.yml` on your host and run `docker compose up -d`:

```yaml
services:
  app:
    image: ghcr.io/sc00tz/inventory-management:latest
    ports:
      - "4000:4000"
    volumes:
      - inventory_data:/data
    restart: unless-stopped

volumes:
  inventory_data:
```

**Available tags:**

| Tag | Points to |
|-----|-----------|
| `latest` | Newest build from `main` |
| `main` | Same as `latest` |
| `1.2`, `1.2.3` | Release builds (created when a `v*` git tag is pushed) |
| `sha-<short>` | A specific commit, for pinning |

> **Note:** The GHCR package is private by default. Either make it public (repo → **Packages** → **Package settings** → **Change visibility → Public**) so `docker pull` works anonymously, or authenticate first with `docker login ghcr.io` using a personal access token that has the `read:packages` scope.

### Option B — Build from source

```bash
git clone https://github.com/Sc00tz/Inventory-Management.git
cd Inventory-Management
docker compose up -d
```

Open **http://localhost:4000** in your browser.

Data is stored in a named Docker volume (`inventory_data`) and persists across restarts and image updates.

> **Tip:** To expose ScanBin on your local network so phones and tablets can reach it, map the port to `0.0.0.0`:
> ```yaml
> ports:
>   - "0.0.0.0:4000:4000"
> ```

---

## Local development

Install dependencies, then start the client dev server and API server together:

```bash
npm install
npm run dev
```

| Process | URL |
|---------|-----|
| Vite (React, HMR) | http://localhost:4000 |
| Express API | http://localhost:3001 |

The Vite dev server proxies all `/api/*` requests to the Express server at port 3001, so everything is reachable through port 4000.

You can also run them separately:

```bash
npm run dev:client   # Vite on :4000
npm run dev:server   # Express on :3001
```

The database is created at `/data/inventory.db` by default. Override with the `DB_PATH` environment variable:

```bash
DB_PATH=./local.db npm run dev:server
```

### Building for production

```bash
npm run build        # compiles frontend into ./dist
node server.js       # serves dist/ + API on PORT (default 4000)
```

---

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Port the server listens on |
| `DB_PATH` | `/data/inventory.db` | Path to the SQLite database file |
| `UPCDATABASE_API_KEY` | _(unset)_ | Optional free key from [upcdatabase.org](https://upcdatabase.org) for general-merchandise barcode coverage — see below |

### Barcode lookup sources

When you scan an unknown barcode, the server resolves it against several free product databases in order:

1. **Open Food Facts** — food & drink
2. **Open Beauty Facts** — cosmetics & personal care
3. **Open Products Facts** — general products in the Open*Facts project
4. **UPCdatabase.org** — broad general-merchandise coverage *(only if `UPCDATABASE_API_KEY` is set)*
5. **UPCitemdb** (trial) — general fallback, ~100 lookups/day

The Open*Facts databases (1–3) are free and need no key, but they mostly cover food and cosmetics. For **electronics, tools, toys, and household goods**, register for a free key at [upcdatabase.org](https://upcdatabase.org) (free tier: 100 lookups/day) and set `UPCDATABASE_API_KEY`. Copy [`.env.example`](.env.example) to `.env` and fill it in — `docker compose` picks it up automatically. Lookups still work without a key; you'll just get fewer matches on non-food items.

---

## Docker reference

### Production

```bash
# Start (detached)
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

**Updating to the latest version:**

```bash
# If using the prebuilt image (Option A)
docker compose -f docker-compose.pull.yml pull
docker compose -f docker-compose.pull.yml up -d

# If building from source (Option B)
docker compose down
docker compose build --no-cache
docker compose up -d
```

Your data lives in the `inventory_data` volume and is untouched by updates.

### Development (with live reload)

```bash
docker compose -f docker-compose.dev.yml up
```

The dev compose mounts the project directory into the container, so code changes are reflected without rebuilding.

### Backup & restore

The database lives in the `inventory_data` Docker volume. To back it up:

```bash
# Backup
docker run --rm -v inventory_data:/data -v $(pwd):/backup alpine \
  cp /data/inventory.db /backup/inventory-backup.db

# Restore
docker run --rm -v inventory_data:/data -v $(pwd):/backup alpine \
  cp /backup/inventory-backup.db /data/inventory.db
```

---

## Continuous builds & releases

Pushes to `main` trigger the [`docker-publish.yml`](.github/workflows/docker-publish.yml) GitHub Actions workflow, which builds the multi-arch image and pushes it to GHCR as `latest` / `main` / `sha-<short>`. No secrets are required — it authenticates with the built-in `GITHUB_TOKEN`.

To cut a versioned release, push a git tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

This publishes `ghcr.io/sc00tz/inventory-management:1.2.3` and `:1.2` in addition to `latest`. You can also trigger a build manually from the repo's **Actions** tab (**Run workflow**).

---

## Usage guide

### 1. Create locations

Click **New Location** on the home page. Give it a name, pick a type (room, shelf, bin, fridge, etc.), an optional parent location, and a colour. Locations can be nested to any depth — e.g. *Kitchen* → *Pantry* → *Top Shelf*.

### 2. Print QR labels

Open a location and click the **QR** icon in the top-right. You'll see a short URL (e.g. `http://192.168.1.x:4000/l/a1b2c3d4`) and a QR code. Print or screenshot it and stick it on the physical location.

### 3. Scan a location

On the home page, point a camera or hardware scanner at a location QR code. The app navigates straight to that location.

### 4. Add products

Inside a location, scan a product barcode. If the product is already known, quantity goes up by 1. If it's new, ScanBin looks it up across three databases and pre-fills the name and brand — just confirm or edit and save.

You can also tap **Add manually** to pick from the existing product catalog without scanning.

### 5. Adjust quantities

Tap **−** or **+** on any inventory row to adjust by 1. Tap the quantity number itself to type an exact value. Setting a quantity to 0 removes the item from that location.

### 6. Product catalog

The **Products** page lists every product ScanBin has ever seen. You can search by name, brand, or barcode, edit details, or delete products you no longer need.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, TanStack Router, TanStack Query |
| Styling | Tailwind CSS, `@blinkdotnew/ui` component library |
| Barcode scanning | ZXing (camera), native HID (hardware scanners) |
| Backend | Express 4, Node.js 22+ |
| Database | SQLite via `node:sqlite` (built-in Node module) |
| Build | Vite 8 |
| Container | Docker, Docker Compose |

---

## API reference

All endpoints are prefixed with `/api`.

### Locations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/locations` | List all locations |
| `GET` | `/locations/:id` | Get a location by ID |
| `GET` | `/locations/short/:shortId` | Resolve a UUID prefix (QR short link) |
| `GET` | `/locations/barcode/:barcode` | Find a location by its barcode |
| `POST` | `/locations` | Create a location |
| `PUT` | `/locations/:id` | Update a location |
| `DELETE` | `/locations/:id` | Delete a location and all its children + inventory |

### Products

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | List all products |
| `GET` | `/products/barcode/:barcode` | Find a product by barcode |
| `POST` | `/products` | Create a product |
| `PUT` | `/products/:id` | Update a product |
| `DELETE` | `/products/:id` | Delete a product |

### Inventory

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/inventory/:locationId` | Get inventory for a location (includes product data) |
| `GET` | `/inventory-counts` | Get item counts for all locations (single query) |
| `POST` | `/inventory/upsert` | Add/remove by delta — creates or deletes row automatically |
| `PUT` | `/inventory/:id/quantity` | Set exact quantity — deletes row if ≤ 0 |
| `DELETE` | `/inventory/:id` | Remove an inventory entry |

### Utilities

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/qr?url=<url>` | Generate an SVG QR code for a given `http(s)` URL |
| `GET` | `/l/:shortId` | Redirect short QR link to `/locations/:id` |

---

## Project structure

```
├── server.js              # Express API + static file serving
├── src/
│   ├── main.tsx           # React entry point
│   ├── App.tsx            # Router and root layout
│   ├── types.ts           # Shared TypeScript types
│   ├── lib/
│   │   ├── api.ts         # Fetch-based API client
│   │   └── utils.ts       # Tailwind class helper (cn)
│   ├── pages/
│   │   ├── HomePage.tsx   # Location tree + scan-to-open
│   │   ├── LocationPage.tsx  # Inventory management for one location
│   │   └── ProductsPage.tsx  # Product catalog and search
│   └── components/
│       ├── ScanInput.tsx         # Text input with camera button
│       ├── CameraScanner.tsx     # Full-screen camera barcode reader
│       ├── AddProductModal.tsx   # New product form (with auto-lookup)
│       ├── AddItemModal.tsx      # Manual inventory add from product list
│       ├── LocationFormModal.tsx # Create/edit location form
│       └── dialog.tsx            # Dialog wrapper
├── Dockerfile
├── docker-compose.yml         # Production — builds from source
├── docker-compose.pull.yml    # Production — pulls prebuilt GHCR image
├── docker-compose.dev.yml     # Development (live reload)
└── .github/workflows/
    └── docker-publish.yml     # Auto-build & publish image to GHCR
```
