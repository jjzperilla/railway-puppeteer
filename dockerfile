# Use an official Node.js runtime as a parent image
FROM mcr.microsoft.com/playwright:focal

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json before running npm install
COPY package.json package-lock.json ./
RUN npm install

# Copy the rest of the application
COPY . .

# Expose port 8080 for Railway
EXPOSE 8080

# Start the server
CMD ["node", "index.js"]
