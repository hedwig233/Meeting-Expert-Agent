FROM python:3.11-slim
WORKDIR /app
COPY server.py model-config.json index.html app.js minutes.js styles.css ./
ENV HOST=0.0.0.0 PORT=5175 PYTHONUNBUFFERED=1
EXPOSE 5175
CMD ["python", "-u", "server.py"]
