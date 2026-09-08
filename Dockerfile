FROM oven/bun:1-debian
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium fonts-liberation fonts-dejavu-core fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY template/fonts /usr/share/fonts/truetype/htbah
RUN fc-cache -f
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production 2>/dev/null || bun install --production
COPY . .
RUN useradd -m -u 10001 app && mkdir -p /data && chown -R app /data /app
USER app
ENV PORT=3000 DATA_DIR=/data CHROMIUM_PATH=/usr/bin/chromium
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD ["bun","-e","fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["bun", "run", "src/server.ts"]
