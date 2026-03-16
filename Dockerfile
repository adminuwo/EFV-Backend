# Use Node.js 18 alpine for a lightweight image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy app source code
COPY . .

# Expose the port the app runs on (matching .env/server.js)
ENV PORT=8080
EXPOSE 8080

# Start the application
CMD ["npm", "start"]
