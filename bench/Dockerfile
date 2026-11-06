FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app/bench
COPY bench/package.json bench/package-lock.json ./
RUN npm ci
COPY client /app/client
COPY bench /app/bench
RUN npm run build
CMD ["node", "run.mjs"]
