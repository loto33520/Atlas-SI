ARG PYTHON_IMAGE=python:3.13.14-slim-trixie
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app

RUN groupadd --system atlas && useradd --system --gid atlas --create-home atlas

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY alembic.ini ./
COPY alembic ./alembic
COPY app ./app
COPY tests ./tests
COPY entrypoint.sh ./entrypoint.sh

RUN chmod +x /app/entrypoint.sh && chown -R atlas:atlas /app
USER atlas

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
