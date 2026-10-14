FROM node:24-slim
WORKDIR /app
COPY server.js ./
COPY public ./public
ENV PORT=3000 TRUST_PROXY=1
VOLUME /app/data
EXPOSE 3000
CMD ["node", "server.js"]
