FROM node:24-bookworm-slim
WORKDIR /app
COPY connector/package.json connector/package-lock.json ./connector/
WORKDIR /app/connector
RUN npm ci --omit=dev --ignore-scripts
COPY connector/src ./src
COPY supabase/functions/_shared/chatgpt-connector /app/supabase/functions/_shared/chatgpt-connector
USER node
EXPOSE 8787
CMD ["node", "src/start.mjs"]
