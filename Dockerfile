# Use Node.js 18 alpine for a lightweight image
FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy app source code
COPY . .

# Ensure upload directories exist inside the container
RUN mkdir -p src/uploads/covers src/uploads/profiles src/uploads/products

# Use the PORT environment variable provided by Cloud Run
ENV PORT=8080

# Start the application using node directly (better signal handling than npm start)
CMD ["node", "src/server.js"]
