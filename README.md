# Twilio TaskRouter → MySQL (Docker) → Grafana

A real-time contact-center analytics pipeline. Twilio TaskRouter fires a webhook on every `reservation.completed` event; a Node.js server receives the payload and inserts a row into MySQL; Grafana reads that data and visualises it as a live dashboard.

```
Twilio TaskRouter
   │  reservation.completed webhook (POST)
   ▼
Node.js Express server  (port 1500)
   │  /insert  → parse payload → INSERT INTO Call_CX / Chat_CX
   ▼
MySQL 8.0  (Docker, host port 3314 → container 3306)
   │
   ├── phpMyAdmin  (Docker, localhost:8080)   ← schema / admin UI
   │
   └── Grafana  ← MySQL data source via ngrok TCP tunnel
```

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Project Structure](#project-structure)
3. [Docker Setup — MySQL + phpMyAdmin](#docker-setup--mysql--phpmyadmin)
4. [Database & Table Setup](#database--table-setup)
5. [MySQL User Setup](#mysql-user-setup)
6. [Node.js Server](#nodejs-server)
7. [Twilio TaskRouter Webhook](#twilio-taskrouter-webhook)
8. [Grafana — MySQL Data Source via ngrok](#grafana--mysql-data-source-via-ngrok)
9. [Endpoint Reference](#endpoint-reference)
10. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version tested | Purpose |
|------|---------------|---------|
| Docker Desktop | any recent | Run MySQL + phpMyAdmin containers |
| Node.js | 18+ | Express webhook server |
| npm | 9+ | Install dependencies |
| ngrok | v3 | Expose local MySQL over TCP for Grafana |
| Grafana | OSS / Cloud | Dashboard |
| Twilio account | — | TaskRouter workspace with workers |

---

## Project Structure

```
Docker-Mysql-Grafana/
├── docker-compose.yml   # MySQL 8.0 + phpMyAdmin containers
└── mysqlconnect.js      # Express server — receives webhook, writes to MySQL
```

---

## Docker Setup — MySQL + phpMyAdmin

### `docker-compose.yml`

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: mysql_server
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD:         
      MYSQL_DATABASE: 
      MYSQL_USER: 
      MYSQL_PASSWORD:            
    ports:
      - "3314:3306"                    # host 3314 → container 3306
    volumes:
      - mysql_data:/var/lib/mysql
    networks:
      - db_network

  phpmyadmin:
    image: phpmyadmin:latest
    container_name: phpmyadmin_server
    restart: always
    environment:
      PMA_HOST: mysql
      PMA_PORT: 3306
      MYSQL_ROOT_PASSWORD: root
    ports:
      - "8080:80"                      # http://localhost:8080
    depends_on:
      - mysql
    networks:
      - db_network

volumes:
  mysql_data:

networks:
  db_network:
    driver: bridge
```

**Why a custom port (3314)?**  
If you already have a local MySQL instance running on the default `3306`, mapping the container to `3314` avoids a port conflict. The Node.js app connects to `127.0.0.1:3314`.

### Start the containers

```bash
docker compose up -d
```

Verify both containers are running:

```bash
docker compose ps
```

Access phpMyAdmin at **http://localhost:8080** — log in with `root` / `root`.

---

## Database & Table Setup

### 1. Create tables via the `/createtable` endpoint

Once the server is running (see below), call:

```bash
# Creates Call_CX table (voice calls)
curl -X GET http://localhost:1500/createtable
```

To create `Chat_CX`, uncomment the second `sql` block inside `/createtable` in `mysqlconnect.js` and call the endpoint again.

### Table schemas

**`Call_CX`** — populated when `TaskQueueTargetExpression` contains `voice_support`

| Column | Type | Source field |
|--------|------|-------------|
| `time_stamp` | VARCHAR(50) | `req.body.Timestamp` (Unix → UTC string) |
| `agent` | VARCHAR(50) | `req.body.WorkerName` |
| `wksid` | VARCHAR(50) | `req.body.WorkerSid` |
| `call_sid` | VARCHAR(50) | `TaskAttributes.call_sid` |
| `task` | VARCHAR(50) | `req.body.TaskSid` |
| `phoneno` | VARCHAR(20) | `TaskAttributes.caller` |

**`Chat_CX`** — all other queues (chat / messaging)

| Column | Type | Source field |
|--------|------|-------------|
| `time_stamp_ch` | VARCHAR(50) | `req.body.Timestamp` (Unix → UTC string) |
| `agent_ch` | VARCHAR(50) | `req.body.WorkerName` |
| `wksid_ch` | VARCHAR(50) | `req.body.WorkerSid` |
| `chat_ch` | VARCHAR(50) | `TaskAttributes.conversationSid` |
| `task_ch` | VARCHAR(50) | `req.body.TaskSid` |
| `phoneno` | VARCHAR(20) | `TaskAttributes.customerAddress` |

---

## MySQL User Setup

Two users are configured — one for the app, one for Grafana (read-only).

### App user — full access on `simran` schema

Run from your terminal (Docker Compose must be up):

```bash
docker compose exec -T mysql mysql -uroot -p"root" \
  -e "GRANT ALL ON simran.* TO 'simran'@'%';"
```

### Grafana user — SELECT only

Log in to phpMyAdmin as `root` (http://localhost:8080) and run the following in the SQL tab:

```sql
CREATE USER 'grafanaReader' IDENTIFIED BY 'password';
GRANT SELECT ON simran.Call_CX TO 'grafanaReader';
GRANT SELECT ON simran.Chat_CX TO 'grafanaReader';
```

> **Why a separate Grafana user?**  
> The `grafanaReader` account is restricted to `SELECT` on only the two reporting tables. This means Grafana can never modify data even if credentials are exposed.

> **Why didn't logging into phpMyAdmin with `simran` work?**  
> phpMyAdmin requires `mysql_native_password` authentication by default. MySQL 8 uses `caching_sha2_password` for new users. Logging in as `root` bypasses this for admin tasks.

---

## Node.js Server

### Install dependencies

```bash
npm install express mysql2
```

### Configure credentials

Open `mysqlconnect.js` and fill in the connection block:

```js
const connection = mysql.createConnection({
  host: "127.0.0.1",
  port: '3314',          // custom host port from docker-compose
  user: "simran",
  password: "simran",
  database: 'simran',
});
```

### Start the server

```bash
node mysqlconnect.js
# Server running at http://localhost:1500
# Connected!
```

---

## Twilio TaskRouter Webhook

### What event to listen for

Configure a **Workspace Event Callback** or **Workflow Event Callback** in the [Twilio Console](https://console.twilio.com) → TaskRouter → your Workspace → Settings → Event Callbacks.

- **Event**: `reservation.completed`
- **Method**: `POST`
- **URL**: your public URL + `/insert`  
  e.g. `https://your-ngrok-url.ngrok.io/insert` (use an HTTP ngrok tunnel for the Node.js server)

### How the payload is routed

The `/insert` handler reads `req.body.TaskQueueTargetExpression`. If the value includes the string `voice_support`, the row goes into `Call_CX`; otherwise it goes into `Chat_CX`.

```
reservation.completed payload
  └── TaskQueueTargetExpression contains "voice_support" ?
        ├── yes → INSERT INTO Call_CX
        └── no  → INSERT INTO Chat_CX
```

### Key payload fields used

```
EventType                  → "reservation.completed"
TaskQueueTargetExpression  → routing decision (voice vs chat)
WorkerName                 → agent display name
WorkerSid                  → agent unique SID
TaskSid                    → task unique SID
Timestamp                  → Unix epoch → converted to UTC string
TaskAttributes             → JSON string, parsed for call_sid / caller /
                             conversationSid / customerAddress
```

---

## Grafana — MySQL Data Source via ngrok

MySQL uses raw TCP — not HTTP — so a standard HTTP ngrok tunnel will not work. You need an **ngrok TCP tunnel**.

### Step 1 — Start an ngrok TCP tunnel on port 3314

```bash
ngrok tcp 3306
```

ngrok will output a forwarding address such as:

```
Forwarding  tcp://0.tcp.in.ngrok.io:14597 -> localhost:3306
```

> **Note:** ngrok maps `localhost:3306` (the default MySQL port). Because Docker's port mapping already translates host `3314` → container `3306`, you can also run `ngrok tcp 3314` and it works the same way — just keep whichever you ran and use that port in Grafana.

### Step 2 — Add MySQL data source in Grafana

1. Open Grafana → **Connections** → **Add new data source** → **MySQL**
2. Fill in the fields:

| Field | Value |
|-------|-------|
| Host URL | `0.tcp.in.ngrok.io:14597` (use your actual ngrok hostname + port) |
| Database | `` |
| User | `grafanaReader` |
| Password | `password` |
| TLS/SSL Mode | `disable` (ngrok handles the outer transport) |

3. Click **Save & Test** — you should see "Database Connection OK".

> **Why ngrok TCP and not HTTP?**  
> MySQL's wire protocol is binary TCP (not HTTP). ngrok's HTTP tunnels only forward HTTP/HTTPS traffic and cannot relay a MySQL handshake. `ngrok tcp` creates a raw passthrough so Grafana's MySQL driver can complete the full connection.

### Step 3 — Build a dashboard

Use the Grafana query editor against the `simran` data source. Example queries:

```sql
-- Calls per agent today
SELECT agent, COUNT(*) AS calls
FROM Call_CX
WHERE time_stamp >= DATE(NOW())
GROUP BY agent;

-- Chat volume over time (last 24 h)
SELECT time_stamp_ch AS time, COUNT(*) AS chats
FROM Chat_CX
WHERE time_stamp_ch >= NOW() - INTERVAL 24 HOUR
GROUP BY time_stamp_ch
ORDER BY time_stamp_ch;
```

Reference: https://grafana.com/docs/grafana/latest/datasources/mysql/

---

## Endpoint Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/check` | Sanity check — queries `userstable` and returns 200 if connected |
| `GET/POST` | `/createtable` | Creates `Call_CX` (or `Chat_CX` when uncommented) if not exists |
| `POST` | `/insert` | Receives TaskRouter `reservation.completed` payload and inserts into the correct table |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ECONNREFUSED 127.0.0.1:3314` | MySQL container not running | `docker compose up -d` |
| `ER_ACCESS_DENIED_ERROR` | Wrong credentials in `mysqlconnect.js` | Match `user`/`password` to docker-compose env vars |
| Grafana "connection refused" | ngrok TCP tunnel not running | `ngrok tcp 3306` and update the host URL in Grafana |
| Grafana "host not found" | Stale ngrok URL | Free ngrok URLs change each restart — update the data source host after each `ngrok tcp` restart |
| phpMyAdmin login fails with `simran` user | `caching_sha2_password` auth plugin | Use `root` for phpMyAdmin admin tasks; `simran` works fine from Node.js via `mysql2` |
| `/insert` returns 500 | Table does not exist | Hit `/createtable` first |
| Row goes to wrong table | `TaskQueueTargetExpression` does not contain `voice_support` | Verify the queue expression in your TaskRouter workflow |
