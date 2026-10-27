FROM node:24-alpine

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000 \
    MEALBRIDGE_DATA_FILE=/app/data/store.json

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 3000
CMD ["npm", "start"]
