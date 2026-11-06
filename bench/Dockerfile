FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app/bench
COPY bench/package.json bench/package-lock.json ./
RUN npm ci
COPY harness/package.json harness/package-lock.json /app/harness/
COPY harness/node-harness/package.json /app/harness/node-harness/
COPY harness/passthrough-worker/package.json /app/harness/passthrough-worker/
RUN cd /app/harness && npm ci
COPY harness /app/harness
RUN cd /app/harness && npm run build
COPY client /app/client
COPY bench /app/bench
RUN npm run build
CMD ["node", "run.mjs"]
