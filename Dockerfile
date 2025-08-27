FROM python:3.11-alpine

# Copy uv binary from multi-stage build
COPY --from=ghcr.io/astral-sh/uv:0.8.13 /uv /uvx /bin/

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install system dependencies (nodejs, npm, gcc, libpq)
RUN apk add --no-cache gcc musl-dev libpq-dev curl nodejs npm

# Copy app files
ADD . /app

# Set workdir
WORKDIR /app

# Install requirements with uv (ensure uv is executable)
RUN chmod +x /bin/uv && uv sync --locked

# Copy frontend code and build it
WORKDIR /app/frontend
RUN npm install && npm run build --silent

# Set workdir back to /app
WORKDIR /app

# Start the app
CMD ["uv", "run", "main.py"]