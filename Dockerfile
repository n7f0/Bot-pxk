# Usa o Node.js versão 20 (Alpine = leve e seguro)
FROM node:20-alpine

# Instala dependências do sistema necessárias (ffmpeg para voz, e ferramentas para compilar o SQLite)
RUN apk add --no-cache ffmpeg python3 make g++

# Define a pasta de trabalho
WORKDIR /app

# Copia os arquivos de dependências primeiro (otimização de cache do Docker)
COPY package*.json ./

# Instala as dependências do Node
RUN npm install

# Copia o resto do projeto (incluindo a pasta src)
COPY . .

# Cria a pasta data e garante permissões corretas para o usuário node
RUN mkdir -p /app/data && chown -R node:node /app

# Muda para o usuário não-root por segurança
USER node

# Expõe a porta do painel
EXPOSE 8080

# Comando para iniciar o Bot e o Painel juntos (via src/index.js)
CMD ["npm", "start"]