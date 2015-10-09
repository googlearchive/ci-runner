FROM node:latest

WORKDIR /app
COPY package.json /app/
RUN npm install -g bower
RUN npm install --production
COPY . /app

CMD []
ENTRYPOINT ["node", "server"]
