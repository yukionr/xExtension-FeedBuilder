FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY renderer ./renderer
ARG SOURCE_REVISION
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
USER pwuser
ENV BIND=127.0.0.1 PORT=3000
CMD ["node", "renderer/server.mjs"]
