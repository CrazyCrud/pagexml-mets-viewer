FROM python:3.10-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    GUNICORN_APP=app:create_app() \
    GUNICORN_WORKERS=1 \
    GUNICORN_THREADS=8 \
    GUNICORN_BIND=0.0.0.0:8000 \
    GUNICORN_TIMEOUT=120

# Create non-root user
RUN useradd -m -u 10001 appuser
WORKDIR /app

# Copy reqs first for caching
COPY requirements.txt /app/requirements.txt

# Install Python deps
RUN pip install --upgrade pip && pip install -r /app/requirements.txt

# App code
COPY . /app

# Ensure workspace dir exists
RUN mkdir -p /app/data/workspaces && chown -R appuser:appuser /app/data

USER appuser
EXPOSE 8000

CMD ["sh", "-c", "gunicorn \"$GUNICORN_APP\" -k gthread -w \"$GUNICORN_WORKERS\" --threads \"$GUNICORN_THREADS\" -b \"$GUNICORN_BIND\" --timeout \"$GUNICORN_TIMEOUT\""]