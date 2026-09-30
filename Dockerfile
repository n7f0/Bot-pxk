FROM python:3.11-slim

# Instala ffmpeg (necessário para o keepalive de voz) e gosu (para o entrypoint)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        gosu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd -m -u 1000 botuser
RUN chown -R botuser:botuser /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "-u", "bot.py"]