FROM node:24-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY runtime.sql ./runtime.sql
COPY entrypoint.sh /entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["sh", "/entrypoint.sh"]
