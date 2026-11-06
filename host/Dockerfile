FROM mcr.microsoft.com/playwright:v1.65.0-noble
WORKDIR /app/host
COPY host/package.json ./
RUN npm install --no-audit --no-fund
COPY client /app/client
COPY host /app/host
RUN npm run build
ENV HOST=0.0.0.0 PORT=8545
EXPOSE 8545
CMD ["node", "--dns-result-order=ipv4first", "server.mjs"]
