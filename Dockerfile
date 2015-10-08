FROM google/nodejs

WORKDIR /app
ADD package.json /app/
RUN npm install -g bower
RUN npm install --production
ADD . /app

CMD []
ENTRYPOINT ["/nodejs/bin/node", "server"]
