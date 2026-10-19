FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["npm", "start"]