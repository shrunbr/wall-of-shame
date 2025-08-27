FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:0.8.13 /uv /uvx /bin/

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Copy files to container
ADD . /app

# Set workdir
WORKDIR /app

# Install system dependencies (add nodejs and npm)
RUN apt-get update && \
    apt-get install -y gcc libpq-dev curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install requirements with uv
RUN uv sync --locked

# Copy frontend code and build it
WORKDIR /app/frontend
RUN npm install && npm run build --silent

# Set workdir back to /app
WORKDIR /app

# Start the app
CMD ["uv", "run", "main.py"]