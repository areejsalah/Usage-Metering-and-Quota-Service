
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY client ./client

EXPOSE 3000

CMD ["npm", "run", "dev"]

