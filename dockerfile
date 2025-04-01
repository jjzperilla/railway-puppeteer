FROM mcr.microsoft.com/playwright:v1.39.0-focal

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8080

CMD ["npm", "start"]