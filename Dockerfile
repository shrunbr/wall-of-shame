FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Set workdir
WORKDIR /app

# Install system dependencies (add nodejs and npm)
RUN apt-get update && \
    apt-get install -y gcc libpq-dev curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy frontend code and build it
COPY frontend ./frontend
WORKDIR /app/frontend
RUN npm install && npm run build

# Copy backend code and built frontend to the right place
WORKDIR /app
COPY . .

# Expose the port Flask runs on
EXPOSE 8081

# Set environment variables for Flask
ENV FLASK_APP=main.py
ENV FLASK_RUN_HOST=0.0.0.0
ENV FLASK_RUN_PORT=8081

# Start the app
CMD ["python", "main.py"]