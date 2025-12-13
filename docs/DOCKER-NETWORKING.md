# Docker Networking Guide

How to connect the PageXML Viewer Docker container to Ollama on your host machine across different platforms.

## The Problem

When running the viewer in Docker, the container needs to reach Ollama running on your **host machine**. The challenge is that `localhost` inside a container refers to the container itself, not your host.

## Platform-Specific Solutions

### ✅ Cross-Platform (Recommended)

The main `docker-compose.yml` now works on all platforms using `extra_hosts`:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

This maps `host.docker.internal` to your host machine's IP on **all platforms** (Docker 20.10+).

**Usage:**
```bash
# Works on Windows, Mac, and Linux
docker compose up
```

---

### Windows Specific

**Native support:** `host.docker.internal` works out of the box.

**Docker Desktop for Windows:**
```yaml
OLLAMA_BASE_URL: "http://host.docker.internal:11434"
```

---

### macOS Specific

**Native support:** `host.docker.internal` works out of the box.

**Docker Desktop for Mac:**
```yaml
OLLAMA_BASE_URL: "http://host.docker.internal:11434"
```

---

### Linux Specific

**Three options:**

#### Option 1: Use the Cross-Platform Setup (Recommended)

The main `docker-compose.yml` now includes:
```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

This works on Docker 20.10+ and maps `host.docker.internal` to the gateway IP.

```bash
docker compose up
```

#### Option 2: Use Host Network Mode

Use `docker-compose.linux.yml`:

```bash
docker compose -f docker-compose.linux.yml up --build
```

This makes the container use the host's network directly (no port mapping needed).

#### Option 3: Use Gateway IP Directly

Override the environment variable:

```bash
OLLAMA_BASE_URL=http://172.17.0.1:11434 docker compose up
```

Or in `docker-compose.override.yml`:
```yaml
services:
  viewer:
    environment:
      OLLAMA_BASE_URL: "http://172.17.0.1:11434"
```

---

## Verification

After starting the container, verify connectivity:

```bash
# Check from inside the container
docker compose exec viewer curl http://host.docker.internal:11434/api/tags

# Or from host
curl http://localhost:8000/api/llm/status
```

**Expected response:**
```json
{
  "available": true,
  "models": ["llama3.2-vision:latest"],
  "base_url": "http://host.docker.internal:11434",
  "current_model": "llama3.2-vision"
}
```

---

## Troubleshooting

### "Connection refused" on Linux

**Option A:** Update Docker to 20.10+ (for `host-gateway` support)

```bash
docker --version  # Should be 20.10 or higher
```

**Option B:** Use static gateway IP

Find the gateway IP:
```bash
docker network inspect bridge | grep Gateway
```

Usually `172.17.0.1`. Then set:
```yaml
OLLAMA_BASE_URL: "http://172.17.0.1:11434"
```

**Option C:** Use host network mode

```bash
docker compose -f docker-compose.linux.yml up
```

### "host.docker.internal: no such host"

Your Docker version is too old (< 20.10).

**Solutions:**
1. Update Docker
2. Use gateway IP: `172.17.0.1`
3. Use host network mode

### Firewall blocking connection

On Linux, ensure Ollama accepts connections from Docker bridge:

```bash
# Check if Ollama is listening
sudo netstat -tlnp | grep 11434

# Should show: 0.0.0.0:11434 (not 127.0.0.1:11434)
```

If Ollama only listens on `127.0.0.1`, configure it to listen on all interfaces:

```bash
# Start Ollama with all interfaces
OLLAMA_HOST=0.0.0.0 ollama serve
```

---

## Docker Compose File Comparison

| File | Platform | Use Case |
|------|----------|----------|
| `docker-compose.yml` | All (Windows/Mac/Linux) | Default, cross-platform |
| `docker-compose.linux.yml` | Linux only | Host network mode |
| `docker-compose.with-ollama.yml` | All | All-in-one (Ollama in Docker) |

---

## All-in-One Alternative

If you want **both** the viewer and Ollama in Docker (no host dependencies):

```bash
docker compose -f docker-compose.with-ollama.yml up --build
```

This runs Ollama in a separate container and they communicate via Docker networking.

**Advantages:**
- No host networking issues
- Fully reproducible
- Works identically on all platforms
- Easy deployment

**Disadvantages:**
- First run downloads ~8GB model
- Uses more resources
- Slightly slower than native Ollama

---

## Quick Reference

### Windows/Mac
```bash
docker compose up
```
✅ Works out of the box with `host.docker.internal`

### Linux (Modern Docker 20.10+)
```bash
docker compose up
```
✅ Works with `extra_hosts: host-gateway` mapping

### Linux (Older Docker)
```bash
docker compose -f docker-compose.linux.yml up
```
✅ Uses host network mode

### Any Platform (All-in-One)
```bash
docker compose -f docker-compose.with-ollama.yml up --build
```
✅ Everything in Docker

---

## Environment Variables

Override Ollama URL at runtime:

```bash
# Custom Ollama URL
OLLAMA_BASE_URL=http://192.168.1.100:11434 docker compose up

# Custom model
OLLAMA_MODEL=llava:13b docker compose up

# Both
OLLAMA_BASE_URL=http://custom-host:11434 \
OLLAMA_MODEL=llava:13b \
docker compose up
```

---

## Testing Connection

Test from host:
```bash
curl http://localhost:11434/api/tags  # Ollama
curl http://localhost:8000/api/llm/status  # Viewer
```

Test from container:
```bash
docker compose exec viewer curl http://host.docker.internal:11434/api/tags
```

---

## See Also

- [OLLAMA-SETUP.md](OLLAMA-SETUP.md) - Ollama installation
- [LLM-TRANSCRIPTION.md](LLM-TRANSCRIPTION.md) - Feature documentation
- [Docker networking docs](https://docs.docker.com/network/)
